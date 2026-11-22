// Credential check using ONLY free, documented, read-only endpoints. Prints
// presence/validity booleans and sanitized status codes, never key values.
//   Anthropic: GET /v1/models (SDK models.list)
//   Gemini:    GET https://generativelanguage.googleapis.com/v1beta/models
//   Segmind:   GET https://api.segmind.com/v1/get-user-credits
//   Langfuse:  GET {LANGFUSE_BASE_URL}/api/public/projects
import Anthropic from "@anthropic-ai/sdk"

type Row = { provider: string; configured: boolean; valid: boolean | null; detail: string }
const rows: Row[] = []
const env = process.env
const timeout = () => AbortSignal.timeout(10_000)

async function check(provider: string, key: string | undefined, run: () => Promise<{ valid: boolean; detail: string }>) {
  if (!key) { rows.push({ provider, configured: false, valid: null, detail: "variável ausente" }); return }
  try { rows.push({ provider, configured: true, ...(await run()) }) }
  catch (error) { rows.push({ provider, configured: true, valid: false, detail: `erro de rede (${error instanceof Error ? error.name : "unknown"})` }) }
}

await check("anthropic", env.ANTHROPIC_API_KEY, async () => {
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 0, timeout: 10_000 })
  try {
    const page = await client.models.list({ limit: 50 })
    const ids = page.data.map((m) => m.id)
    return { valid: true, detail: `modelos listados; claude-haiku-5-5 ${ids.includes("claude-haiku-5-5") ? "disponível" : "não listado"}. Workspace NÃO verificável com chave comum (confira no Console)` }
  } catch (error) {
    const status = error instanceof Anthropic.APIError ? error.status : undefined
    return { valid: false, detail: `HTTP ${status ?? "?"}` }
  }
})

await check("gemini", env.GEMINI_API_KEY, async () => {
  const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200", { headers: { "x-goog-api-key": env.GEMINI_API_KEY! }, signal: timeout() })
  if (!response.ok) return { valid: false, detail: `HTTP ${response.status}` }
  const body = await response.json() as { models?: Array<{ name: string }> }
  const names = (body.models ?? []).map((m) => m.name)
  const want = ["models/gemini-embedding-2", "models/gemini-3.1-flash-image"]
  return { valid: true, detail: want.map((w) => `${w.slice(7)} ${names.includes(w) ? "listado" : "não listado"}`).join("; ") }
})

await check("segmind", env.SEGMIND_API_KEY, async () => {
  const response = await fetch("https://api.segmind.com/v1/get-user-credits", { headers: { "x-api-key": env.SEGMIND_API_KEY! }, signal: timeout() })
  if (!response.ok) return { valid: false, detail: `HTTP ${response.status}` }
  const body = await response.json() as { credits?: number; "free-credits"?: number }
  return { valid: true, detail: `créditos=${body.credits ?? "?"} grátis=${body["free-credits"] ?? "?"}; SEGMIND_MODEL=${env.SEGMIND_MODEL === "try-on-diffusion" ? "try-on-diffusion" : env.SEGMIND_MODEL ? "outro valor" : "ausente"}` }
})

await check("langfuse", env.LANGFUSE_SECRET_KEY && env.LANGFUSE_PUBLIC_KEY && env.LANGFUSE_BASE_URL ? "set" : undefined, async () => {
  const base = new URL(env.LANGFUSE_BASE_URL!).origin
  const auth = Buffer.from(`${env.LANGFUSE_PUBLIC_KEY}:${env.LANGFUSE_SECRET_KEY}`).toString("base64")
  const response = await fetch(`${base}/api/public/projects`, { headers: { Authorization: `Basic ${auth}` }, signal: timeout() })
  return { valid: response.ok, detail: `HTTP ${response.status}; host=${new URL(base).hostname}` }
})

for (const name of ["TELEMETRY_PSEUDONYM_KEY", "STYLAI_AI_WORKER_DATABASE_URL", "STYLAI_API_DATABASE_URL", "STYLAI_PAID_CALLS_ENABLED"]) {
  rows.push({ provider: name, configured: Boolean(env[name]), valid: null, detail: name === "STYLAI_PAID_CALLS_ENABLED" ? `paid=${env[name] === "true"}` : "presença apenas" })
}
console.table(rows)
