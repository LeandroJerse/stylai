import { describe, expect, test } from "bun:test"
import { createServer } from "node:http"
import { once } from "node:events"
import { createAdminClient, createPublicClient, createUserClient, probeFoundation, readSupabaseConfig } from "../src/index"

describe("Supabase configuration and clients", () => {
  test("missing configuration is explicit, partial config fails, and secrets cannot be public keys", () => {
    expect(readSupabaseConfig({})).toBeNull()
    expect(() => readSupabaseConfig({ SUPABASE_URL: "https://example.supabase.co" })).toThrow()
    expect(() => readSupabaseConfig({ SUPABASE_URL: "https://example.supabase.co", SUPABASE_PUBLISHABLE_KEY: "sb_secret_never_public" })).toThrow()
    expect(() => readSupabaseConfig({ SUPABASE_URL: "https://user:password@example.supabase.co", SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test" })).toThrow()
    expect(() => readSupabaseConfig({ SUPABASE_URL: "http://example.supabase.co", SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test" })).toThrow()
  })

  test("public/user clients cannot inherit server admin credentials or another user's bearer", async () => {
    const calls: Array<{ apikey: string | undefined; authorization: string | undefined }> = []
    const server = createServer((request, response) => {
      calls.push({ apikey: request.headers.apikey as string | undefined, authorization: request.headers.authorization })
      response.writeHead(200, { "content-type": "application/json" })
      response.end(JSON.stringify({ status: "ok", schema_version: "20261110000100" }))
    })
    server.listen(0, "127.0.0.1")
    await once(server, "listening")
    try {
      const address = server.address()
      if (!address || typeof address === "string") throw new Error("Missing address")
      const config = readSupabaseConfig({ SUPABASE_URL: `http://127.0.0.1:${address.port}`, SUPABASE_PUBLISHABLE_KEY: "sb_publishable_public", SUPABASE_SECRET_KEY: "sb_secret_private" })!
      await createPublicClient(config).rpc("stylai_health")
      await createUserClient(config, "user-a-jwt").rpc("stylai_health")
      await createUserClient(config, "user-b-jwt").rpc("stylai_health")
      expect(calls[0]!.apikey).toBe("sb_publishable_public")
      expect(calls[0]!.authorization).not.toContain("sb_secret_private")
      expect(calls[1]!.authorization).toBe("Bearer user-a-jwt")
      expect(calls[2]!.authorization).toBe("Bearer user-b-jwt")
      expect(() => createAdminClient({ ...config, secretKey: undefined }, "worker")).toThrow()
    } finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())) }
  })
})

test("readiness checks an actual bounded HTTP RPC and rejects a missing schema", async () => {
  let mode: "ready" | "missing" | "wrong" | "hang" = "ready"
  const server = createServer((request, response) => {
    expect(request.url).toBe("/rest/v1/rpc/stylai_health")
    expect(request.headers.apikey).toBe("sb_publishable_test")
    if (mode === "hang") return
    response.writeHead(mode === "missing" ? 404 : 200, { "content-type": "application/json" })
    response.end(JSON.stringify(mode === "missing" ? { code: "PGRST202", message: "missing function" } : { status: "ok", schema_version: mode === "wrong" ? "wrong-schema" : "20261110000100" }))
  })
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  try {
    const address = server.address()
    if (!address || typeof address === "string") throw new Error("Missing address")
    const config = readSupabaseConfig({ SUPABASE_URL: `http://127.0.0.1:${address.port}`, SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test" })!
    expect((await probeFoundation(config)).status).toBe("ready")
    mode = "missing"
    expect((await probeFoundation(config)).status).toBe("schema_missing")
    mode = "wrong"
    expect((await probeFoundation(config)).status).toBe("schema_mismatch")
    mode = "hang"
    expect((await probeFoundation(config, 80)).status).toBe("unreachable")
    expect((await probeFoundation(null)).status).toBe("not_configured")
  } finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())) }
})
