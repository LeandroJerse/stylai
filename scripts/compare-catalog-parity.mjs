// Compares the same searches made through the UI in the official front (API + database) and in the demo
// (in-memory adapter), written by test:e2e:official and test:e2e:demo. Same query = same products, same order.
// Run after both e2e: node scripts/compare-catalog-parity.mjs
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const read = (name) => JSON.parse(readFileSync(resolve(process.cwd(), "test-results", `catalog-parity-${name}.json`), "utf8"))
const official = read("official"), demo = read("demo")
let failed = 0
for (const query of Object.keys(official)) {
  const a = official[query], b = demo[query] ?? []
  const same = JSON.stringify(a) === JSON.stringify(b)
  if (!same) failed++
  console.log(`${same ? "ok  " : "FAIL"} "${query}": ${a.length} peça(s)${same ? "" : `\n     oficial: ${a.join(" | ")}\n     demo:    ${b.join(" | ")}`}`)
}
if (failed) { console.error(`${failed} consulta(s) diferente(s)`); process.exit(1) }
console.log("Paridade de catálogo ok")
