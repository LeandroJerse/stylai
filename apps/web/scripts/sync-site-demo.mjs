/**
 * Publication bridge for the DEMO, now sourced from the monorepo (stylai-motor/apps/web), replacing
 * frontend/scripts/sync-site-demo.mjs. It prepares the existing Site checkout (../.site-publicacao,
 * static hosting of its dist/) with a reproducible snapshot: app/src, app/demo, dist/, package.json,
 * tsconfig.demo.json and app/source-hashes.json.
 *
 * DEFAULT IS A DRY RUN: it only prints what would change. Nothing is written, deleted or published.
 *   node scripts/sync-site-demo.mjs                  # plan only
 *   node scripts/sync-site-demo.mjs --apply          # write files (no deletions)
 *   node scripts/sync-site-demo.mjs --apply --prune  # also remove Site files absent from the source
 * Publishing (commit/push/deploy of the Site) stays a separate, explicit owner action.
 * Prerequisite for --apply: `bun run build:demo` (dist-demo/ newer than every source file).
 */
import { createHash } from "node:crypto"
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import { dirname, join, relative, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"
import { execFileSync } from "node:child_process"

const web = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const repo = resolve(web, "../..")
const site = resolve(process.env.STYLAI_SITE_DIR ?? resolve(repo, "../.site-publicacao"))
const apply = process.argv.includes("--apply")
const prune = process.argv.includes("--prune")
if (prune && !apply) throw new Error("--prune requires --apply")

const manifest = JSON.parse(readFileSync(join(site, ".openai/hosting.json"), "utf8"))
if (manifest.project_id !== "appgprj_6aee285ad3e4819183ee78e93a6a847f" || manifest.static?.directory !== "dist") throw new Error("Unexpected Site identity")

const files = (dir) => existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)]) : []
const sha = (file) => createHash("sha256").update(readFileSync(file)).digest("hex")
const rel = (base, file) => relative(base, file).split(sep).join("/")

// Source -> Site mapping. Tests and dev-only scripts are not part of the published snapshot.
const mappings = [
  { from: join(web, "src"), to: join(site, "app/src") },
  { from: join(web, "demo"), to: join(site, "app/demo") },
  { from: join(web, "dist-demo"), to: join(site, "dist") },
]
const distDemo = join(web, "dist-demo")
if (!existsSync(join(distDemo, "index.html"))) throw new Error("dist-demo/ missing: run `bun run build:demo` first")
const newestSource = Math.max(...[join(web, "src"), join(web, "demo")].flatMap(files).map((f) => statSync(f).mtimeMs))
const buildTime = statSync(join(distDemo, "index.html")).mtimeMs
const stale = buildTime < newestSource

const plan = { add: [], change: [], same: 0, remove: [] }
for (const m of mappings) {
  const src = new Map(files(m.from).map((f) => [rel(m.from, f), f]))
  for (const [path, file] of src) {
    const target = join(m.to, path)
    if (!existsSync(target)) plan.add.push(rel(site, target))
    else if (sha(target) !== sha(file)) plan.change.push(rel(site, target))
    else plan.same++
  }
  for (const target of files(m.to)) if (!src.has(rel(m.to, target))) plan.remove.push(rel(site, target))
}

// Site package.json mirrors the web workspace dependencies (exact pins from the monorepo).
const webPkg = JSON.parse(readFileSync(join(web, "package.json"), "utf8"))
const sitePkg = {
  name: "stylai-published-demo", private: true, version: webPkg.version, type: "module",
  scripts: {
    dev: "vite --config app/demo/vite.config.ts --port 5192",
    build: "tsc --noEmit -p tsconfig.demo.json && vite build --config app/demo/vite.config.ts --outDir ../../dist",
    typecheck: "tsc --noEmit -p tsconfig.demo.json",
    test: "bun test ./app/demo/demo.test.ts ./app/demo/demo-tryon.test.ts",
  },
  dependencies: webPkg.dependencies, devDependencies: webPkg.devDependencies,
}
const currentPkg = existsSync(join(site, "package.json")) ? readFileSync(join(site, "package.json"), "utf8") : ""
const nextPkg = JSON.stringify(sitePkg, null, 2) + "\n"
const tsconfig = JSON.parse(readFileSync(join(web, "tsconfig.app.json"), "utf8"))
tsconfig.include = ["app/src", "app/demo/*.ts"]
tsconfig.exclude = ["app/demo/*.test.ts", "app/demo/vite.config.ts"]
const nextTsconfig = JSON.stringify(tsconfig, null, 2) + "\n"
let commit = "unknown"
try { commit = execFileSync("git", ["-C", repo, "rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim() + (execFileSync("git", ["-C", repo, "status", "--porcelain", "--", "apps/web"], { encoding: "utf8" }).trim() ? "+uncommitted" : "") } catch { /* not a git checkout */ }

console.log(`Source : ${rel(resolve(repo, ".."), web)} (stylai-motor @ ${commit})`)
console.log(`Site   : ${site} (static dir: dist)`)
console.log(`Build  : dist-demo ${stale ? "OLDER than sources — rebuild before --apply" : "up to date with sources"}`)
console.log(`Files  : +${plan.add.length} new, ~${plan.change.length} changed, =${plan.same} unchanged, -${plan.remove.length} only in Site${prune ? " (will be removed)" : " (kept; use --prune to remove)"}`)
console.log(`package.json      : ${currentPkg === nextPkg ? "unchanged" : "will be regenerated from apps/web/package.json (exact pins)"}`)
console.log(`tsconfig.demo.json: ${existsSync(join(site, "tsconfig.demo.json")) && readFileSync(join(site, "tsconfig.demo.json"), "utf8") === nextTsconfig ? "unchanged" : "will be regenerated"}`)
console.log("bun.lock          : NOT copied (the monorepo lockfile is workspace-wide). After --apply, run `bun install` inside the Site to refresh its own lockfile.")
const show = (label, list) => list.length && console.log(`\n${label} (${list.length}):\n  ${list.slice(0, 40).join("\n  ")}${list.length > 40 ? `\n  … +${list.length - 40}` : ""}`)
show("New", plan.add); show("Changed", plan.change); show("Only in Site", plan.remove)

if (!apply) { console.log("\nDry run: nothing was written."); process.exit(0) }
if (stale) throw new Error("dist-demo is older than the sources: run `bun run build:demo` first")
for (const m of mappings) { mkdirSync(m.to, { recursive: true }); cpSync(m.from, m.to, { recursive: true }) }
if (prune) for (const path of plan.remove) rmSync(join(site, path))
writeFileSync(join(site, "package.json"), nextPkg)
writeFileSync(join(site, "tsconfig.demo.json"), nextTsconfig)
const hashes = Object.fromEntries(["src", "demo"].flatMap((d) => files(join(web, d)).map((f) => [rel(web, f), sha(f)])))
writeFileSync(join(site, "app/source-hashes.json"), JSON.stringify({ source: `stylai-motor/apps/web@${commit}`, files: hashes }, null, 2) + "\n")
console.log(`\nWritten. Verify in the Site: bun install && bun run typecheck && bun run test && bun run build. Publishing is a separate step.`)
