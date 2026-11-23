import { expect, test } from "bun:test"
import { buildApp } from "../src/app.js"

const origin = "http://localhost:5200"
const actor = "70000000-0000-4000-8000-000000000001"
const receipt = "70000000-0000-4000-8000-000000000002"

test("account deletion uses authenticated actor, confirms intent, and reports queued status", async () => {
  const calls: string[] = []
  const deps = { appOrigin: origin, privacy: {
    appOrigin: origin, resolveActor: async () => actor,
    requestDeletion: async (id: string) => { calls.push(id); return receipt },
  } }
  const app = await buildApp(deps)
  try {
    for (const payload of [{}, { confirm: true, userId: receipt }, { confirm: false }]) {
      expect((await app.inject({ method: "POST", url: "/v1/privacy/deletion-requests", headers: { origin }, payload })).statusCode).toBe(422)
    }
    expect((await app.inject({ method: "POST", url: "/v1/privacy/deletion-requests", payload: { confirm: true } })).statusCode).toBe(403)
    expect(calls).toEqual([])
    const response = await app.inject({ method: "POST", url: "/v1/privacy/deletion-requests", headers: { origin }, payload: { confirm: true } })
    expect(response.statusCode).toBe(202)
    expect(response.json()).toEqual({ requestId: receipt, status: "pending" })
    expect(response.headers["cache-control"]).toBe("no-store")
    expect(calls).toEqual([actor])
  } finally { await app.close() }
})

test("account deletion refuses anonymous requests and does not expose failure details", async () => {
  for (const authenticated of [false, true]) {
    let called = false
    const deps = { appOrigin: origin, privacy: {
      appOrigin: origin, resolveActor: async () => authenticated ? actor : null,
      requestDeletion: async () => { called = true; throw new Error("private database details") },
    } }
    const app = await buildApp(deps)
    try {
      const response = await app.inject({ method: "POST", url: "/v1/privacy/deletion-requests", headers: { origin }, payload: { confirm: true } })
      expect(response.statusCode).toBe(authenticated ? 503 : 401)
      expect(called).toBe(authenticated)
      expect(response.body).not.toContain("private database details")
    } finally { await app.close() }
  }
})
