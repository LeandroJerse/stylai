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
console.log("Live services: not probed. API readiness requires the Supabase foundation RPC and restricted private database access; worker readiness stays 503 until queue consumption exists.")
console.log("Run bun run supabase:check for the hosted foundation only; test:db and test:db:private verify disposable SQL/RLS and real Node private transactions. Hosted runtime roles and application/provider features remain pending. No keys were printed.")
const [major, minor] = process.versions.node.split(".").map(Number)
if (!installed || bun.status !== 0 || major !== 26 || minor < 13) process.exitCode = 1
