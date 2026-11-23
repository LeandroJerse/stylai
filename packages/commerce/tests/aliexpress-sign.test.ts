import { describe, expect, test } from "bun:test"
import { buildAliExpressSignBase, signAliExpressRequest } from "../src/index"

// Official vectors: https://openservice.aliexpress.com/doc/doc.htm#/?docId=1385 (App Secret "helloworld").
describe("AliExpress HMAC-SHA256 signing", () => {
  test("business interface vector (method is a sorted parameter, no path prefix)", () => {
    // The page's concatenated string (and therefore its signature) uses this `method` value.
    const params = {
      app_key: "123456", access_token: "test", timestamp: "1517820392000", sign_method: "sha256",
      aliexpress_category_id: "200135143", method: "aliexpress.logistics.redefining.getonlinelogisticsinfo",
    }
    expect(buildAliExpressSignBase(params)).toBe("access_tokentestaliexpress_category_id200135143app_key123456methodaliexpress.logistics.redefining.getonlinelogisticsinfosign_methodsha256timestamp1517820392000")
    expect(signAliExpressRequest(params, "helloworld")).toBe("F7F7926B67316C9D1E8E15F7E66940ED3059B1638C497D77973F30046EFB5BBB")
  })

  test("system interface vector (API path prefixed)", () => {
    const params = { app_key: "12345678", code: "3_500102_JxZ05Ux3cnnSSUm6dCxYg6Q26", sign_method: "sha256", timestamp: "1517820392000" }
    expect(signAliExpressRequest(params, "helloworld", "/auth/token/create")).toBe("35607762342831B6A417A0DED84B79C05FEFBF116969C48AD6DC00279A9F4D81")
  })

  test("ignores sign and empty values; independent of key order; requires a secret", () => {
    const a = signAliExpressRequest({ b: "2", a: "1", sign: "X", empty: "", missing: undefined }, "s")
    const b = signAliExpressRequest({ a: "1", b: "2" }, "s")
    expect(a).toBe(b)
    expect(a).toMatch(/^[0-9A-F]{64}$/)
    expect(() => signAliExpressRequest({ a: "1" }, "")).toThrow()
    expect(() => buildAliExpressSignBase({}, "auth/token/create")).toThrow()
  })
})
