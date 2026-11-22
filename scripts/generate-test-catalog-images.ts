// Generates the synthetic garment illustrations of the TEST catalog (own images, no third-party
// photos): flat vector garments rendered to 600x800 PNG with Chromium (Playwright, already a dev
// dependency). Output: packages/contracts/assets/test-catalog/*.png (committed, deterministic).
// Run: node --import tsx scripts/generate-test-catalog-images.ts
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { chromium } from "playwright"
import { TEST_CATALOG } from "../packages/contracts/src/catalog-source.js"

const OUT = resolve(process.cwd(), "packages/contracts/assets/test-catalog")
const COLORS: Record<string, string> = {
  "blusa-basica-branca": "#f3f1ec", "blusa-canelada-preta": "#24262b", "regata-oliva": "#6b7440", "blusa-alca-rosa": "#e7a7b6",
  "camisa-linho-bege": "#d8c3a0", "camisa-social-azul": "#7ea2cf", "camisa-branca-oversized": "#f5f5f2", "jaqueta-jeans-azul": "#4f6f9c",
  "blazer-preto": "#1f2024", "casaco-caramelo": "#b07a45", "corta-vento-amarelo": "#e8c12f", "calca-reta-preta": "#232428",
  "calca-wide-bege": "#d6c09c", "calca-jeans-azul": "#3f5f8f", "calca-cargo-verde": "#55613a", "saia-midi-vermelha": "#b8333a",
  "short-jeans-azul": "#5b7cab", "saia-plissada-cinza": "#8d8f94", "vestido-midi-preto": "#1d1e22", "vestido-rosa": "#e3a0b0",
  "vestido-verde-longo": "#3f6e4f", "blusa-sem-preco": "#8fb0d8", "blusa-falha": "#ee8a73", "camisa-so-exibicao": "#5f9a6a", "blusa-esgotada": "#9a9ca1",
}

const shade = (hex: string, f: number) => "#" + [1, 3, 5].map((i) => Math.max(0, Math.min(255, Math.round(parseInt(hex.slice(i, i + 2), 16) * f))).toString(16).padStart(2, "0")).join("")

/** Garment silhouette in a 600x800 box. */
function shape(id: string, category: string): string {
  if (category === "pants") {
    const wide = id.includes("wide") ? 40 : 0
    return `<path d="M200 140 H400 L${430 + wide} 700 H${330} L300 330 L${270} 700 H${170 - wide} Z"/><rect x="200" y="140" width="200" height="28" opacity=".18" fill="#000"/>`
      + (id.includes("cargo") ? `<rect x="160" y="400" width="60" height="80" rx="6" opacity=".15" fill="#000"/><rect x="380" y="400" width="60" height="80" rx="6" opacity=".15" fill="#000"/>` : "")
  }
  if (category === "bottoms") {
    if (id.includes("short")) return `<path d="M200 220 H400 L430 470 H315 L300 380 L285 470 H170 Z"/><rect x="200" y="220" width="200" height="24" opacity=".18" fill="#000"/>`
    const pleats = id.includes("plissada") ? [240, 280, 320, 360].map((x) => `<path d="M${x} 200 L${x + (x - 300) * 0.5} 600" stroke="#000" stroke-opacity=".15" stroke-width="3"/>`).join("") : ""
    return `<path d="M215 200 H385 L440 600 H160 Z"/><rect x="215" y="200" width="170" height="24" opacity=".18" fill="#000"/>${pleats}`
  }
  if (category === "dresses") {
    const hem = id.includes("longo") ? 730 : 620
    const straps = id.includes("alca") || id.includes("rosa") ? `<path d="M240 90 L250 160 M360 90 L350 160" stroke="currentColor" stroke-width="10"/>` : ""
    const d = straps
      ? `M235 160 H365 L380 340 L470 ${hem} H130 L220 340 Z`
      : `M220 120 Q300 165 380 120 L395 170 L380 340 L470 ${hem} H130 L220 340 L205 170 Z`
    return `${straps}<path d="${d}"/>`
  }
  // tops, shirts, jackets
  const sleeveLen = category === "tops" ? (id.includes("regata") || id.includes("alca") ? 0 : 1) : 2
  const body = `<path d="M210 130 Q300 175 390 130 L430 160 L430 640 H170 L170 160 Z"/>`
  const sleeves = sleeveLen === 0 ? "" : sleeveLen === 1
    ? `<path d="M210 130 L120 220 L160 270 L190 230 Z"/><path d="M390 130 L480 220 L440 270 L410 230 Z"/>`
    : `<path d="M210 130 L110 520 L165 535 L190 260 Z"/><path d="M390 130 L490 520 L435 535 L410 260 Z"/>`
  const collar = category === "shirts" ? `<path d="M260 140 L300 200 L340 140 L320 128 L300 160 L280 128 Z" fill="#fff" fill-opacity=".55"/>${[240, 300, 360, 420, 480, 540].map((y) => `<circle cx="300" cy="${y}" r="5" fill="#000" fill-opacity=".25"/>`).join("")}` : ""
  const lapels = category === "jackets" ? `<path d="M260 140 L300 330 L340 140" fill="none" stroke="#000" stroke-opacity=".28" stroke-width="6"/><path d="M300 330 V640" stroke="#000" stroke-opacity=".2" stroke-width="4"/>` : ""
  const stripes = id.includes("sem-preco") ? [220, 280, 340, 400, 460, 520, 580].map((y) => `<rect x="170" y="${y}" width="260" height="14" fill="#fff" fill-opacity=".55"/>`).join("") : ""
  const rib = id.includes("canelada") ? [200, 230, 260, 290, 320, 350, 380, 410].map((x) => `<path d="M${x} 170 V640" stroke="#fff" stroke-opacity=".08" stroke-width="5"/>`).join("") : ""
  return `${sleeves}${body}${stripes}${rib}${collar}${lapels}`
}

function svg(id: string, category: string): string {
  const c = COLORS[id] ?? "#999999"
  return `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800" viewBox="0 0 600 800">
  <defs><linearGradient id="g" x1="0" x2="1"><stop offset="0" stop-color="${shade(c, 1.08)}"/><stop offset="1" stop-color="${shade(c, 0.86)}"/></linearGradient></defs>
  <rect width="600" height="800" fill="#f4f1ec"/>
  <g fill="url(#g)" color="${shade(c, 0.9)}" stroke="${shade(c, 0.7)}" stroke-width="2" stroke-linejoin="round">${shape(id, category)}</g>
  <text x="300" y="775" text-anchor="middle" font-family="Arial, sans-serif" font-size="18" fill="#8a847a">StylAI · ilustração de teste</text>
</svg>`
}

mkdirSync(OUT, { recursive: true })
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 600, height: 800 } })
for (const item of TEST_CATALOG) {
  const id = item.image.replace(/^fail\//, "").replace(/\.png$/, "")
  await page.setContent(`<html><body style="margin:0">${svg(id, item.category)}</body></html>`)
  const file = resolve(OUT, item.image)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, await page.screenshot({ type: "png", clip: { x: 0, y: 0, width: 600, height: 800 } }))
}
await browser.close()
console.log(`${TEST_CATALOG.length} test garment images -> ${OUT}`)
