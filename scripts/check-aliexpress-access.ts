/**
 * Read-only diagnostic for the AliExpress Affiliates API. Never prints the App Secret, signatures,
 * tracking ID, affiliate links or raw provider payloads.
 *
 * Usage (credentials only in the process environment; no .env file is read or written):
 *   node --conditions=development --import tsx scripts/check-aliexpress-access.ts
 *   node --conditions=development --import tsx scripts/check-aliexpress-access.ts --live "vestido"
 * Operator path with the DPAPI-protected secret: docs/security/adequacao/Invoke-AliExpressCheck.ps1.
 *
 * `--live` makes exactly ONE signed aliexpress.affiliate.product.query call (page 1, 5 items, no retry,
 * no pagination, redirects refused by the client). ALIEXPRESS_TRACKING_ID is optional for this method.
 */
import { createAliExpressCatalogConnector, createAliExpressAffiliateClient, signAliExpressRequest, AliExpressCatalogError } from "@stylai/commerce"

const PAGE_SIZE = 5

/** Product page without query/hash, so no tracking or session parameters are ever printed. */
function publicProductUrl(raw: string | null): string {
  if (!raw) return "n/d"
  try {
    const url = new URL(raw)
    return `${url.origin}${url.pathname}`
  } catch { return "n/d" }
}

/** Provider text is printed only after stripping control characters (no terminal escape injection). */
const printable = (value: string, max: number) => value.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").slice(0, max)

const FAILURE_MEANING: Record<string, string> = {
  provider_error: "o gateway recusou a requisição (camada de assinatura/app/permissão/parâmetros); autenticação ou permissão NÃO comprovadas",
  business_error: "a API de negócio respondeu (resp_result), o que indica assinatura e acesso ao método aceitos pelo gateway (inferência estrutural); resp_code de negócio não documentado na página do método",
  http: "HTTP diferente de 2xx; nada comprovado",
  network: "rede/timeout/redirecionamento recusado; nada comprovado",
  invalid_response: "resposta não reconhecida; nada comprovado",
  configuration: "configuração local incompleta; nenhuma chamada feita",
}

async function main() {
  const args = process.argv.slice(2)
  const live = args.includes("--live")
  const keywords = args.filter((arg) => arg !== "--live").join(" ").trim() || "vestido"

  // Official vector, docId=1385 (App Secret "helloworld").
  const vector = signAliExpressRequest({ app_key: "12345678", code: "3_500102_JxZ05Ux3cnnSSUm6dCxYg6Q26", sign_method: "sha256", timestamp: "1517820392000" }, "helloworld", "/auth/token/create")
  const vectorOk = vector === "35607762342831B6A417A0DED84B79C05FEFBF116969C48AD6DC00279A9F4D81"
  console.log(`Assinatura (vetor oficial): ${vectorOk ? "ok" : "FALHOU"}`)
  if (!vectorOk) { process.exitCode = 1; return }

  const appKey = process.env.ALIEXPRESS_APP_KEY?.trim() || null
  const appSecret = process.env.ALIEXPRESS_APP_SECRET?.trim() || null
  const trackingId = process.env.ALIEXPRESS_TRACKING_ID?.trim() || null
  for (const [name, value] of [["ALIEXPRESS_APP_KEY", appKey], ["ALIEXPRESS_APP_SECRET", appSecret], ["ALIEXPRESS_TRACKING_ID", trackingId]] as const) {
    console.log(`${name}: ${value ? "configurado" : "ausente"}${name === "ALIEXPRESS_TRACKING_ID" ? " (opcional para product.query; obrigatório para links de afiliado)" : ""}`)
  }
  if (!live) { console.log("Sem --live: nenhuma chamada ao AliExpress foi feita."); return }
  if (!appKey || !appSecret) { console.log("Chamada real não feita: App Key/App Secret ausentes."); process.exitCode = 2; return }
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0") { console.log("Chamada real recusada: verificação TLS desativada (NODE_TLS_REJECT_UNAUTHORIZED=0)."); process.exitCode = 2; return }

  const client = createAliExpressAffiliateClient({ appKey, appSecret, trackingId, timeoutMs: 15_000 })
  const connector = createAliExpressCatalogConnector({ client, keywords, pageSize: PAGE_SIZE })
  console.log(`Chamadas reais nesta execução: 1 (aliexpress.affiliate.product.query, keywords="${keywords}", page_size=${PAGE_SIZE}, BRL/PT/BR)`)
  try {
    const page = await connector.page(null)
    const total = page.items.length + page.rejectedCount
    console.log(`Resultado: HTTP 200, resp_code=200. request_id=${page.requestId ?? "n/d"}`)
    console.log("Autenticação (assinatura App Key/App Secret): ACEITA")
    console.log("Permissão para product.query: ACEITA")
    console.log(total === 0 ? "Consulta válida SEM produtos (não comprova recuperação de produtos)." : `Produtos recebidos: ${total} (normalizados=${page.items.length}, rejeitados=${page.rejectedCount})`)
    for (const item of page.items) {
      const price = item.priceMinor === null ? "n/d" : (item.priceMinor / 100).toFixed(2)
      console.log(`- id=${item.externalProductId} | ${printable(item.name, 80)} | ${price} ${item.currency} | ${publicProductUrl(item.productUrl)} | aiTryOn=${item.capabilities.aiTryOn}`)
    }
    if (page.items.length) console.log("Confira manualmente um preço na página do produto antes de considerar a unidade de preço validada.")
  } catch (error) {
    const known = error instanceof AliExpressCatalogError
    console.log(`Chamada real FALHOU: tipo=${known ? error.kind : "unexpected"} código=${known ? error.code ?? "n/d" : "n/d"}`)
    console.log(`Interpretação: ${known ? FAILURE_MEANING[error.kind] ?? "não classificada" : "erro inesperado; nada comprovado"}`)
    process.exitCode = 3
  }
}

await main()
