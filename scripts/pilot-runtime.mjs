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
  const pilot = value("pilot")
  const relay = value("relay")
  const catalog = value("catalog") ?? "curated_pilot"
  const composerFlag = flag("composer")
  const composerModel = composerFlag ? (value("composer") || "claude-haiku-5-5") : null
  if (!CATALOGS.has(catalog)) errors.push("unknown catalog mode")
  if (real && !pilot) errors.push("--real requires --pilot=<id>")
  if (pilot && !/^[a-z0-9][a-z0-9_-]{2,63}$/.test(pilot)) errors.push("invalid pilot id")
  if (relay && relay !== "cloudflared") errors.push("unknown relay")
  if (real && !rootEnv.SEGMIND_API_KEY) errors.push("SEGMIND_API_KEY missing for --real")
  if (composerModel && !rootEnv.ANTHROPIC_API_KEY) errors.push("ANTHROPIC_API_KEY missing for --composer")
  const callsPerDay = value("composer-calls-per-day") ?? "50"
  if (!/^\d{1,6}$/.test(callsPerDay)) errors.push("invalid --composer-calls-per-day")

  const worker = real ? {
    SEGMIND_API_KEY: rootEnv.SEGMIND_API_KEY, SEGMIND_MODEL: rootEnv.SEGMIND_MODEL || "try-on-diffusion",
    STYLAI_TRYON_PROVIDER: "segmind", STYLAI_PAID_CALLS_ENABLED: "true", STYLAI_PILOT_ID: pilot ?? "",
    SEGMIND_SUBMIT_RETRIES: "0", STYLAI_ENVIRONMENT: "development",
    ...(relay ? { STYLAI_PHOTO_RELAY: relay } : {}),
  } : {}
  const api = {
    STYLAI_CATALOG_MODE: catalog,
    STYLAI_GENERATION_MODE: real ? "real" : "simulated",
    STYLAI_TRYON_PROVIDER: "segmind",
    ...(composerModel ? { STYLAI_COMPOSER_ENABLED: "true", STYLAI_COMPOSER_MODEL: composerModel, STYLAI_COMPOSER_CALLS_PER_DAY: callsPerDay, ANTHROPIC_API_KEY: rootEnv.ANTHROPIC_API_KEY } : {}),
  }
  const names = (env) => Object.fromEntries(Object.entries(env).map(([k, v]) => [k, /KEY|SECRET|TOKEN/.test(k) ? (v ? "configurado" : "ausente") : v]))
  return {
    ok: errors.length === 0, errors, keepData: true, real, catalog, composerModel,
    api, worker,
    report: { api: names(api), worker: names(worker), note: "Sem seed/reset: só senhas dos papéis restritos. Nenhum .env alterado." },
  }
}
