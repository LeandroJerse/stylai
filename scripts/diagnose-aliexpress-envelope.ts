/**
 * READ-ONLY diagnosis of the AliExpress product.query business envelope (P06). Free catalog calls only:
 * no link.generate, no LLM, no generation. At most 4 queries, spaced by --spacing seconds (default 20), no retry.
 * Prints per query: sanitized resp_code / resp_msg, request id, product counts, latency. Never prints the key,
 * signature, tracking id or raw payload. Credentials come from the process environment
 * (docs/security/adequacao/Invoke-AliExpressCheck.ps1 -Diagnose).
 *
 *   node --conditions=development --import tsx scripts/diagnose-aliexpress-envelope.ts --spacing 20 -- "kw one" "kw two"
 */
import { createAliExpressAffiliateClient } from "@stylai/commerce"

const MAX_QUERIES = 4

async function main() {
  const args = process.argv.slice(2)
  const sep = args.indexOf("--")
  const flags = sep >= 0 ? args.slice(0, sep) : args
  const keywords = (sep >= 0 ? args.slice(sep + 1) : []).map((k) => k.trim()).filter(Boolean)
  const spacingIndex = flags.indexOf("--spacing")
  const spacingSeconds = spacingIndex >= 0 ? Number(flags[spacingIndex + 1]) : 20
  if (!keywords.length || keywords.length > MAX_QUERIES) { console.log(`Informe de 1 a ${MAX_QUERIES} palavras-chave após --`); process.exitCode = 2; return }
  if (!Number.isFinite(spacingSeconds) || spacingSeconds < 5 || spacingSeconds > 120) { console.log("--spacing entre 5 e 120 s"); process.exitCode = 2; return }
  const appKey = process.env.ALIEXPRESS_APP_KEY?.trim(), appSecret = process.env.ALIEXPRESS_APP_SECRET?.trim()
  if (!appKey || !appSecret) { console.log("Credenciais ausentes (nenhuma chamada feita)."); process.exitCode = 2; return }
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0") { console.log("TLS desativado: recusado."); process.exitCode = 2; return }
  // Tracking id deliberately NOT sent: product.query does not need it and the envelope is what we diagnose.
  const client = createAliExpressAffiliateClient({ appKey, appSecret, trackingId: null, timeoutMs: 15_000 })
  console.log(`Diagnóstico read-only: ${keywords.length} chamada(s) product.query, espaçamento ${spacingSeconds}s, page_size 5, BRL/PT/BR, sem link.generate.`)
  for (let i = 0; i < keywords.length; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, spacingSeconds * 1000))
    const started = Date.now()
    const r = await client.queryProducts({ keywords: keywords[i]!, pageSize: 5 })
    const ms = Date.now() - started
    const at = new Date().toISOString()
    if (r.ok) console.log(`#${i + 1} ${at} "${keywords[i]}" -> ok resp_code=200 produtos=${r.products.length} total_record_count=${r.totalRecordCount ?? "n/d"} request_id=${r.requestId ?? "n/d"} ${ms}ms`)
    else console.log(`#${i + 1} ${at} "${keywords[i]}" -> ${r.kind} code=${r.code ?? "n/d"} resp_msg=${JSON.stringify(r.message ?? null)} request_id=${r.requestId ?? "n/d"} ${ms}ms`)
  }
}

await main()
