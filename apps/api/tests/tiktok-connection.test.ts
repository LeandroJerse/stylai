import { test, expect } from "bun:test"
import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { readSessionKeys } from "../src/modules/auth/session-crypto"
import { createTikTokConnection } from "../src/modules/integrations/tiktok/connection"
import { createTikTokCatalogCache, createTikTokCreatorClient } from "@stylai/commerce"

const keys = readSessionKeys({ STYLAI_SESSION_KEY: Buffer.alloc(32, 7).toString("base64") })!
const fixture = (now: number, access = "private-access", identity = "creator-one") => ({ code: 0, data: {
  access_token: access, refresh_token: "private-refresh", access_token_expire_in: now / 1000 + 120,
  refresh_token_expire_in: now / 1000 + 3600, open_id: identity, user_type: 1,
  granted_scopes: ["creator.affiliate_collaboration.read"], seller_base_region: "BR",
} })

test("connection persists encrypted grants, refreshes after restart and disconnects durably", async () => {
  const file = join(await mkdtemp(join(tmpdir(), "stylai-oauth-")), "vault.json")
  let now = 1800000000000
  const create = () => createTikTokConnection({ file, keys, appKey: "test", appSecret: "secret", now: () => now,
    fetch: async (input) => Response.json(fixture(now, String(input).includes("/refresh") ? "rotated-access" : "private-access")),
  })
  let service = create()
  expect(await service.authorize("private-code")).toEqual({ ok: true })
  expect(await service.getAccessToken()).toBe("private-access")
  const disk = await readFile(file, "utf8")
  expect(disk).not.toContain("private-access")
  expect(disk).not.toContain("private-refresh")
  now += 100000
  service = create()
  expect(await service.getAccessToken()).toBe("rotated-access")
  await service.disconnect()
  expect(await create().getAccessToken()).toBeNull()
})

test("wrong creator identity on refresh invalidates connection; corrupt vault fails closed", async () => {
  const file = join(await mkdtemp(join(tmpdir(), "stylai-oauth-")), "vault.json")
  let now = 1800000000000
  const service = createTikTokConnection({ file, keys, appKey: "test", appSecret: "secret", now: () => now,
    fetch: async (input) => Response.json(fixture(now, "private-access", String(input).includes("/refresh") ? "other" : "creator-one")),
  })
  await service.authorize("code")
  now += 100000
  expect(await service.getAccessToken()).toBeNull()
  await writeFile(file, "corrupt")
  expect(await service.getAccessToken()).toBeNull()
})

test("invalid creator grants and expired timestamps are never persisted", async () => {
  for (const kind of ["seller", "scope", "expiry", "region", "network"]) {
    const file = join(await mkdtemp(join(tmpdir(), "stylai-oauth-")), "vault.json")
    const now = 1800000000000
    const service = createTikTokConnection({ file, keys, appKey: "test", appSecret: "secret", now: () => now,
      fetch: async () => {
        if (kind === "network") throw new Error("secret URL")
        const body = fixture(now)
        if (kind === "seller") body.data.user_type = 0
        if (kind === "scope") body.data.granted_scopes = []
        if (kind === "expiry") body.data.access_token_expire_in = 1
        if (kind === "region") body.data.seller_base_region = "US"
        return Response.json(body)
      },
    })
    expect((await service.authorize("code")).ok).toBe(false)
    expect(await service.getAccessToken()).toBeNull()
  }
})

test("provider revocation code 105001 clears durable grant and prevents subsequent cached or remote access", async () => {
  const file = join(await mkdtemp(join(tmpdir(), "stylai-oauth-")), "vault.json")
  const now = 1800000000000
  const service = createTikTokConnection({ file, keys, appKey: "test", appSecret: "secret", now: () => now,
    fetch: async () => Response.json(fixture(now)),
  })
  expect((await service.authorize("code")).ok).toBe(true)
  let revoked = false
  const client = createTikTokCreatorClient({ appKey: "key", appSecret: "secret", fetch: async () => Response.json(
    revoked ? { code: 105001, message: "Authorization removed" } : { code: 0, data: { products: [] } },
  ) })
  const cache = createTikTokCatalogCache({ client, getAccessToken: service.getAccessToken, onAuthorizationFailure: service.invalidate })
  expect((await cache.search({ keywords: ["camisa"] })).state).toBe("ready")
  revoked = true
  expect((await cache.search({ keywords: ["camisa"] }, { forceRefresh: true })).state).toBe("authorization_required")
  expect(await service.getAccessToken()).toBeNull()
  expect(await cache.listFreshCached()).toEqual([])
})

test("disconnect invalidates an in-flight exchange and cannot resurrect credentials", async () => {
  const file = join(await mkdtemp(join(tmpdir(), "stylai-oauth-")), "vault.json")
  const now = 1800000000000
  let release!: () => void
  const barrier = new Promise<void>((resolve) => { release = resolve })
  let started!: () => void
  const entered = new Promise<void>((resolve) => { started = resolve })
  const service = createTikTokConnection({ file, keys, appKey: "key", appSecret: "secret", now: () => now,
    fetch: async () => { started(); await barrier; return Response.json(fixture(now)) },
  })
  const exchange = service.authorize("code")
  await entered
  const disconnect = service.disconnect()
  release()
  expect((await exchange).ok).toBe(false)
  await disconnect
  expect(await service.getAccessToken()).toBeNull()
})

test("transient refresh business error preserves grant for later recovery", async () => {
  const file = join(await mkdtemp(join(tmpdir(), "stylai-oauth-")), "vault.json")
  let now = 1800000000000
  let temporaryFailure = false
  const service = createTikTokConnection({ file, keys, appKey: "key", appSecret: "secret", now: () => now,
    fetch: async () => Response.json(temporaryFailure ? { code: 999999, message: "Try again" } : fixture(now)),
  })
  await service.authorize("code")
  now += 100000
  temporaryFailure = true
  expect(await service.getAccessToken()).toBeNull()
  temporaryFailure = false
  expect(await service.getAccessToken()).toBe("private-access")
})
