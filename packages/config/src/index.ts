export interface ServiceConfig {
  nodeEnv: "development" | "test" | "production"
  host: string
  apiPort: number
  workerPort: number
  appOrigin: string
}

/** Scaffold config only. Integration-specific secrets are validated when implemented. */
export function readServiceConfig(env: Record<string, string | undefined>): ServiceConfig {
  const nodeEnv = env.NODE_ENV ?? "development"
  if (!["development", "test", "production"].includes(nodeEnv)) throw new Error("Invalid NODE_ENV")
  const port = (name: string, fallback: number): number => {
    const value = Number(env[name] ?? fallback)
    if (!Number.isInteger(value) || value < 1 || value > 65535) throw new Error(`Invalid ${name}`)
    return value
  }
  const appOrigin = env.APP_ORIGIN ?? "http://localhost:5190"
  let url: URL
  try { url = new URL(appOrigin) } catch { throw new Error("Invalid APP_ORIGIN") }
  if (!["http:", "https:"].includes(url.protocol) || url.origin !== appOrigin || url.username || url.password || (nodeEnv === "production" && url.protocol !== "https:")) {
    throw new Error("APP_ORIGIN must be an exact HTTP(S) origin; production requires HTTPS")
  }
  return { nodeEnv: nodeEnv as ServiceConfig["nodeEnv"], host: env.SERVICE_HOST ?? "127.0.0.1", apiPort: port("API_PORT", 3000), workerPort: port("WORKER_PORT", 3001), appOrigin }
}
