// READ-ONLY: which quality fields (rating, sales) real AliExpress listings carry and how titles are classified.
// Free product.query only (no link.generate, no model, no generation), at most 2 keywords. Every call takes a slot of the
// same database counters the API uses (60/min, 5000/day). Credentials come from the protected store of the local runtime
// and stay in this process. Prints counts, percentages and short public titles; never keys, signatures or payloads.
//   node --conditions=development --import tsx scripts/diagnose-aliexpress-quality.mjs "camiseta" "short"
import { spawnSync } from "node:child_process"
import { createAliExpressAffiliateClient, normalizeAliExpressProduct } from "@stylai/commerce"
import { outfitSlotOfCategory } from "@stylai/contracts"
import { loadAliExpressEnvironment } from "./aliexpress-runtime.mjs"

const keywords = process.argv.slice(2).map((k) => k.trim()).filter(Boolean)
if (!keywords.length || keywords.length > 2) { console.log("Informe 1 ou 2 palavras-chave."); process.exit(2) }
const slot = (sql) => {
  const r = spawnSync("docker", ["exec", "-i", "supabase_db_stylai-local", "psql", "-XqtA", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1"], { input: sql, encoding: "utf8", windowsHide: true })
  return r.status === 0 && r.stdout.trim().split("\n").every((x) => x.trim() === "t")
}
const acquire = async () => slot("select private.take_provider_call_slot('aliexpress',60); select private.take_provider_daily_slot('aliexpress',5000);")
const env = loadAliExpressEnvironment()
const client = createAliExpressAffiliateClient({ appKey: env.ALIEXPRESS_APP_KEY, appSecret: env.ALIEXPRESS_APP_SECRET, trackingId: null, timeoutMs: 15_000, acquire })
const pct = (n, total) => `${n}/${total}`
for (const keyword of keywords) {
  const r = await client.queryProducts({ keywords: keyword, pageSize: 50 })
  if (!r.ok) { console.log(`"${keyword}": ${r.kind} ${r.code ?? ""}`); continue }
  const items = r.products.map((raw) => ({ raw, n: normalizeAliExpressProduct(raw, new Date().toISOString()) })).filter((x) => x.n.accepted)
  const ratings = items.map((x) => x.n.item.ratingPercent).filter((x) => x !== null).sort((a, b) => a - b)
  const sales = items.map((x) => x.n.item.recentSales).filter((x) => x !== null).sort((a, b) => a - b)
  const bad = r.products.map((p) => p.evaluateRate).filter((v) => v !== null && v !== undefined && !/%$/.test(v)).slice(0, 3)
  console.log(`"${keyword}": ${r.products.length} anúncios · nota ${pct(ratings.length, items.length)} (mín ${ratings[0]}, mediana ${ratings[ratings.length >> 1]}) · vendas ${pct(sales.length, items.length)} (mín ${sales[0]}, mediana ${sales[sales.length >> 1]}, máx ${sales.at(-1)}) · nota em outro formato: ${JSON.stringify(bad)}`)
  const byCategory = {}
  for (const x of items) { const c = `${x.n.item.category}→${outfitSlotOfCategory(x.n.item.category) ?? "-"}`; byCategory[c] = (byCategory[c] ?? 0) + 1 }
  console.log("  classificação:", JSON.stringify(byCategory))
  for (const x of items.slice(0, 14)) console.log(`  ${x.n.item.category.padEnd(14)} cat2=${x.raw.secondLevelCategoryName} · ${x.raw.title.slice(0, 80)}`)
}
