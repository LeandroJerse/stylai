// Local development database on the Supabase CLI stack (Auth + Storage + Postgres).
// Prerequisite: `bun run supabase:start` (applies every migration). This script then:
//   - enables the restricted roles stylai_api / stylai_ai_worker with YOUR password (never printed);
//   - sets small, explicit provider spend limits (USD micros);
//   - loads catalog rows: --catalog <curated.json> (real, rights evidence required)
//     and/or --fixtures (synthetic TEST items, flagged fixture=true, no real offer).
// Usage:  STYLAI_DEV_DB_PASSWORD=... bun run db:dev [--catalog path.json] [--fixtures]
//         --fixtures --edge-cases also loads the synthetic edge cases used by automated tests
//         bun run db:dev -- --plan <email> paid|free   (local test plan: 120 or 30 moedas/day; no password needed)
// It never touches a hosted project: it only talks to the local container.
import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { z } from "zod"
import { testCatalogItems, TEST_IMAGE_ORIGIN, type NormalizedCatalogItem } from "../packages/contracts/src/catalog-source.js"

const container = process.env.STYLAI_SUPABASE_DB_CONTAINER ?? "supabase_db_stylai-local"
const password = process.env.STYLAI_DEV_DB_PASSWORD ?? ""
const args = process.argv.slice(2)
// "--plan" alone only changes an account's local plan: roles, limits and catalog are left untouched.
const planOnly = args[0] === "--plan" && !args.includes("--fixtures") && !args.includes("--catalog")
if (!planOnly && !/^[A-Za-z0-9_-]{16,128}$/.test(password)) throw new Error("Set STYLAI_DEV_DB_PASSWORD (16+ chars, letters/digits/_/-) in your shell")
const option = (flag: string) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined }

function sql(text: string): string {
  const r = spawnSync("docker", ["exec", "-i", container, "psql", "-XqtA", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1"],
    { encoding: "utf8", windowsHide: true, input: text, timeout: 120000, maxBuffer: 4_000_000 })
  if (r.status !== 0) throw new Error(`psql failed: ${(r.stderr ?? "").replaceAll(password, "***").slice(0, 400)}`)
  return r.stdout.trim()
}
const lit = (v: string | number | boolean | null) => v === null ? "null" : typeof v === "number" ? String(v) : typeof v === "boolean" ? String(v) : `'${v.replaceAll("'", "''")}'`

if (sql("select to_regclass('private.catalog_image_rights') is not null") !== "t") {
  throw new Error("Local schema is not at 20261120000200. Run `bun run supabase:start` (or `bun run db:migrate:local`).")
}
if (!planOnly) for (const role of ["stylai_api", "stylai_ai_worker"]) sql(`alter role ${role} login password ${lit(password)};`)
if (!planOnly) sql(`
  insert into private.provider_budget_limits(scope,scope_key,period,limit_usd_micros) values
    ('global','*','day',1000000),('global','*','month',5000000),
    ('provider','segmind','day',1000000),('provider','segmind','month',5000000),
    ('provider','anthropic','day',500000),('provider','anthropic','month',5000000),
    ('provider','gemini','day',500000),('provider','gemini','month',2000000),
    ('user','*','day',1000000),('job','*','job',600000)
  on conflict (scope,scope_key,period) do nothing;
`)

const entry = z.object({
  source: z.enum(["curated", "shein"]), seller: z.string().min(1).max(80),
  externalProductId: z.string().min(1).max(120), externalVariantId: z.string().min(1).max(120),
  category: z.string().regex(/^[a-z][a-z0-9_-]{1,40}$/), categoryLabel: z.string().max(60).optional(),
  name: z.string().min(1).max(160), variantLabel: z.string().min(1).max(40),
  priceMinor: z.number().int().nonnegative().nullable(), currency: z.string().regex(/^[A-Z]{3}$/).default("BRL"),
  priceObservedAt: z.string().datetime().nullable().optional(),
  productUrl: z.string().url().startsWith("https://").nullable(),
  imageUrl: z.string().url().startsWith("https://"),
  rights: z.object({ basis: z.enum(["owner_authorized", "licensed", "test_fixture"]), evidence: z.string().min(3).max(500), tryOnAllowed: z.boolean() }),
  fixture: z.boolean().default(false),
  variantAvailable: z.boolean().optional(),
  sellerName: z.string().max(80).optional(),
})
type Entry = z.infer<typeof entry>

// Synthetic TEST catalog, through the same connector boundary future store connectors will use.
// Images are own illustrations served by the API (reserved .invalid host in the table, see catalog-source.ts).
async function testCatalogEntries(edgeCases: boolean): Promise<Entry[]> {
  // Main test catalog; --edge-cases adds the synthetic failure/no-price/display-only/sold-out items (tests only).
  const items = testCatalogItems({ edgeCases })
  return items.flatMap((i: NormalizedCatalogItem) => i.variants.map((v) => ({
    source: i.source as Entry["source"], seller: i.seller, externalProductId: i.externalProductId, externalVariantId: v.externalVariantId,
    category: i.category, categoryLabel: i.categoryLabel, name: i.name, variantLabel: v.label, variantAvailable: v.available === true,
    sellerName: i.sellerName, priceMinor: i.priceMinor, currency: i.currency, priceObservedAt: i.priceObservedAt, productUrl: i.productUrl,
    imageUrl: TEST_IMAGE_ORIGIN + i.image, rights: i.rights, fixture: i.fixture,
  })))
}

function upsert(r: Entry) {
  const product = `(select p.id from public.products p join public.partners pa on pa.id=p.partner_id
    where pa.source=${lit(r.source)} and pa.external_seller_id=${lit(r.seller)} and pa.region='BR' and p.external_product_id=${lit(r.externalProductId)})`
  sql(`
    insert into public.categories(id,label) values (${lit(r.category)},${lit(r.categoryLabel ?? r.category)}) on conflict (id) do nothing;
    insert into public.partners(source,external_seller_id,region,name) values (${lit(r.source)},${lit(r.seller)},'BR',${lit(r.sellerName ?? (r.fixture ? "Loja de teste" : r.seller))}) on conflict do nothing;
    insert into public.products(partner_id,external_product_id,category_id,name,price_minor,currency,product_url,availability,published,rights_cleared,fixture,source_updated_at)
      select id,${lit(r.externalProductId)},${lit(r.category)},${lit(r.name)},${r.priceMinor === null ? "null" : r.priceMinor},${lit(r.currency)},${lit(r.productUrl)},
        'unknown',true,true,${lit(r.fixture)},${r.priceObservedAt ? lit(r.priceObservedAt) : "null"}
      from public.partners where source=${lit(r.source)} and external_seller_id=${lit(r.seller)} and region='BR'
      on conflict (partner_id,external_product_id) do update set name=excluded.name,price_minor=excluded.price_minor,currency=excluded.currency,
        product_url=excluded.product_url,fixture=excluded.fixture,source_updated_at=excluded.source_updated_at,published=true;
    insert into public.product_variants(product_id,external_variant_id,label,available)
      select ${product},${lit(r.externalVariantId)},${lit(r.variantLabel)},${lit(r.variantAvailable ?? true)}
      on conflict (product_id,external_variant_id) do update set label=excluded.label,available=excluded.available;
    insert into public.product_images(product_id,url,position,alt) select ${product},${lit(r.imageUrl)},0,${lit(r.name)}
      on conflict (product_id,position) do update set url=excluded.url,alt=excluded.alt;
    insert into private.catalog_image_rights(image_id,basis,evidence,try_on_allowed)
      select i.id,${lit(r.rights.basis)},${lit(r.rights.evidence)},${lit(r.rights.tryOnAllowed)} from public.product_images i where i.product_id=${product} and i.position=0
      on conflict (image_id) do update set basis=excluded.basis,evidence=excluded.evidence,try_on_allowed=excluded.try_on_allowed,recorded_at=now();
  `)
}

const catalogPath = option("--catalog")
if (catalogPath) {
  const rows = z.array(entry).parse(JSON.parse(readFileSync(resolve(catalogPath), "utf8")))
  for (const r of rows) {
    if (r.fixture || r.rights.basis === "test_fixture") throw new Error("Use --fixtures for test data; --catalog is for real, rights-cleared items")
    upsert(r)
  }
  console.log(`Curated catalog rows upserted: ${rows.length}.`)
}
if (args.includes("--fixtures")) {
  const rows = await testCatalogEntries(args.includes("--edge-cases"))
  for (const r of rows) upsert(r)
  // Earlier fixture rows that are not part of the test catalog stop being published (kept for old versions).
  const ids = [...new Set(rows.map((r) => r.externalProductId))].map(lit).join(",")
  sql(`update public.products set published=false where fixture and external_product_id not in (${ids});`)
  console.log(`Test catalog upserted: ${new Set(rows.map((r) => r.externalProductId)).size} products, ${rows.length} variants (fixture=true, synthetic).`)
}

// Local plan for an account (sandbox membership, local container only): --plan <email> paid|free
const planEmail = option("--plan")
if (planEmail) {
  const plan = args[args.indexOf("--plan") + 2]
  if (plan !== "paid" && plan !== "free") throw new Error("Use --plan <email> paid|free")
  const user = sql(`select id from auth.users where email=${lit(planEmail)}`)
  if (!/^[0-9a-f-]{36}$/.test(user)) throw new Error("Account not found in the local Auth")
  if (plan === "paid") {
    sql(`
      insert into private.settings_versions(kind,scope,version,payload,effective_at,reason)
        values ('membership','local-test',1,'{"coins_per_day":120,"local_test":true}'::jsonb,now(),'Plano pago de TESTE local (sem cobrança)')
        on conflict (kind,scope,version) do nothing;
      insert into private.ai_memberships(user_id,plan_version_id,environment,merchant_ref,provider_subscription_id,provider_payment_id,valid_from,valid_until)
        select ${lit(user)},(select id from private.settings_versions where kind='membership' and scope='local-test' and version=1),
          'sandbox','local-test','local-test-'||${lit(user)},'local-test-'||${lit(user)}||'-'||extract(epoch from now())::bigint,now(),now()+interval '30 days';`)
  } else {
    sql(`update private.ai_memberships set revoked_at=now() where user_id=${lit(user)} and revoked_at is null and merchant_ref='local-test';`)
  }
  console.log(`Local plan for that account: ${plan === "paid" ? "Pago (120 moedas/dia)" : "Gratuito (30 moedas/dia)"}. Usage already spent today is kept.`)
}

if (!planOnly) console.log(sql(`select 'published products='||count(*)||' (fixtures='||count(*) filter (where fixture)||')' from public.products where published and rights_cleared`))
if (!planOnly) console.log("Restricted roles enabled on 127.0.0.1:54322/postgres. Connection strings (fill in your password yourself):")
if (!planOnly) console.log("  apps/api/.env.local    STYLAI_API_DATABASE_URL=postgres://stylai_api:<password>@127.0.0.1:54322/postgres")
if (!planOnly) console.log("  apps/worker/.env.local STYLAI_AI_WORKER_DATABASE_URL=postgres://stylai_ai_worker:<password>@127.0.0.1:54322/postgres")
