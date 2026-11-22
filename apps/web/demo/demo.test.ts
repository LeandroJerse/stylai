import { beforeEach, expect, setSystemTime, test } from "bun:test"
import { handle, resetDemo, configureDemo } from "./demo-api"
import { parseCloset, parseJob, parseLook, parsePage, parseProduct, parseSession, parsePreferences, parseBodyPhotos, parseMeasurements, parseUpload, parseLooks, parseCandidates, parseSignUpResult } from "../src/api/parse"

const request = (method: string, path: string, body: Record<string, unknown> | null = null) => handle(method, path.split("?")[0]!, new URL(`http://localhost:5192/v1${path}`), body)
// Prototype contract (?demo=full). The official try-on contract is covered in demo-tryon.test.ts.
beforeEach(() => { setSystemTime(new Date("2026-11-17T12:00:00Z")); configureDemo({ contract: "full" }); resetDemo() })
test("demo starts signed in with populated closet, history and multiple offers", () => {
  expect(parseSession(request("POST", "/auth/refresh").body).user.name).toBeTruthy()
  expect(parseCloset(request("GET", "/closet").body).looks.length).toBeGreaterThan(0)
  const catalog = parsePage(request("GET", "/catalog/products").body, parseProduct)
  expect(catalog.items[0]!.offers.length).toBe(3)
})
test("dress preserves selected pieces, finishes once and debits once", () => {
  const before = request("GET", "/me/balance").body as { tokens: number }
  const job = parseJob(request("POST", "/studio/generations", { mode: "dress", productIds: ["blazer-la-fria", "pantalona-risca"] }).body)
  setSystemTime(new Date("2026-11-17T12:00:10Z"))
  const done = parseJob(request("GET", `/studio/jobs/${job.id}`).body)
  expect(done.status).toBe("succeeded")
  const look = parseLook(request("GET", `/studio/looks/${done.lookId}`).body)
  expect(look.pieces.map(p => p.product.id)).toEqual(["blazer-la-fria", "pantalona-risca"])
  request("GET", `/studio/jobs/${job.id}`)
  expect((request("GET", "/me/balance").body as { tokens: number }).tokens).toBe(before.tokens - job.cost)
})
test("cancelled jobs do not charge or add history", () => {
  const before = request("GET", "/me/balance").body
  const job = parseJob(request("POST", "/studio/generations", { mode: "search", prompt: "jantar" }).body)
  request("POST", `/studio/jobs/${job.id}/cancel`)
  setSystemTime(new Date("2026-11-17T12:00:10Z"))
  expect(parseJob(request("GET", `/studio/jobs/${job.id}`).body).status).toBe("cancelled")
  expect((request("GET", "/me/balance").body as { tokens: number }).tokens).toBe((before as { tokens: number }).tokens)
})
test("encoded Match undo preserves previously saved looks", () => {
  request("PUT", "/closet/looks/camelo")
  const decision = request("POST", "/studio/match/decisions", { lookId: "camelo", decision: "save" }).body as { id: string }
  expect(request("DELETE", `/studio/match/decisions/${encodeURIComponent(decision.id)}`).status).toBe(204)
  expect(parseCloset(request("GET", "/closet").body).looks.some(l => l.id === "camelo")).toBe(true)
})
test("strict impossible budget returns no results without charging", () => {
  const job = parseJob(request("POST", "/studio/generations", { prompt: "jantar", rules: { budget: { mode: "require", value: 1, scope: "look" } } }).body)
  setSystemTime(new Date("2026-11-17T12:00:10Z"))
  const done = parseJob(request("GET", `/studio/jobs/${job.id}`).body)
  expect(done.status).toBe("no_results")
  expect(done.charged).toBe(false)
  expect(done.limiting[0]?.id).toBe("budget")
})

test("editing and trying on return valid versions and chosen products", () => {
  const edit=parseJob(request("POST","/studio/looks/la-fria/edits",{instruction:"Ver de perfil"}).body)
  setSystemTime(new Date("2026-11-17T12:00:10Z"))
  const edited=parseLook(request("GET",`/studio/looks/${parseJob(request("GET",`/studio/jobs/${edit.id}`).body).lookId}`).body)
  expect(edited.version).toBe(2)
  expect(edited.image.url).toContain("try-profile.jpg")
  const job=parseJob(request("POST","/studio/try-ons",{sourceLookId:edited.id,productIds:["blazer-la-fria","pantalona-risca"]}).body)
  setSystemTime(new Date("2026-11-17T12:00:20Z"))
  const result=parseLook(request("GET",`/studio/looks/${parseJob(request("GET",`/studio/jobs/${job.id}`).body).lookId}`).body)
  expect(result.origin).toBe("tryon")
  expect(result.pieces.length).toBe(2)
})
test("failure and insufficient funds never debit tokens", () => {
  configureDemo({scenario:"failed"})
  const job=parseJob(request("POST","/studio/generations",{prompt:"jantar"}).body)
  setSystemTime(new Date("2026-11-17T12:00:10Z"))
  expect(parseJob(request("GET",`/studio/jobs/${job.id}`).body).status).toBe("failed")
  expect((request("GET","/me/balance").body as {tokens:number}).tokens).toBe(120) // approved paid amount (was the legacy 200)
  configureDemo({tokens:0})
  expect(request("POST","/studio/generations",{prompt:"jantar"}).status).toBe(402)
})
test("catalog filters, pagination, candidates and match use published data", () => {
  const catalog=parsePage(request("GET","/catalog/products?limit=2").body,parseProduct)
  expect(catalog.items).toHaveLength(2)
  expect(catalog.nextCursor).toBe("2")
  const filtered=parsePage(request("GET","/catalog/products?category=sapato&sort=price_asc").body,parseProduct)
  expect(filtered.items.every(p=>p.category?.id==="sapato")).toBe(true)
  expect(parseCandidates(request("GET","/studio/looks/la-fria/candidates").body).length).toBeGreaterThan(6)
  expect(parseLooks(request("GET","/studio/match/deck").body).length).toBeGreaterThan(3)
})
test("profile, preferences, upload and body data lifecycle", () => {
  request("PUT","/me/measurements",{heightCm:175,size:"G"})
  expect(parseMeasurements(request("GET","/me/measurements").body).heightCm).toBe(175)
  const prefs=parsePreferences(request("GET","/preferences").body)
  const rules={...prefs.items[0]!.rules,minRating:{value:4.9,mode:"require"}}
  request("PATCH","/preferences/dia",{rules})
  expect(parsePreferences(request("GET","/preferences").body).items[0]!.rules.minRating.value).toBe(4.9)
  expect(parseUpload(request("POST","/uploads/references",{sizeBytes:100,mime:"image/png"}).body).id).toBeTruthy()
  request("PUT","/me/body-photos/front",{sizeBytes:100,mime:"image/png"})
  setSystemTime(new Date("2026-11-17T12:00:10Z"))
  expect(parseBodyPhotos(request("GET","/me/body-photos").body)[0]?.status).toBe("ready")
  request("DELETE","/me/body-data")
  expect(parseBodyPhotos(request("GET","/me/body-photos").body)).toHaveLength(0)
})
test("sign out, sign up, reset password and account deletion stay local", () => {
  request("POST","/auth/sign-out")
  expect(request("GET","/me").status).toBe(401)
  // Like the real API: sign-up never returns a session; the e-mail link (demo token) does.
  expect(parseSignUpResult(request("POST","/auth/sign-up",{name:"Teste",email:"test@example.com",password:"demo12345"}).body).status).toBe("verification_required")
  expect(request("GET","/me").status).toBe(401)
  expect(request("POST","/auth/email/verify",{tokenHash:"not-a-demo-token"}).status).toBe(400)
  expect(parseSession(request("POST","/auth/email/verify",{tokenHash:"demo-abcdefghijkl"}).body).user.name).toBe("Teste")
  expect(request("POST","/auth/password/forgot",{email:"test@example.com"}).status).toBe(204)
  expect(request("POST","/auth/password/reset",{token:"demo",password:"demo123456"}).status).toBe(204)
  request("DELETE","/me")
  expect(request("POST","/auth/refresh").status).toBe(401)
})

