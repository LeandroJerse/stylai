import { existsSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
console.log(`Node ${process.version}; expected Node 26.13+ on the 26.x LTS line.`)
const bun = spawnSync(process.platform === "win32" ? "bun.exe" : "bun", ["--version"], { encoding: "utf8", windowsHide: true })
console.log(`Bun ${bun.stdout?.trim() || "not found"}; expected 1.3.12.`)
const installed = existsSync(resolve(root, "node_modules"))
console.log(`Workspace dependencies: ${installed ? "present" : "missing; run bun install --frozen-lockfile"}.`)
console.log("Live services: not probed. API readiness checks the configured Supabase schema RPC; worker readiness is still 503 until queue consumption exists.")
console.log("Run bun run supabase:check for actual hosted connectivity and bun run test:db for isolated foundation SQL/RLS assertions. Public schema types are generated; full domain integrations remain pending. No keys were printed.")
const [major, minor] = process.versions.node.split(".").map(Number)
if (!installed || bun.status !== 0 || major !== 26 || minor < 13) process.exitCode = 1
