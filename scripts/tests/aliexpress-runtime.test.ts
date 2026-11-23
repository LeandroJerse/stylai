import { expect, test } from "bun:test"
import { aliexpressRuntimeEnvironment, withoutAliExpressEnv } from "../aliexpress-runtime.mjs"

const valid = { appKey: "561468", trackingId: "stylai", secret: "synthetic-secret-value-0001" }

test("AliExpress runtime maps the protected config to API-only env names and fails closed", () => {
  expect(aliexpressRuntimeEnvironment(valid)).toEqual({
    ALIEXPRESS_APP_KEY: "561468", ALIEXPRESS_APP_SECRET: valid.secret, ALIEXPRESS_TRACKING_ID: "stylai", STYLAI_CATALOG_MODE: "aliexpress_affiliate",
  })
  const untracked = aliexpressRuntimeEnvironment({ ...valid, trackingId: "" })
  expect("ALIEXPRESS_TRACKING_ID" in untracked).toBe(false)
  for (const bad of [{ secret: "" }, { secret: "short" }, { appKey: "abc" }, { trackingId: "561468" }, { trackingId: "has space" }]) {
    expect(() => aliexpressRuntimeEnvironment({ ...valid, ...bad })).toThrow()
  }
  // Errors never echo the secret.
  try { aliexpressRuntimeEnvironment({ ...valid, appKey: "x" }) } catch (error) { expect(String(error)).not.toContain(valid.secret) }
})

test("inherited ALIEXPRESS_* variables are removed before spawning non-API children", () => {
  expect(withoutAliExpressEnv({ PATH: "p", ALIEXPRESS_APP_SECRET: "s", ALIEXPRESS_TRACKING_ID: "t", aliexpress_app_key: "k" })).toEqual({ PATH: "p" })
})
