// READ-ONLY and free: can our key read the Segmind request history, and what does it say? Credits are read before and
// after, to show that asking costs nothing. The key is picked by NAME from the workspace .env.local (same mechanism of
// start-pilot), used only in this process and sent only to Segmind hosts. Prints outcome fields; never the key, prompts,
// images or URLs.   node scripts/diagnose-segmind-history.mjs [flux-3-klein-image-edit]
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { parseEnv } from "node:util"

const key = parseEnv(readFileSync(resolve(import.meta.dirname, "../../.env.local"), "utf8")).SEGMIND_API_KEY
if (!key) { console.log("SEGMIND_API_KEY ausente"); process.exit(2) }
const model = process.argv[2] ?? "flux-3-klein-image-edit"
const get = async (url) => {
  const u = new URL(url)
  if (u.protocol !== "https:" || !["api.segmind.com", "api.spotprod.segmind.com"].includes(u.hostname)) throw new Error("host not allowed")
  const r = await fetch(u, { headers: { "x-api-key": key, Accept: "application/json" }, redirect: "error", signal: AbortSignal.timeout(20_000) })
  const text = await r.text()
  try { return { status: r.status, body: JSON.parse(text) } } catch { return { status: r.status, body: null } }
}
const credits = async () => (await get("https://api.segmind.com/v1/get-user-credits")).body?.credits
const day = (offset) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10)
const before = await credits()
const r = await get(`https://api.spotprod.segmind.com/inference-request/request-history?${new URLSearchParams({ model_name: model, from_date: day(-1), to_date: day(0), per_page: "20", page: "1", sort_by: "model_created", sort_order: "desc" })}`)
console.log(`HTTP ${r.status} · créditos antes ${before} · depois ${await credits()}`)
if (!r.body?.data) { console.log("resposta sem lista; campos:", Object.keys(r.body ?? {})); process.exit(0) }
const type = (v) => (v === null ? "null" : Array.isArray(v) ? "array" : typeof v)
console.log("total", r.body.total_records, "· campos:", Object.entries(r.body.data[0] ?? {}).map(([k, v]) => `${k}:${type(v)}`).join(" "))
for (const row of r.body.data) {
  const request = row.request_body && typeof row.request_body === "object" ? row.request_body : null
  console.log(JSON.stringify({
    id: String(row.request_id ?? "").slice(0, 12), idLen: String(row.request_id ?? "").length, cost: row.credits_deduction, created: row.model_created ?? row.created_at ?? null, latency: row.latency_ms ?? row.inference_time ?? null,
    initiator: row.initiator, code: row.response_code, modelStatus: row.model_status, family: row.error_family, billing: row.billing_type, started: row.model_start_ts, finished: row.model_finish_ts, hasOutput: Boolean(row.generation_url), error: row.error ? (typeof row.error === "object" ? Object.keys(row.error) : String(row.error).slice(0, 90)) : null,
    request: request ? Object.entries(request).map(([k, v]) => `${k}:${type(v)}${Array.isArray(v) ? `(${v.length})` : ""}`) : `${type(row.request_body)}(${String(row.request_body ?? "").length})`,
  }))
}
