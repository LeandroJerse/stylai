// P02: pure planner for a reproducible LOCAL pilot runtime (no .env edits, no seed/reset, no printed values).
// Reads ONLY allow-listed names from the workspace-root env file and gives each process only what it needs:
// Segmind/pilot/relay -> worker; composer (Anthropic) + catalog -> API. Everything else is ignored.
const CATALOGS = new Set(["test_catalog", "curated_pilot", "aliexpress_affiliate", "tiktok_shop"])

/** @param {{ argv: string[], rootEnv: Record<string, string | undefined> }} input */
export function planPilotRuntime({ argv, rootEnv }) {
  const flag = (name) => argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`))
  const value = (name) => { const f = flag(name); return f && f.includes("=") ? f.slice(f.indexOf("=") + 1).trim() : null }
  const errors = []
  const real = Boolean(flag("real"))
  const provider = value("provider") ?? "segmind"
  const googleBackend = value("google-backend") ?? "developer"
  const googleProject = value("google-project")
  const vertex = provider === "gemini" && googleBackend === "vertex"
  if(!["developer","vertex"].includes(googleBackend)) errors.push("unknown Google backend")
  if(googleBackend === "vertex" && provider !== "gemini") errors.push("Vertex requires --provider=gemini")
  if(vertex && (!googleProject || !/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(googleProject))) errors.push("Vertex requires valid --google-project")
  const googleKey = vertex ? rootEnv.VERTEX_API_KEY : rootEnv.GEMINI_API_KEY
  const googleConfig = provider === "gemini" ? {STYLAI_GOOGLE_BACKEND:googleBackend,...(vertex?{GOOGLE_CLOUD_PROJECT:googleProject}: {})} : {}
  if (!["segmind", "gemini"].includes(provider)) errors.push("unknown provider")
  if (provider === "gemini" && !real) errors.push("Gemini native requires --real; no native simulator is configured")
  const segmindModel = value("segmind-model") ?? (real ? "flux-3-klein-image-edit" : "try-on-diffusion")
  if(!["try-on-diffusion","nano-banana-pro","nano-banana-2-lite","nano-banana-2.1","flux-3-klein-image-edit"].includes(segmindModel)) errors.push("unknown Segmind model")
  if(segmindModel !== "try-on-diffusion" && !real) errors.push("Joint outfit models require --real")
  const pilot = value("pilot")
  const relay = value("relay")
  const catalog = value("catalog") ?? "curated_pilot"
  const composerFlag = flag("composer")
  const composerModel = composerFlag ? (value("composer") || "claude-haiku-5-5") : null
  if (!CATALOGS.has(catalog)) errors.push("unknown catalog mode")
  if (real && !pilot) errors.push("--real requires --pilot=<id>")
  if (pilot && !/^[a-z0-9][a-z0-9_-]{2,63}$/.test(pilot)) errors.push("invalid pilot id")
  if (relay && relay !== "cloudflared") errors.push("unknown relay")
  if (real && !(provider === "gemini" ? googleKey : rootEnv.SEGMIND_API_KEY)) errors.push(`${provider === "gemini" ? vertex ? "VERTEX" : "GEMINI" : "SEGMIND"}_API_KEY missing for --real`)
  if (composerModel && !rootEnv.ANTHROPIC_API_KEY) errors.push("ANTHROPIC_API_KEY missing for --composer")
  const callsPerDay = value("composer-calls-per-day") ?? "50"
  if (!/^\d{1,6}$/.test(callsPerDay)) errors.push("invalid --composer-calls-per-day")

  const worker = real ? {
    ...googleConfig,
    ...(provider === "gemini" ? { GEMINI_API_KEY: googleKey } : { SEGMIND_API_KEY: rootEnv.SEGMIND_API_KEY, SEGMIND_MODEL: segmindModel }),
    STYLAI_TRYON_PROVIDER: provider, STYLAI_PAID_CALLS_ENABLED: "true", STYLAI_PILOT_ID: pilot ?? "",
    SEGMIND_SUBMIT_RETRIES: "0", STYLAI_ENVIRONMENT: "development",
    ...(relay ? { STYLAI_PHOTO_RELAY: relay } : {}),
  } : {}
  const api = {
    ...googleConfig,
    SEGMIND_MODEL: segmindModel,
    STYLAI_CATALOG_MODE: catalog,
    STYLAI_GENERATION_MODE: real ? "real" : "simulated",
    STYLAI_TRYON_PROVIDER: provider,
    ...(composerModel ? { STYLAI_COMPOSER_ENABLED: "true", STYLAI_COMPOSER_MODEL: composerModel, STYLAI_COMPOSER_CALLS_PER_DAY: callsPerDay, ANTHROPIC_API_KEY: rootEnv.ANTHROPIC_API_KEY } : {}),
  }
  const names = (env) => Object.fromEntries(Object.entries(env).map(([k, v]) => [k, /KEY|SECRET|TOKEN/.test(k) ? (v ? "configurado" : "ausente") : v]))
  return {
    ok: errors.length === 0, errors, keepData: true, real, catalog, composerModel,
    api, worker,
    report: { api: names(api), worker: names(worker), note: "Sem seed/reset: só senhas dos papéis restritos. Nenhum .env alterado." },
  }
}
