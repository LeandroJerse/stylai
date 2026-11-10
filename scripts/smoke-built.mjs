import { spawn } from "node:child_process"
import { createServer } from "node:net"
import { setTimeout as delay } from "node:timers/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
async function freePort() {
  const server = createServer()
  await new Promise((done, fail) => { server.once("error", fail); server.listen(0, "127.0.0.1", done) })
  const port = server.address().port
  await new Promise((done, fail) => server.close((error) => error ? fail(error) : done()))
  return port
}
const children = []
try {
  for (const service of ["api", "worker"]) {
    const port = await freePort()
    const child = spawn(process.execPath, [`apps/${service}/dist/server.js`], { cwd: root, env: { ...process.env, SUPABASE_URL: "", SUPABASE_PUBLISHABLE_KEY: "", SUPABASE_SECRET_KEY: "", SUPABASE_ANON_KEY: "", SUPABASE_SERVICE_ROLE_KEY: "", NODE_ENV: "test", SERVICE_HOST: "127.0.0.1", APP_ORIGIN: "http://localhost:5190", [service === "api" ? "API_PORT" : "WORKER_PORT"]: String(port) }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true })
    children.push(child)
    let output = ""
    child.stdout.on("data", (data) => { output = (output + data).slice(-4000) })
    child.stderr.on("data", (data) => { output = (output + data).slice(-4000) })
    let live
    for (let attempt = 0; attempt < 100; attempt++) {
      if (child.exitCode !== null) throw new Error(`${service} exited ${child.exitCode}: ${output}`)
      try { live = await fetch(`http://127.0.0.1:${port}/health/live`, { signal: AbortSignal.timeout(1000) }); if (live.ok) break } catch { /* bounded startup retry */ }
      await delay(100)
    }
    if (!live?.ok || (await live.json()).service !== service) throw new Error(`${service} did not become live: ${output}`)
    const ready = await fetch(`http://127.0.0.1:${port}/health/ready`)
    if (ready.status !== 503 || (await ready.json()).status !== "not_ready") throw new Error(`${service} falsely claims dependency readiness`)
    console.log(`Built Node ${service}: liveness 200; dependency readiness 503 as intended.`)
  }
} finally {
  for (const child of children) {
    if (child.exitCode !== null) continue
    await new Promise((done) => {
      const timer = setTimeout(() => child.kill("SIGKILL"), 3000)
      child.once("exit", () => { clearTimeout(timer); done() })
      child.kill("SIGTERM")
    })
  }
}
