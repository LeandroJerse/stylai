import assert from "node:assert/strict"
import { execFile, spawnSync } from "node:child_process"
import { readdirSync, readFileSync } from "node:fs"
import { randomBytes, randomUUID, createHash } from "node:crypto"
import { prepareRecovery } from "./privacy-recovery.mjs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { setTimeout as delay } from "node:timers/promises"
import { promisify } from "node:util"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const name = `stylai-foundation-test-${randomUUID().slice(0,8)}`
const execFileAsync = promisify(execFile)
function docker(args, options = {}) {
  return spawnSync("docker", args, { cwd: root, encoding: "utf8", windowsHide: true, timeout: 180000, maxBuffer: 2_000_000, ...options })
}
function session(sql) {
  const flags = ["exec", name, "psql", "-XqtA", "-U", "postgres", "-d", "stylai_test", "-v", "ON_ERROR_STOP=1", "-c", sql]
  return execFileAsync("docker", flags, { cwd: root, windowsHide: true, timeout: 15000 })
}

async function verifyConcurrency() {
  const a = "10000000-0000-4000-8000-000000000001"
  const b = "10000000-0000-4000-8000-000000000002"
  const photo = "20000000-0000-4000-8000-000000000001"
  const enqueue = `select private.enqueue_ai_job('${a}','same-key',repeat('a',64),'${photo}','test-tops','test-v1')`
  const jobs = await Promise.allSettled([session(`set role service_role; ${enqueue}; select pg_sleep(0.5)`), session(`set role service_role; ${enqueue}`)])
  for (const job of jobs) if (job.status === "rejected") throw job.reason
  assert.match(jobs[0].value.stdout.trim(), /^[0-9a-f-]{36}$/)
  assert.equal(jobs[0].value.stdout.trim(), jobs[1].value.stdout.trim(), "concurrent enqueue did not reuse the job")
  const pay = (owner, suffix) => `set role service_role; select private.start_order_payment('${owner}','40000000-0000-4000-8000-00000000000${suffix}','pix','sandbox','test-merchant'); select pg_sleep(0.5)`
  const orders = await Promise.allSettled([session(pay(a,1)), session(pay(b,2))])
  assert.equal(orders.filter((order) => order.status === "fulfilled").length, 1, "concurrent orders exceeded shared funding")
  const rejected = orders.find((order) => order.status === "rejected")
  assert.match(rejected.reason.stderr, /procurement funding unavailable/)
  const verified = await session("select (select count(*) from private.ai_jobs), (select reserved from private.ai_daily_usage), (select count(*) from private.orders), (select count(*) from private.payment_attempts), (select reserved_minor from private.procurement_budgets)")
  assert.equal(verified.stdout.trim(), "1|1|1|1|7000", "race left partial or duplicate rows")
  console.log("Multi-session PostgreSQL checks passed: request idempotency and shared procurement funding.")
}
let started = false
async function verifyAffiliateConcurrency() {
  const claim = "select coalesce(private.claim_affiliate_collection('concurrent-collection',600)->>'token','not_claimed')"
  const results = await Promise.all([
    session(`set role stylai_catalog_worker; ${claim}; select pg_sleep(0.3)`),
    session(`set role stylai_catalog_worker; ${claim}`),
  ])
  const claims = results.map((result) => result.stdout.trim())
  assert.equal(claims.filter((token) => /^[0-9a-f-]{36}$/.test(token)).length, 1, "two workers leased the same collection")
  assert.equal(claims.filter((token) => token === "not_claimed").length, 1)
  console.log("Concurrent PostgreSQL checkout gave one worker the affiliate collection.")
}
// Two accounts ask for a two-panel batch at the same time; the shared daily budget fits only one whole batch.
// And one account double-clicks from two connections: one batch.
async function verifyOutfitConcurrency() {
  const users = ["a", "b"].map((x) => `8a000000-0000-4000-8000-00000000000${x}`)
  await session(`delete from private.provider_budget_limits;
    insert into private.provider_budget_limits(scope,scope_key,period,limit_usd_micros) values
      ('global','*','day',10000000),('global','*','month',10000000),('provider','segmind','day',50000),('provider','segmind','month',10000000),('user','*','day',1000000),('job','*','job',60000);
    delete from private.provider_budget_usage;
    insert into public.categories(id,label) values('outfit_sets','Conjuntos') on conflict do nothing;
    insert into public.partners(id,source,external_seller_id,region,name) values('8b000000-0000-4000-8000-000000000001','curated','concurrency-seller','BR','x');
    insert into public.products(id,partner_id,external_product_id,category_id,name,availability,published,rights_cleared) values('8c000000-0000-4000-8000-000000000001','8b000000-0000-4000-8000-000000000001','set-1','outfit_sets','Conjunto','unknown',true,true);
    insert into public.product_variants(id,product_id,external_variant_id,label,available) values('8d000000-0000-4000-8000-000000000001','8c000000-0000-4000-8000-000000000001','v','M',true);
    insert into public.product_images(id,product_id,url,position) values('8e000000-0000-4000-8000-000000000001','8c000000-0000-4000-8000-000000000001','https://upload.example.org/set.jpg',0);
    insert into private.catalog_image_rights(image_id,basis,evidence,try_on_allowed) values('8e000000-0000-4000-8000-000000000001','test_fixture','test',true);`)
  for (const u of users) {
    await session(`insert into auth.users(id) values('${u}'); insert into private.photo_consents(user_id,policy_version) values('${u}','dev-v1');
      insert into private.assets(user_id,kind,state,bucket_id,object_key,bytes,mime,width,height,expires_at,body_angle,validation_status,validator_version,validation)
        values('${u}','body_photo','ready','body-photos','${u}/front.png',10,'image/png',600,900,now()+interval '1 day','front','approved','test+'||private.required_pose_rules(),'{"supports":{"upper":true,"lower":true,"dress":true}}');
      select private.create_outfit_search('${u}','concurrency-key',repeat('1',64),'x','curated',null);
      select private.finish_outfit_search('${u}',(select id from private.outfit_searches where user_id='${u}'),'succeeded',null,'rules_fallback','{}',
        '[{"kind":"bundle","title":"A","pieces":[{"slot":"set","id":"1"}]},{"kind":"bundle","title":"B","pieces":[{"slot":"set","id":"1"}]}]');`)
  }
  const enqueue = (u, key) => `set role stylai_api; select private.enqueue_outfit_render('${u}','${key}',repeat('1',64),'dev-v1','comparison','segmind','flux-3-klein-image-edit',20000,null,'${"$"}panels'); select pg_sleep(0.5)`
  const panels = async (u) => (await session(`select jsonb_agg(jsonb_build_object('set_id',id,'revision',1,'label',title,'items',jsonb_build_array(jsonb_build_object('slot','set','product_id','8c000000-0000-4000-8000-000000000001','variant_id',null,'image_url',null)))) from private.outfit_sets where user_id='${u}'`)).stdout.trim()
  const sql = await Promise.all(users.map(async (u) => enqueue(u, "batch-key-1").replace("$panels", await panels(u))))
  const both = await Promise.allSettled(sql.map(session))
  assert.equal(both.filter((x) => x.status === "fulfilled").length, 1, "two batches exceeded the shared budget")
  assert.match(both.find((x) => x.status === "rejected").reason.stderr, /batch budget/)
  const winner = users[both.findIndex((x) => x.status === "fulfilled")]
  const left = await session("select (select count(*) from private.outfit_renders),(select count(*) from private.ai_jobs where render_id is not null),(select sum(held_usd_micros) from private.outfit_budget_holds),(select reserved_usd_micros from private.provider_budget_usage where scope='provider' and period='day')")
  assert.equal(left.stdout.trim(), "1|2|40000|40000", "a refused batch left rows or money behind")
  await session("delete from private.provider_budget_limits where scope='provider' and period='day'; insert into private.provider_budget_limits(scope,scope_key,period,limit_usd_micros) values('provider','segmind','day',1000000)")
  const loser = users.find((u) => u !== winner)
  const click = enqueue(loser, "double-click").replace("$panels", await panels(loser))
  const clicks = await Promise.all([session(click), session(click)])
  assert.equal(clicks[0].stdout.trim(), clicks[1].stdout.trim(), "double click created two batches")
  // Two workers racing for panels of the same batch: one runs, the other waits.
  const ids = (await session(`select string_agg(id::text,',' order by panel) from private.ai_jobs where user_id='${loser}'`)).stdout.trim().split(",")
  const claims = await Promise.all(ids.map((id) => session(`begin; select coalesce(private.claim_ai_job('${id}')::text,'none'); select pg_sleep(0.3); commit`)))
  assert.equal(claims.filter((x) => x.stdout.includes("none")).length, 1, "two panels of one batch ran together")
  console.log("Outfit concurrency passed: whole-batch budget under race, double click, serialized panels.")
}
async function verifyPrivacyRecovery() {
  const erased = '73000000-0000-4000-8000-000000000001'
  const kept = '73000000-0000-4000-8000-000000000002'
  // Simulate the contents of an older backup before the newer deletion/revocation.
  await session(`insert into auth.users(id) values ('${erased}'),('${kept}');`)
  const now = Date.now()
  const bytes = Buffer.from(JSON.stringify({ version: 1, exportedAt: new Date(now).toISOString(), accountIds: [erased], tiktokBlocked: true }))
  const hash = createHash('sha256').update(bytes).digest('hex')
  const recovery = prepareRecovery({ bytes, expectedSha256: hash, snapshotCreatedAt: new Date(now-86400000).toISOString(), nowMs: now })
  await assert.rejects(session(recovery.releaseGateSql), /Command failed/)
  await session(recovery.replaySql)
  await assert.rejects(session(recovery.releaseGateSql), /Command failed/)
  await session(`select private.complete_pilot_account_deletion(id,'${hash}') from private.deletion_requests where user_id='${erased}';`)
  await session(recovery.releaseGateSql)
  const verified = await session(`select exists(select 1 from auth.users where id='${kept}'),not private.tiktok_access_allowed(), (private.export_privacy_recovery_journal()->'accountIds') @> '["${erased}"]'::jsonb;`)
  assert.equal(verified.stdout.trim(), 't|t|t')
  await session(`delete from auth.users where id='${kept}';`)
  console.log('Privacy recovery assertions passed: old identity blocked, deletion replayed, other user preserved, TikTok stays revoked.')
}
try {
  const run = docker(["run", "--rm", "--detach", "--network", "none", "--name", name, "-e", "POSTGRES_PASSWORD", "-e", "POSTGRES_DB=stylai_test", "postgres:17-alpine"], { env: { ...process.env, POSTGRES_PASSWORD: randomBytes(24).toString("hex") } })
  if (run.status !== 0) throw new Error("Cannot start isolated PostgreSQL test container. Start Docker; no hosted DB was touched.\n" + (run.stderr ?? ""))
  started = true
  let ready = false
  for (let i=0; i<60; i++) {
    // The image starts a temporary socket-only server during initialization.
    if (docker(["exec", name, "pg_isready", "-h", "127.0.0.1", "-U", "postgres", "-d", "stylai_test"]).status === 0) { ready = true; break }
    await delay(500)
  }
  if (!ready) throw new Error("Isolated database did not become ready")
  const migrations = readdirSync(resolve(root, "supabase/migrations"))
    .filter((file) => /^\d{14}_.+\.sql$/.test(file)).sort()
    .map((file) => `supabase/migrations/${file}`)
  const files = ["supabase/tests/bootstrap-postgres.sql", ...migrations, "supabase/tests/affiliate-catalog.sql", "supabase/tests/foundation.sql", "supabase/tests/domain.sql", "supabase/tests/commerce.sql", "supabase/tests/server-boundary.sql", "supabase/tests/motor-slice.sql", "supabase/tests/studio-journey.sql", "supabase/tests/composition.sql", "supabase/tests/source-references.sql", "supabase/tests/layer-budget.sql", "supabase/tests/outfits.sql", "supabase/tests/pilot-budget.sql", "supabase/tests/privacy-completion.sql", "supabase/tests/concurrency-fixtures.sql", "supabase/tests/pilot-budget.sql"]
  const input = files.map((file) => readFileSync(resolve(root,file), "utf8")).join("\n")
  const test = docker(["exec", "-i", name, "psql", "-U", "postgres", "-d", "stylai_test", "-v", "ON_ERROR_STOP=1"], { input })
  if (test.status !== 0) throw new Error("Migration/RLS assertion failed:\n" + test.stderr)
  console.log(test.stdout.split("\n").filter((line) => line.includes("assertions passed")).join("\n"))
  await verifyConcurrency()
  await verifyAffiliateConcurrency()
  await verifyOutfitConcurrency()
  await verifyPrivacyRecovery()
  console.log("Real PostgreSQL 17 role, RLS and transaction tests passed using Auth/Storage compatibility fixtures.")
} catch (error) {
  console.error(error instanceof Error ? error.message : "Database test failed")
  process.exitCode = 1
} finally {
  if (started && /^stylai-foundation-test-[0-9a-f]{8}$/.test(name)) {
    const cleanup = docker(["rm", "--force", name])
    if (cleanup.status !== 0) { console.error("Test container cleanup failed:", name); process.exitCode = 1 }
  }
}

