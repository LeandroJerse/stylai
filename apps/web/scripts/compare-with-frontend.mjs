import { spawn } from "node:child_process"
import { mkdirSync, writeFileSync } from "node:fs"
import { chromium } from "playwright"
// Visual regression between the legacy frontend/ demo and this app's demo (?demo=full), bar hidden.
// Usage: node scripts/compare-with-frontend.mjs [path-to-frontend] (default ../../../frontend; needs dev:demo on 5192)
import { resolve } from "node:path"
const fe = resolve(process.argv[2] ?? "../../../frontend").replaceAll("\\", "/")
const srv = spawn(process.execPath, [fe + "/node_modules/vite/bin/vite.js", "--config", "demo/vite.config.ts", "--port", "5197", "--strictPort"], { cwd: fe, stdio: "pipe" })
await new Promise((r, j) => { const t = setTimeout(() => j(new Error("no server")), 40000); srv.stdout.on("data", (d) => String(d).includes("5197") && (clearTimeout(t), r())) })
const out = "test-results/review/comparacao"; mkdirSync(out, { recursive: true })
const b = await chromium.launch()
const routes = ["explorar", "closet", "perfil", "estudio"]
const sizes = [{ name: "desktop", width: 1280, height: 860 }, { name: "mobile", width: 390, height: 844 }]
const report = []
for (const s of sizes) for (const r of routes) {
  const shots = {}
  for (const [label, base] of [["frontend", "http://localhost:5197/?demo=full"], ["apps-web", "http://127.0.0.1:5192/?demo=full"]]) {
    const ctx = await b.newContext({ viewport: { width: s.width, height: s.height }, reducedMotion: "reduce" })
    const p = await ctx.newPage()
    await p.goto(`${base}#/${r}`); await p.waitForLoadState("networkidle"); await p.addStyleTag({ content: ".sa-preview-bar{display:none!important} *{animation:none!important;transition:none!important;caret-color:transparent!important}" })
    await p.waitForTimeout(1500)
    shots[label] = await p.screenshot()
    writeFileSync(`${out}/${s.name}-${r}-${label}.png`, shots[label])
    await ctx.close()
  }
  const p = await b.newPage()
  const diff = await p.evaluate(async ([a, c]) => {
    const load = (b64) => new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = "data:image/png;base64," + b64 })
    const [ia, ic] = await Promise.all([load(a), load(c)])
    const w = Math.min(ia.width, ic.width), h = Math.min(ia.height, ic.height)
    const cv = document.createElement("canvas"); cv.width = w; cv.height = h; const x = cv.getContext("2d")
    x.drawImage(ia, 0, 0); const da = x.getImageData(0, 0, w, h).data
    x.clearRect(0, 0, w, h); x.drawImage(ic, 0, 0); const dc = x.getImageData(0, 0, w, h).data
    let n = 0; for (let k = 0; k < da.length; k += 4) if (Math.abs(da[k] - dc[k]) + Math.abs(da[k + 1] - dc[k + 1]) + Math.abs(da[k + 2] - dc[k + 2]) > 30) n++
    return { pct: (100 * n) / (w * h), sameSize: ia.width === ic.width && ia.height === ic.height }
  }, [shots.frontend.toString("base64"), shots["apps-web"].toString("base64")])
  await p.close()
  report.push(`${s.name} ${r}: ${diff.pct.toFixed(2)}% pixels diferentes`)
}
await b.close(); srv.kill()
console.log(report.join("\n"))
