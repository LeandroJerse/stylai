/**
 * Browser journey of the ORIGINAL Estúdio (Procurar/Vestir) on the current engine, shared by the
 * official mode (real API + worker + simulated provider) and the demo (in-memory adapter).
 * Order checked: Perfil photo -> request -> search -> select piece/variant -> generate -> result
 * -> versions -> swap -> reopen v1; plus the generation block without a photo.
 */
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { deflateSync } from "node:zlib"

/** Authorized real photos (Unsplash License) for the pose validator: see scripts/fixtures/photos/README.md. */
const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "photos")
export const testPhoto = (name) => ({ name: `${name}.jpg`, mimeType: "image/jpeg", buffer: readFileSync(join(FIXTURES, `${name}.jpg`)) })

function crc32(bytes) {
  let c = ~0
  for (const b of bytes) { c ^= b; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)) }
  return ~c >>> 0
}
function chunk(type, data) {
  const head = Buffer.alloc(8); head.writeUInt32BE(data.length, 0); head.write(type, 4, "ascii")
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0)
  return Buffer.concat([head, data, crc])
}
/** Synthetic PNG (no real person): flat colour with a darker silhouette band. */
export function syntheticPng(width, height, [r, g, b]) {
  const raw = Buffer.alloc((width * 3 + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0
    for (let x = 0; x < width; x++) {
      const o = y * (width * 3 + 1) + 1 + x * 3
      const body = Math.abs(x - width / 2) < width / 6
      raw[o] = body ? r >> 1 : r; raw[o + 1] = body ? g >> 1 : g; raw[o + 2] = body ? b >> 1 : b
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))])
}

export function createChecker(label) {
  const results = []
  return {
    results,
    check(ok, name, detail = "") {
      results.push({ ok: Boolean(ok), name })
      console.log(`${ok ? "ok  " : "FAIL"} [${label}] ${name}${!ok && detail ? ` — ${detail}` : ""}`)
      return Boolean(ok)
    },
    failed: () => results.filter((r) => !r.ok),
  }
}

const imageLoaded = (page, selector) => page.$eval(selector, (el) => {
  const img = el.tagName === "IMG" ? el : el.querySelector("img")
  return !!img && img.complete && img.naturalWidth > 0
}).catch(() => false)
async function waitImage(page, selector, timeout = 15000) {
  const end = Date.now() + timeout
  while (Date.now() < end) { if (await imageLoaded(page, selector)) return true; await page.waitForTimeout(250) }
  return false
}
const disabled = async (locator) => (await locator.getAttribute("aria-disabled")) === "true"

export async function gotoTab(page, base, tab) {
  await page.evaluate((t) => { location.hash = `#/${t}` }, tab)
  await page.waitForTimeout(300)
}

/** Perfil: consent + one photo in a slot; waits for the server/browser validation state. */
export async function uploadPhoto(page, angle, file, expected, timeout = 30000) {
  await page.getByTestId(`photo-input-${angle}`).setInputFiles(file)
  const state = page.getByTestId(`photo-state-${angle}`)
  await page.waitForFunction(([a, e]) => document.querySelector(`[data-testid="photo-state-${a}"]`)?.getAttribute("data-state") === e, [angle, expected], { timeout }).catch(() => undefined)
  return (await state.getAttribute("data-state").catch(() => null)) === expected
}

export async function addProfilePhoto(page, base, file, t, label = "foto de frente aprovada pelo validador de pose") {
  await gotoTab(page, base, "perfil")
  await page.locator("#fotos").waitFor()
  if (await page.getByTestId("photo-consent").count()) {
    await page.getByTestId("consent-checkbox").check()
    await page.getByTestId("consent-accept").click()
    await page.getByTestId("consent-accepted").waitFor({ timeout: 10000 })
  }
  t.check(await uploadPhoto(page, "front", file, "approved"), label)
  t.check(await waitImage(page, '[data-testid="photo-slot-front"]'), "foto de frente exibida no Perfil")
}

async function openComposer(page) {
  // "Novo pedido" reopens the composer after a result (and clears the request).
  const fresh = page.getByRole("button", { name: "Novo pedido" })
  if (await fresh.count()) await fresh.first().click()
}
async function setMode(page, mode) {
  await page.getByRole("radio", { name: mode }).first().click()
}
/** Procurar: request -> search -> pick the piece (and its size when there are several). */
export async function searchAndPick(page, prompt, pieceName) {
  await setMode(page, "Procurar")
  await openComposer(page)
  await page.getByLabel("O que você quer vestir?").fill(prompt)
  await page.getByTestId("search-button").click()
  await page.getByTestId("search-item").first().waitFor({ timeout: 10000 })
  await page.getByRole("checkbox", { name: `Usar ${pieceName} como base` }).click()
  const size = page.locator('[data-testid="variant-select"]').first()
  if (await size.count()) await size.selectOption({ index: 1 })
}

/** Same queries in the official front and the demo (catalog parity). */
export const PARITY_QUERIES = ["calça preta", "blusa branca", "vestido", "jaqueta jeans", "camisa azul até R$ 140", "saia"]
/** Runs a search through the UI and returns the names offered for selection (first page, in order). */
export async function searchResultNames(page, prompt) {
  await setMode(page, "Procurar")
  await openComposer(page)
  await page.getByLabel("O que você quer vestir?").fill(prompt)
  await page.getByTestId("search-button").click()
  await page.getByTestId("search-item").first().waitFor({ timeout: 10000 }).catch(() => undefined)
  await page.waitForTimeout(200)
  const labels = await page.locator('[data-testid="search-item"]').evaluateAll((els) => els.map((e) => e.getAttribute("aria-label") ?? ""))
  return labels.map((l) => l.replace(/^Usar /, "").replace(/ como base(:.*)?$/, ""))
}

/**
 * @param {import("playwright").Page} page signed in, any tab
 * @param {{ base: string, pieceA: string, pieceB: string, promptA: string, promptB: string, startCoins: number,
 *   photos: { front: object, side: object, profile: object, selfie: object, twoPeople: object },
 *   prepareFailure: () => Promise<{ prompt: string, piece: string }>, shots: (n: string) => Promise<void>, jobTimeout?: number }} o
 */
export async function runStudioJourney(page, t, o) {
  const jobTimeout = o.jobTimeout ?? 45000
  const evidence = {}

  // 1. Original Estúdio, no photo yet: search and selection work, generation is blocked.
  await gotoTab(page, o.base, "estudio")
  await page.getByRole("heading", { name: "Estúdio" }).waitFor()
  t.check(await page.getByRole("radio", { name: "Procurar" }).count() > 0 && await page.getByRole("radio", { name: "Vestir" }).count() > 0, "Estúdio original com Procurar e Vestir")
  await searchAndPick(page, o.promptA, o.pieceA)
  t.check(await page.getByText("Busca no catálogo selecionado pelo StylAI").count() > 0, "busca identificada como catálogo curado (não loja ao vivo)")
  await page.getByTestId("photo-gate").first().waitFor({ timeout: 10000 })
  t.check(await disabled(page.getByTestId("search-generate")), "sem foto: Vestir bloqueado, com orientação para o Perfil")
  await o.shots("01-sem-foto-bloqueado")

  // 2. Photo in the Perfil, then back: generation unlocked.
  await page.getByRole("button", { name: "Adicionar foto no Perfil" }).first().click()
  await page.locator("#fotos").waitFor()
  await page.getByTestId("photo-slot-profile").waitFor({ timeout: 10000 })
  t.check(await page.getByText("Não usada nesta fase").count() === 0, "Perfil sem “Não usada nesta fase”")
  t.check(await page.getByText("Três quartos").count() > 0 && await page.getByText("Perfil", { exact: true }).count() > 0, "três espaços: Frente, Três quartos e Perfil")
  await addProfilePhoto(page, o.base, o.photos.front, t)
  t.check(await uploadPhoto(page, "side", o.photos.side, "approved"), "foto três quartos (45°) cadastrada e aprovada")
  t.check(await uploadPhoto(page, "profile", o.photos.profile, "approved"), "foto de perfil (90°) cadastrada e aprovada")
  await o.shots("02-tres-fotos-aprovadas")
  // A close selfie as the new front: specific guidance, previous approved photo stays in use.
  t.check(await uploadPhoto(page, "front", o.photos.selfie, "needs-adjustment"), "selfie fechada: “Precisa de ajuste”")
  t.check(await page.getByText("Afaste a câmera para incluir as pernas.").count() > 0, "orientação específica: incluir as pernas")
  t.check(await page.getByText("Sua foto anterior continua em uso até uma nova ser aprovada.").count() > 0, "foto aprovada anterior continua em uso")
  t.check(await uploadPhoto(page, "side", o.photos.twoPeople, "needs-adjustment"), "duas pessoas: “Precisa de ajuste”")
  t.check(await page.getByText("Use uma foto com apenas uma pessoa.").count() > 0, "orientação específica: apenas uma pessoa")
  // Head margin (pose-rules/4): a whole head close to the top border is accepted with a recommendation;
  // a head really cut asks for another photo.
  t.check(await uploadPhoto(page, "front", o.photos.tightTop, "approved"), "cabeça inteira perto da borda: aprovada (não bloqueia)")
  t.check((await page.getByTestId("photo-advice-front").innerText().catch(() => "")).includes("deixe um pouco mais de espaço"), "recomendação de mais espaço acima da cabeça, sem bloquear")
  t.check((await page.getByTestId("photo-role-front").innerText()).includes("Usada para gerar"), "“Usada para gerar” só com a foto aprovada em uso")
  // The side slot is already "needs adjustment" (two people): wait for THIS photo's message, not the old state.
  await page.getByTestId("photo-input-side").setInputFiles(o.photos.headCut)
  const cutMessage = await page.getByTestId("photo-issues-side").getByText("A cabeça ficou cortada.", { exact: false }).waitFor({ timeout: 30000 }).then(() => true, () => false)
  t.check(cutMessage && (await page.getByTestId("photo-state-side").getAttribute("data-state")) === "needs-adjustment", "cabeça realmente cortada: “Precisa de ajuste” pedindo outra foto com espaço acima da cabeça")
  await o.shots("02b-validacao-ajustes")
  await gotoTab(page, o.base, "estudio")
  await page.getByTestId("search-generate").waitFor()
  t.check(!(await disabled(page.getByTestId("search-generate"))), "com foto de frente aprovada: Vestir liberado (mesmo com uma nova foto reprovada)")
  // Header balance (always visible; value from the API / demo adapter).
  const coins = async () => Number(((await page.locator('button[aria-label^="Saldo:"]').first().getAttribute("aria-label").catch(() => "")) ?? "").match(/Saldo: (\d+) moedas/)?.[1] ?? NaN)
  const before = await coins()
  t.check(before === o.startCoins, `saldo exibido em moedas (${o.startCoins})`, String(before))
  t.check((await page.getByTestId("search-generate").innerText()).includes("10 moedas"), "botão mostra o custo: 10 moedas")
  t.check(await page.getByTestId("mode-note").count() > 0 && (await page.getByTestId("mode-note").first().innerText()).includes("Modo simulação"), "modo simulação identificado antes de gerar")

  // 3. Generate v1 (triple tap).
  await page.$eval('[data-testid="search-generate"]', (b) => { b.click(); b.click(); b.click() })
  await page.locator('section[aria-label="Progresso"]').waitFor({ timeout: 10000 }).then(() => t.check(true, "processamento visível"), () => t.check(false, "processamento visível"))
  await o.shots("03-processando")
  await page.getByTestId("version-piece").waitFor({ timeout: jobTimeout })
  t.check((await page.getByTestId("version-piece").innerText()).includes(o.pieceA) && (await page.getByTestId("version-piece").innerText()).includes("v1"), "resultado v1 com a peça escolhida")
  t.check(await waitImage(page, ".sa-stage-photo"), "imagem da v1 carrega")
  t.check(await page.getByTestId("simulated-badge").count() > 0, "resultado marcado como simulado junto à imagem")
  evidence.v1Image = await page.$eval(".sa-stage-photo img", (i) => i.src)
  await searchAndPick(page, o.promptA, o.pieceA)
  await page.waitForFunction((n) => document.querySelector('button[aria-label^="Saldo:"]')?.getAttribute("aria-label")?.includes(`Saldo: ${n} moedas`), before - 10, { timeout: 10000 }).catch(() => undefined)
  t.check((await coins()) === before - 10, "geração concluída debita 10 moedas (saldo vindo da fonte de dados)", String(await coins()))
  await o.shots("04-resultado-v1")

  // 4. Next piece for a swap, kept apart from the piece of the version on screen.
  await searchAndPick(page, o.promptB, o.pieceB)
  await page.getByTestId("next-piece").waitFor()
  t.check((await page.getByTestId("version-piece").innerText()).includes(o.pieceA) && (await page.getByTestId("next-piece").innerText()).includes(o.pieceB), "peça da versão (A) separada da próxima troca (B)")
  await o.shots("05-proxima-troca")
  await page.getByTestId("swap-button").click()
  await page.getByText(/· v2$/).first().waitFor({ timeout: jobTimeout })
  await page.waitForFunction(() => document.querySelector('[data-testid="version-piece"]')?.textContent?.includes("v2"), null, { timeout: 15000 })
  t.check((await page.getByTestId("version-piece").innerText()).includes(o.pieceB), "v2 com a nova peça")
  const versions = page.getByRole("radiogroup", { name: "Versões desta imagem" })
  await versions.waitFor({ timeout: 10000 })
  t.check((await versions.getByRole("radio").allInnerTexts()).join(",") === "v1,v2", "seletor com v1 e v2 da mesma linhagem")
  await o.shots("06-resultado-v2")

  // 5. Reopen v1: image, piece and variant of THAT version.
  await versions.getByRole("radio", { name: "v1" }).click()
  await page.waitForFunction(() => document.querySelector('[data-testid="version-piece"]')?.textContent?.includes("v1"), null, { timeout: 15000 })
  t.check((await page.getByTestId("version-piece").innerText()).includes(o.pieceA), "v1 reaberta mostra a peça da v1")
  t.check(await waitImage(page, ".sa-stage-photo"), "imagem da v1 reaberta carrega")
  evidence.v1Reopened = await page.$$eval(".sa-stage-photo img", (is) => is.map((i) => i.src))
  await o.shots("07-v1-reaberta")

  // 6. Failure: clear message, quota untouched.
  const fail = await o.prepareFailure()
  await searchAndPick(page, fail.prompt, fail.piece)
  await page.getByTestId("search-generate").click()
  await page.getByText("Não foi possível concluir.").waitFor({ timeout: jobTimeout })
  t.check(await page.getByText("Nada foi cobrado.").count() > 0, "falha clara e sem cobrança")
  t.check((await coins()) === before - 20, "falha não debita moedas (só v1 e v2 foram cobradas)", String(await coins()))
  await o.shots("08-falha")

  // 7. Photo deleted in the Perfil -> the Estúdio blocks again.
  await gotoTab(page, o.base, "perfil")
  // QA-012: cancel keeps the photo; confirm (even double-clicked) removes it once.
  await page.getByRole("button", { name: "Apagar foto Frente" }).click()
  await page.getByTestId("confirm-delete-front").getByRole("button", { name: "Cancelar" }).click()
  t.check(await page.getByTestId("add-photo-front").count() === 0 && await page.locator('[data-testid="photo-slot-front"] img').count() > 0, "cancelar a exclusão preserva a foto")
  await page.getByRole("button", { name: "Apagar foto Frente" }).click()
  await page.$eval('[aria-label="Confirmar exclusão da foto Frente"]', (b) => { b.click(); b.click(); b.click() })
  await page.getByTestId("add-photo-front").waitFor({ timeout: 10000 })
  t.check(!(await page.getByTestId("photo-role-front").innerText()).includes("Usada para gerar"), "sem foto aprovada, o espaço de frente não diz “Usada para gerar”")
  // A rejected photo in the slot is not eligible either.
  await uploadPhoto(page, "front", o.photos.selfie, "needs-adjustment")
  t.check((await page.getByTestId("photo-role-front").innerText()).includes("Necessária para gerar"), "foto reprovada mostra “Necessária para gerar”, nunca “Usada para gerar”")
  await gotoTab(page, o.base, "estudio")
  await searchAndPick(page, o.promptA, o.pieceA)
  await page.getByTestId("photo-gate").first().waitFor({ timeout: 10000 })
  t.check(await disabled(page.getByTestId("search-generate")), "após apagar a foto no Perfil, a geração volta a ser bloqueada")
  await o.shots("09-foto-apagada-bloqueado")
  return evidence
}
