import { describe, expect, test } from "bun:test"
import { buildApp } from "../src/app"

describe("API foundation", () => {
  test("liveness does not pretend that Supabase is connected", async () => {
    const app = await buildApp({ appOrigin: "http://localhost:5190" })
    try {
      expect((await app.inject("/health/live")).statusCode).toBe(200)
      const readiness = await app.inject("/health/ready")
      expect(readiness.statusCode).toBe(503)
      expect(readiness.json().status).toBe("not_ready")
    } finally { await app.close() }
  })

  test("unimplemented business routes never return success or fake data", async () => {
    const app = await buildApp({ appOrigin: "http://localhost:5190" })
    try {
      for (const url of ["/v1/catalog/products", "/v1/auth/refresh", "/v1/studio/config", "/v1/webhooks/payments/asaas"]) {
        const response = await app.inject({ method: "POST", url })
        expect(response.statusCode).toBe(503)
        expect(response.json().error.code).toBe("service_unavailable")
      }
      expect((await app.inject("/unknown")).statusCode).toBe(404)
    } finally { await app.close() }
  })

  test("only the exact configured browser origin gets credentialed CORS", async () => {
    const app = await buildApp({ appOrigin: "http://localhost:5190" })
    try {
      const allowed = await app.inject({ url: "/health/live", headers: { origin: "http://localhost:5190" } })
      expect(allowed.headers["access-control-allow-origin"]).toBe("http://localhost:5190")
      expect(allowed.headers["access-control-allow-credentials"]).toBe("true")
      const denied = await app.inject({ url: "/health/live", headers: { origin: "https://attacker.example" } })
      expect(denied.statusCode).toBe(403)
      expect(denied.headers["access-control-allow-origin"]).toBeUndefined()
      expect(denied.json().error.code).toBe("forbidden")
    } finally { await app.close() }
  })

  test("private API errors are not shared-cacheable and reject malformed JSON safely", async () => {
    const app = await buildApp({ appOrigin: "http://localhost:5190" })
    try {
      const response = await app.inject({ method: "POST", url: "/v1/auth/sign-in", headers: { "content-type": "application/json" }, payload: "{" })
      expect(response.statusCode).toBe(400)
      expect(response.json().error.code).toBe("validation")
      expect(response.headers["cache-control"]).toBe("no-store")
      expect(response.body).not.toContain("stack")
    } finally { await app.close() }
  })
})
