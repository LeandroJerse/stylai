// First engine slice, end to end on a disposable PostgreSQL 17 (Docker):
// real API routes + real worker engine + restricted DB roles. External
// providers are replaced ONLY at the HTTP boundary by labelled test doubles
// (no paid call, no hosted database, no app env files are read).
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { randomBytes, randomUUID } from "node:crypto"
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { deflateSync } from "node:zlib"
import { setTimeout as delay } from "node:timers/promises"
import { createPrivateDatabase } from "../packages/supabase/src/private-database.js"
import { readPrivateDatabaseConfig, privateDatabaseRoles, type DatabasePurpose } from "../packages/supabase/src/private-config.js"
import { createLocalObjectStore, type PrivateObjectStore } from "../packages/supabase/src/object-store.js"
import { createSegmindClient, type FetchLike } from "../packages/ai/src/segmind.js"
import { createOtlpExporter } from "../packages/ai/src/telemetry.js"
import { buildApp } from "../apps/api/src/app.js"
import { readSessionKeys } from "../apps/api/src/modules/auth/session-crypto.js"
import { createEngine, defaultEngineConfig } from "../apps/worker/src/engine.js"
import { flushTelemetryOnce } from "../apps/worker/src/telemetry-flush.js"
// The real frontend parsers: proves the API speaks the existing client contract.
import { parseJob, parseLook, parseLooks } from "../apps/web/src/api/parse.js"

const root = process.cwd()
const name = `stylai-motor-test-${randomUUID().slice(0, 8)}`
const secret = randomBytes(24).toString("hex")
const A = "10000000-0000-4000-8000-0000000000a1"
const B = "10000000-0000-4000-8000-0000000000b2"
const P1 = "60000000-0000-4000-8000-000000000001", V1 = "70000000-0000-4000-8000-000000000001"
const P2 = "60000000-0000-4000-8000-000000000002", V2 = "70000000-0000-4000-8000-000000000002"
const pseudonymKey = randomBytes(32).toString("hex")
const clients: Array<{ close(): Promise<void> }> = []
const storeDir = mkdtempSync(join(tmpdir(), "stylai-motor-store-"))
let started = false

function docker(args: string[], input?: string) {
  const result = spawnSync("docker", args, { cwd: root, encoding: "utf8", windowsHide: true, timeout: 180000, input, maxBuffer: 4_000_000, env: { ...process.env, POSTGRES_PASSWORD: secret } })
  if (result.status !== 0) throw new Error("Disposable Docker command failed: " + (result.stderr ?? "").slice(0, 400).replaceAll(secret, "***"))
  return result.stdout.trim()
}
function admin(sql: string) { return docker(["exec", "-i", name, "psql", "-XqtA", "-U", "postgres", "-d", "stylai_test", "-v", "ON_ERROR_STOP=1"], sql) }

/** Minimal valid PNG (fixture output image). */
function png(width: number, height: number): Uint8Array {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0 })
  const crc = (buf: Buffer) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
  const chunk = (type: string, data: Buffer) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]) }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2
  const raw = Buffer.alloc((width * 3 + 1) * height)
  return new Uint8Array(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]))
}
const outputPng = png(48, 64)

// ---- Segmind test double (HTTP boundary only; mirrors the documented v2 flow) ----
type SegMode = "ok" | "submit_timeout" | "slow"
const seg = { mode: "ok" as SegMode, submits: 0, polls: 0, requestIds: new Set<string>(), keys: [] as string[], bodies: [] as unknown[] }
const segFetch: FetchLike = async (input, init) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url)
  const headers = new Headers(init?.headers)
  if (url.hostname === "images.segmind.com") return new Response(outputPng, { status: 200, headers: { "content-type": "image/png", "content-length": String(outputPng.length) } })
  assert.equal(headers.get("x-api-key"), "SG_testdouble00000000")
  if (init?.method === "POST" && url.pathname === "/v2/try-on-diffusion") {
    seg.submits++
    seg.keys.push(headers.get("x-request-id") ?? "")
    seg.bodies.push(JSON.parse(String(init.body)))
    if (seg.mode === "submit_timeout") { const e = new Error("timeout"); e.name = "TimeoutError"; throw e }
    if (seg.mode === "slow") await delay(400) // holds the reservation open so the race is real
    const id = `seg-${seg.submits}`
    seg.requestIds.add(id)
    return Response.json({ request_id: id, status: "QUEUED", status_url: `https://api.segmind.test/v2/requests/${id}/status`, response_url: `https://api.segmind.test/v2/requests/${id}` })
  }
  const m = /^\/v2\/requests\/([^/]+)(\/status)?$/.exec(url.pathname)
  if (m && init?.method === "GET") {
    seg.polls++
    if (!seg.requestIds.has(m[1]!)) return Response.json({ error: "not found" }, { status: 404 })
    if (m[2]) return Response.json({ status: seg.mode === "slow" && seg.polls < 3 ? "PROCESSING" : "COMPLETED" })
    return Response.json({ status: "COMPLETED", images: [{ url: `https://images.segmind.com/out/${m[1]}.png`, content_type: "image/png" }], metrics: { cost: 0.058, inference_time: 8.06, queue_time: 0.4 } })
  }
  return new Response("{}", { status: 404 })
}

// ---- Langfuse test double ----
const lf = { up: false, requests: [] as Array<{ auth: string | null; version: string | null; body: string }> }
const lfFetch: FetchLike = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
  assert.equal(new URL(url).pathname, "/api/public/otel/v1/traces")
  if (!lf.up) { const e = new TypeError("fetch failed"); (e as { cause?: unknown }).cause = { code: "ECONNREFUSED" }; throw e }
  const h = new Headers(init?.headers)
  lf.requests.push({ auth: h.get("authorization"), version: h.get("x-langfuse-ingestion-version"), body: String(init?.body) })
  return new Response("{}", { status: 200 })
}

try {
  docker(["run", "--rm", "--detach", "--name", name, "--label", "dev.stylai.test=motor-slice", "--publish", "127.0.0.1::5432", "-e", "POSTGRES_PASSWORD", "-e", "POSTGRES_DB=stylai_test", "postgres:17-alpine"])
  started = true
  let ready = false
  for (let i = 0; i < 60; i++) {
    if (spawnSync("docker", ["exec", name, "pg_isready", "-h", "127.0.0.1", "-U", "postgres", "-d", "stylai_test"], { windowsHide: true, stdio: "ignore", timeout: 5000 }).status === 0) { ready = true; break }
    await delay(500)
  }
  assert(ready, "Disposable PostgreSQL failed to start")
  await delay(1000)
  const migrations = readdirSync(resolve(root, "supabase/migrations")).filter((f) => /^\d{14}_.+\.sql$/.test(f)).sort()
  admin(["supabase/tests/bootstrap-postgres.sql", ...migrations.map((f) => `supabase/migrations/${f}`)].map((f) => readFileSync(resolve(root, f), "utf8")).join("\n"))
  for (const role of Object.values(privateDatabaseRoles)) admin(`alter role ${role} login password '${secret}';`)
  const port = docker(["port", name, "5432/tcp"]).split(":").at(-1)!
  const config = <P extends DatabasePurpose>(purpose: P) =>
    readPrivateDatabaseConfig({ [`STYLAI_${purpose.toUpperCase()}_DATABASE_URL`]: `postgres://${privateDatabaseRoles[purpose]}:${secret}@127.0.0.1:${port}/stylai_test` }, purpose)!
  const apiDb = createPrivateDatabase(config("api")); clients.push(apiDb)
  const workerDb = createPrivateDatabase(config("ai_worker")); clients.push(workerDb)
  assert.equal(await apiDb.probe(), "ready")
  assert.equal(await workerDb.probe(), "ready")

  // Fixtures: two users, consent + photo for both, curated catalog clearly labelled.
  admin(`
    insert into auth.users(id) values ('${A}'),('${B}');
    insert into private.photo_consents(user_id,policy_version) values ('${A}','dev-v1'),('${B}','dev-v1');
    insert into private.assets(user_id,kind,state,bucket_id,object_key,bytes,mime,width,height,expires_at,validation_status,validator_version,validation) values
      ('${A}','body_photo','ready','body-photos','${A}/front.jpg',4096,'image/jpeg',800,1000,now()+interval '1 day','approved','mp-test+pose-rules/4','{"supports":{"upper":true,"lower":true,"dress":true}}'::jsonb),
      ('${B}','body_photo','ready','body-photos','${B}/front.jpg',4096,'image/jpeg',800,1000,now()+interval '1 day','approved','mp-test+pose-rules/4','{"supports":{"upper":true,"lower":true,"dress":true}}'::jsonb);
    insert into public.categories(id,label) values ('jackets','Jaquetas');
    insert into public.partners(id,source,external_seller_id,region,name) values ('50000000-0000-4000-8000-000000000001','curated','fixture','BR','Fixture curated catalog (not real products)');
    insert into public.products(id,partner_id,external_product_id,category_id,name,price_minor,product_url,availability,published,rights_cleared) values
      ('${P1}','50000000-0000-4000-8000-000000000001','fx-1','jackets','Jaqueta fixture A',19990,'https://example.com/fx-1','available',true,true),
      ('${P2}','50000000-0000-4000-8000-000000000001','fx-2','jackets','Jaqueta fixture B',24990,'https://example.com/fx-2','available',true,true);
    insert into public.product_variants(id,product_id,external_variant_id,label,available) values ('${V1}','${P1}','fx-1-m','Preta M',true),('${V2}','${P2}','fx-2-m','Azul M',true);
    insert into public.product_images(product_id,url,position) values ('${P1}','https://example.com/fx-1.jpg',0),('${P2}','https://example.com/fx-2.jpg',0);
    insert into private.catalog_image_rights(image_id,basis,evidence,try_on_allowed) select id,'test_fixture','synthetic test row',true from public.product_images;
    insert into private.provider_budget_limits(scope,scope_key,period,limit_usd_micros) values
      ('global','*','day',5000000),('global','*','month',20000000),('provider','segmind','day',3000000),('provider','segmind','month',10000000),
      ('provider','anthropic','day',1000000),('provider','anthropic','month',5000000),('provider','gemini','day',1000000),('provider','gemini','month',5000000),
      ('user','*','day',2000000),('job','*','job',1000000);
  `)

  const local = createLocalObjectStore(storeDir)
  await local.put("body-photos", `${A}/front.jpg`, png(8, 10), "image/jpeg")
  // Test-only: a provider-reachable URL for the private photo (real Supabase signs short-lived URLs).
  const store: PrivateObjectStore = { ...local, kind: "local", signedUrl: async (bucket, key) => `https://storage.example.com/${bucket}/${key}?expires=600` } // public-looking host: the real-mode guard refuses *.test
  const segmind = createSegmindClient({ apiKey: "SG_testdouble00000000", baseUrl: "https://api.segmind.test", fetch: segFetch, requestTimeoutMs: 2000 })
  let actor = A
  const keys = readSessionKeys({ STYLAI_SESSION_KEY: randomBytes(32).toString("base64") })!
  const resolveActor = async () => actor
  const media = { db: apiDb, keys, resolveActor, photoPolicyVersion: "dev-v1", publicBaseUrl: "http://127.0.0.1:3000/v1" }
  const app = await buildApp({ appOrigin: "http://localhost:5190", studio: { ...media, generationEnabled: true }, photos: { ...media, store } })
  /** Fetches a version image through the signed link the API itself returned. */
  const imageOf = async (versionId: string) => {
    const look = await app.inject(`/v1/studio/looks/${versionId}`)
    if (look.statusCode !== 200) return look
    return app.inject(new URL(look.json().image.url as string).pathname + new URL(look.json().image.url as string).search)
  }
  const engineConfig = { ...defaultEngineConfig, environment: "test" as const, pseudonymKey, pollIntervalMs: 5, pollTimeoutMs: 2000 }
  const engine = createEngine({ db: workerDb, store, segmind, config: engineConfig, sleep: async () => undefined })
  const post = (key: string, body: unknown) => app.inject({ method: "POST", url: "/v1/studio/generations", headers: { "idempotency-key": key }, payload: body as Record<string, unknown> })

  // 1. Idempotent job: concurrent API retries share one job and one quota unit.
  const replies = await Promise.all([post("key-look-v1-0001", { productId: P1, variantId: V1 }), post("key-look-v1-0001", { productId: P1, variantId: V1 }), post("key-look-v1-0001", { productId: P1, variantId: V1 })])
  for (const r of replies) assert.equal(r.statusCode, 202, r.body)
  const job1 = replies[0]!.json().id as string
  assert(replies.every((r) => r.json().id === job1), "retry created a second job")
  assert.equal(admin("select count(*)||'/'||max(reserved) from private.ai_jobs j join private.ai_daily_usage u using(user_id)"), "1/1")
  assert.equal((await post("key-look-v1-0001", { productId: P2, variantId: V2 })).statusCode, 409, "same key with other data accepted")
  assert.equal((await post("key-bad-0001", { productId: "not-a-uuid" })).statusCode, 400)
  assert.equal((await app.inject({ method: "POST", url: "/v1/studio/generations", payload: { productId: P1, variantId: V1 } })).statusCode, 400, "missing idempotency key accepted")

  // 2. Isolation: B cannot see A's job.
  actor = B
  assert.equal((await app.inject(`/v1/studio/jobs/${job1}`)).statusCode, 404)
  actor = A

  // 3. Worker: verified selection -> one paid dispatch -> private copy -> v1.
  const r1 = await engine.processJob(job1)
  assert.equal(r1.status, "succeeded", JSON.stringify(r1))
  assert.equal(seg.submits, 1)
  assert.match(seg.keys[0]!, /^gen_[0-9a-f]{32}_1$/)
  assert.deepEqual(Object.keys(seg.bodies[0] as object).sort(), ["base64", "category", "cloth_image", "guidance_scale", "model_image", "num_inference_steps", "seed"])
  assert.equal((seg.bodies[0] as { category: string }).category, "Upper body")
  assert.equal(await engine.processJob(job1).then((r) => r.status), "skipped", "finished job reprocessed")
  assert.equal(seg.submits, 1, "duplicate generation")
  const j1 = (await app.inject(`/v1/studio/jobs/${job1}`)).json()
  assert.equal(j1.status, "succeeded"); assert.equal(j1.version, 1)
  const v1 = j1.versionId as string
  const fj = parseJob(j1)
  assert.equal(fj.status, "succeeded"); assert.equal(fj.kind, "generate"); assert.equal(fj.lookId, v1); assert.equal(fj.charged, true)
  const img = await imageOf(v1)
  assert.equal(img.statusCode, 200); assert.equal(img.headers["content-type"], "image/png")
  assert.deepEqual(new Uint8Array(img.rawPayload), outputPng)
  const signed = new URL((await app.inject(`/v1/studio/looks/${v1}`)).json().image.url as string)
  actor = B
  assert.equal((await imageOf(v1)).statusCode, 404, "foreign user read private asset")
  const forged = new URL(signed); forged.searchParams.set("u", B)
  assert.equal((await app.inject(forged.pathname + forged.search)).statusCode, 404, "re-targeted signed link accepted")
  const tampered = new URL(signed); tampered.searchParams.set("s", "A".repeat(43))
  assert.equal((await app.inject(tampered.pathname + tampered.search)).statusCode, 404, "tampered signature accepted")
  assert.equal((await app.inject(`/v1/studio/looks/${v1}`)).statusCode, 404)
  actor = A
  assert.equal(admin(`select status||':'||settled_usd_micros||':'||cost_source||':'||provider_request_id from private.provider_calls where job_id='${job1}'`), "succeeded:58032:computed_from_usage:seg-1")
  assert.equal(admin(`select spent from private.ai_daily_usage where user_id='${A}'`), "1")

  // Frontend contract: multi-piece is refused explicitly, never faked.
  assert.equal((await post("key-multi-0001", { prompt: "look completo", productIds: [P1, P2], referenceIds: [], preferenceId: null, rules: null })).statusCode, 422)

  // 4. Swap the garment through the frontend try-on route (variant resolved: single available).
  const swap = await app.inject({ method: "POST", url: "/v1/studio/try-ons", headers: { "idempotency-key": "key-look-v2-0001" }, payload: { sourceLookId: v1, productIds: [P2] } })
  assert.equal(swap.statusCode, 202, swap.body)
  assert.equal(parseJob(swap.json()).kind, "tryon")
  assert.equal((await engine.processJob(swap.json().id)).status, "succeeded")
  const lineage = parseLooks((await app.inject(`/v1/studio/looks/${v1}/versions`)).json())
  assert.equal(lineage.length, 2)
  assert.equal(lineage[1]!.parentId, v1); assert.equal(lineage[1]!.version, 2); assert.equal(lineage[1]!.origin, "tryon")
  const reopened = parseLook((await app.inject(`/v1/studio/looks/${v1}`)).json())
  assert.equal(reopened.pieces[0]!.product.id, P1); assert.equal(reopened.pieces[0]!.product.name, "Jaqueta fixture A")
  assert.equal(reopened.pieces[0]!.product.links.productUrl, "https://example.com/fx-1")
  assert(reopened.pieces[0]!.warnings.includes("Aparência no render não verificada"), "visual fidelity must not be claimed")
  assert.equal(admin(`select variant_id from private.look_versions where id='${v1}'`), V1)
  assert.equal((await imageOf(v1)).statusCode, 200, "reopening v1 lost its image")
  actor = B
  assert.equal((await post("key-steal-0001", { productId: P2, variantId: V2, parentVersionId: v1 })).statusCode, 403, "foreign parent accepted")
  actor = A

  // 5. Unknown submit outcome: no re-dispatch, quota not spent, reservation kept.
  seg.mode = "submit_timeout"
  const j3 = (await post("key-look-v3-0001", { productId: P1, variantId: V1, parentVersionId: v1 })).json().id as string
  const before = seg.submits
  const r3 = await engine.processJob(j3)
  assert.deepEqual(r3, { status: "failed", code: "provider_outcome_unknown" })
  assert.equal(seg.submits, before + 1, "unknown outcome was resent")
  const j3view = (await app.inject(`/v1/studio/jobs/${j3}`)).json()
  assert.match(j3view.error.message, /Nenhuma moeda foi debitada/)
  assert.equal(admin(`select spent||'/'||reserved from private.ai_daily_usage where user_id='${A}'`), "2/0", "failed job consumed customer quota")
  assert.equal(admin(`select status||':'||coalesce(settled_usd_micros::text,'null') from private.provider_calls where job_id='${j3}'`), "unknown:null", "unknown cost became zero")
  assert.equal(admin("select reserved_usd_micros from private.provider_budget_usage where scope='provider' and period='day' and scope_key='segmind'"), "500000")
  seg.mode = "ok"

  // 6. Paid calls disabled: honest failure, zero provider calls.
  const disabled = createEngine({ db: workerDb, store, segmind: null, config: engineConfig })
  const j4 = (await post("key-look-v4-0001", { productId: P2, variantId: V2 })).json().id as string
  assert.deepEqual(await disabled.processJob(j4), { status: "failed", code: "provider_not_enabled" })
  assert.equal(admin(`select count(*) from private.provider_calls where job_id='${j4}'`), "0")

  // 6b. QA-002: the person removes the photo after asking; the queued job never uses it.
  const j6res = await post("key-look-removed-01", { productId: P1, variantId: V1 })
  assert.equal(j6res.statusCode, 202, j6res.body)
  const j6 = j6res.json().id as string
  admin(`update private.assets set state='deleting' where user_id='${A}' and kind='body_photo'`)
  const beforeRemoved = seg.submits
  // The database fails the queued job at once (trigger) and releases the reservation; it is never dispatched.
  assert.equal(admin(`select status||':'||failure_code from private.ai_jobs where id='${j6}'`), "failed:photo_removed")
  assert.equal(admin(`select reserved from private.ai_daily_usage where user_id='${A}'`), "0", "reservation kept after photo removal")
  assert.deepEqual(await engine.processJob(j6), { status: "skipped" })
  assert.match((await app.inject(`/v1/studio/jobs/${j6}`)).json().error.message, /foi apagada ou trocada/)
  assert.equal(seg.submits, beforeRemoved, "removed photo reached the provider")
  assert.equal(admin(`select count(*) from private.provider_calls where job_id='${j6}'`), "0")
  admin(`update private.assets set state='ready' where user_id='${A}' and kind='body_photo'`)

  // 7. Concurrency cannot bypass the provider budget: two users race for the last slot.
  admin("update private.provider_budget_limits set limit_usd_micros=1200000 where scope='provider' and scope_key='segmind' and period='day'")
  // spent 116064 + unknown reserved 500000 = 616064 -> only one more 500000 reservation fits under 1200000.
  seg.mode = "slow"
  const ja = (await post("key-race-a-0001", { productId: P1, variantId: V1 })).json().id as string
  actor = B
  const jb = (await post("key-race-b-0001", { productId: P2, variantId: V2 })).json().id as string
  actor = A
  await local.put("body-photos", `${B}/front.jpg`, png(8, 10), "image/jpeg")
  const race = await Promise.all([engine.processJob(ja), engine.processJob(jb)])
  const statuses = race.map((r) => r.status === "failed" ? r.code : r.status).sort()
  assert.deepEqual(statuses, ["provider_budget_unavailable", "succeeded"], `race outcome ${JSON.stringify(race)}`)
  assert.equal(admin("select (reserved_usd_micros+spent_usd_micros)<=1200000 from private.provider_budget_usage where scope='provider' and scope_key='segmind' and period='day'"), "t")
  seg.mode = "ok"

  // 8. Cost aggregation across three providers; top-ups never mixed with consumption.
  actor = B // A already used the free daily allowance (3)
  const j5res = await post("key-cost-0001", { productId: P1, variantId: V1 })
  assert.equal(j5res.statusCode, 202, j5res.body)
  const j5 = j5res.json().id as string
  actor = A
  const fence = await workerDb.call("claim_ai_job", j5)
  assert(fence)
  const userRef = "u_" + "ab".repeat(16)
  for (const [provider, model, op, computed] of [["anthropic", "claude-haiku-5-5", "interpretation", "301"], ["gemini", "gemini-embedding-2", "embedding", "120"]] as const) {
    const call: string = await workerDb.call("reserve_provider_call", j5, fence, provider, model, `${provider}-2026-11-20`, op, `${op}_${j5.replace(/-/g, "")}`, "10000", userRef, "test")
    assert(await workerDb.call("begin_provider_call", call, fence))
    assert(await workerDb.call("settle_provider_call", call, "succeeded", `req-${provider}`, { input: 1200, output: 360 }, {}, null, computed, null, "computed_from_usage", 900, null))
  }
  await workerDb.call("fail_look_job", j5, fence, "test_cost_fixture")
  admin("insert into private.provider_credit_topups(provider,paid_amount_minor,paid_currency,credited_usd_micros,fx_rate,fx_source,fx_date,paid_at) values ('segmind',5500,'BRL',10000000,5.5,'fixture rate (not a real quote)','2026-11-20',now())")
  const summary = admin("select provider||'='||sum(settled_usd_micros) from private.provider_cost_summary where environment='test' group by provider order by provider")
  assert.equal(summary.replace(/\s+/g, " "), "anthropic=301 gemini=120 segmind=174096", "aggregate per provider")
  assert.equal(admin("select sum(settled_usd_micros) from private.provider_calls"), String(301 + 120 + 3 * 58032), "top-up leaked into consumption")
  assert.equal(admin("select sum(credited_usd_micros) from private.provider_credit_topups"), "10000000")

  // 9. Telemetry: Langfuse down -> nothing lost or duplicated; up -> each span sent once.
  const exporter = createOtlpExporter({ publicKey: "pk-lf-test", secretKey: "sk-lf-test", baseUrl: "https://cloud.langfuse.test", environment: "test" }, { fetch: lfFetch })
  const pendingBefore = Number(admin("select count(*) from private.telemetry_outbox where state='pending'"))
  assert(pendingBefore >= 8, `expected telemetry events, got ${pendingBefore}`)
  const down = await flushTelemetryOnce(workerDb, exporter, 100)
  assert.equal(down.outcome, "retry")
  assert.equal(admin("select count(*) from private.telemetry_outbox where state='pending'"), String(pendingBefore), "events lost while Langfuse was down")
  admin("update private.telemetry_outbox set next_attempt_at=now()")
  lf.up = true
  const upResult = await flushTelemetryOnce(workerDb, exporter, 100)
  assert.equal(upResult.outcome, "sent")
  await flushTelemetryOnce(workerDb, exporter, 100)
  assert.equal(lf.requests.length, 1, "events resent")
  const sentBody = lf.requests[0]!.body
  const spans = (JSON.parse(sentBody) as { resourceSpans: Array<{ scopeSpans: Array<{ spans: Array<{ spanId: string; attributes: Array<{ key: string; value: { stringValue?: string } }> }> }> }> }).resourceSpans[0]!.scopeSpans[0]!.spans
  assert.equal(new Set(spans.map((s) => s.spanId)).size, spans.length, "duplicate span ids")
  assert.equal(lf.requests[0]!.version, "4")
  for (const forbidden of [A, B, "SG_testdouble", "storage.example.com", "expires=", "sk-lf-test", "@"]) assert(!sentBody.includes(forbidden), `telemetry leaked ${forbidden}`)
  const costs = spans.flatMap((s) => s.attributes).filter((a) => a.key === "langfuse.observation.cost_details").map((a) => a.value.stringValue)
  assert(costs.includes(JSON.stringify({ total: 0.058032 })), `generation cost missing: ${costs.join(",")}`)

  console.log("Motor slice passed: idempotent jobs, single dispatch, user isolation, private assets, v1/v2 lineage, unknown-outcome handling, disabled provider, budget race, 3-provider cost aggregation, telemetry outage/once-only delivery and sanitization.")
} catch (error) {
  // Sanitized: outcome/SQLSTATE and the first stack frames only (no connection strings).
  const detail = error instanceof Error
    ? [error.message, (error as { outcome?: string }).outcome ?? "", (error as { sqlState?: string }).sqlState ?? "", ...(error.stack ?? "").split("\n").slice(1, 4)].join(" ").replaceAll(secret, "***")
    : "unknown"
  console.error(error instanceof assert.AssertionError ? `Motor slice assertion failed: ${error.message}` : `Motor slice test failed: ${detail}`)
  process.exitCode = 1
} finally {
  await Promise.all(clients.map((c) => c.close().catch(() => undefined)))
  if (started && /^stylai-motor-test-[0-9a-f]{8}$/.test(name)) spawnSync("docker", ["rm", "--force", name], { windowsHide: true, stdio: "ignore" })
  rmSync(storeDir, { recursive: true, force: true })
}
