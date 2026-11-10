import { expect, test } from "bun:test"
import { buildApp } from "../src/app"

test("API readiness is 200 only after a real dependency probe reports ready", async () => {
  let status: "ready" | "unreachable" = "ready"
  const app = await buildApp({ appOrigin: "http://localhost:5190", probeSupabase: async () => ({ status }) })
  try {
    expect((await app.inject("/health/ready")).statusCode).toBe(200)
    status = "unreachable"
    expect((await app.inject("/health/ready")).statusCode).toBe(503)
    expect((await app.inject("/health/live")).statusCode).toBe(200)
  } finally { await app.close() }
})

test("a failed dependency never leaks its error or claims readiness", async () => {
  const app = await buildApp({ appOrigin: "http://localhost:5190", probeSupabase: async () => { throw new Error("private credential material") } })
  try {
    const response = await app.inject("/health/ready")
    expect(response.statusCode).toBe(503)
    expect(response.body).not.toContain("credential")
  } finally { await app.close() }
})
