import { expect, test } from "bun:test"
import { interpretRequestRules } from "@stylai/ai"
import { buildApp } from "../src/app"
import type { CatalogRow } from "../src/modules/catalog/routes"
import type { PrivateDatabase } from "@stylai/supabase"

const row = (id: string, name: string, category: { id: string; label: string }, price: number | null, tryOn = true): CatalogRow => ({
  id, name, price_minor: price, currency: "BRL", availability: "unknown", source_updated_at: null, product_url: null, fixture: true,
  created_at: "2026-11-20T00:00:00Z", category, partner: { id: "70000000-0000-4000-8000-000000000001", name: "Loja de teste", source: "curated" },
  variants: [{ id: `${id.slice(0, -1)}9`, label: "M", available: true }],
  images: [{ url: "https://fixtures.stylai.test/x.png", alt: null, position: 0, try_on_allowed: tryOn }],
})
const tops = { id: "tops", label: "Blusas" }, jackets = { id: "jackets", label: "Jaquetas" }
const rows = [
  row("10000000-0000-4000-8000-000000000001", "Blusa preta de linho", tops, 19900),
  row("10000000-0000-4000-8000-000000000002", "Blusa branca", tops, 39900),
  row("10000000-0000-4000-8000-000000000003", "Jaqueta jeans azul", jackets, null),
  row("10000000-0000-4000-8000-000000000004", "Blusa sem direito de prova", tops, 10000, false),
]

async function app(actor: string | null = "20000000-0000-4000-8000-000000000001") {
  return buildApp({ appOrigin: "http://localhost:5190", search: { db: {} as PrivateDatabase<"api">, resolveActor: async () => actor, listCatalog: async () => rows } })
}
const search = async (prompt: string, rules: unknown = null) => {
  const a = await app()
  try { return await a.inject({ method: "POST", url: "/v1/studio/searches", payload: { prompt, rules } }) } finally { await a.close() }
}

test("rule interpreter reads category, colour and budget without any AI call", () => {
  const r = interpretRequestRules("Quero blusas pretas até R$ 250", [tops, jackets])
  expect(r.intent.category).toBe("tops")
  expect(r.intent.colors).toEqual(["preto"])
  expect(r.intent.max_price_brl).toBe(250)
})

test("search filters by category, colour and budget, and explains what blocks a piece", async () => {
  const blusa = (await search("blusa")).json()
  expect(blusa.source).toBe("curated_catalog")
  expect(blusa.items.map((i: { product: { name: string } }) => i.product.name)).toEqual(["Blusa branca", "Blusa preta de linho", "Blusa sem direito de prova"])
  expect(blusa.items[2].failed).toContain("Sem imagem liberada para prova")
  const preta = (await search("blusa preta")).json()
  expect(preta.items.map((i: { product: { name: string } }) => i.product.name)).toEqual(["Blusa preta de linho"])
  const barata = (await search("blusa até R$ 250")).json()
  expect(barata.items.every((i: { product: { price: { amount: number } | null } }) => (i.product.price?.amount ?? 0) <= 250)).toBe(true)
  const prefer = (await search("jaqueta", { budget: { value: 100, mode: "prefer" } })).json()
  expect(prefer.items[0].failed).toContain("Preço não informado")
  expect((await search("sapato social")).json().items).toHaveLength(0)
})

test("search needs an account and a request", async () => {
  expect((await search("   ")).statusCode).toBe(422)
  const anon = await app(null)
  try { expect((await anon.inject({ method: "POST", url: "/v1/studio/searches", payload: { prompt: "blusa" } })).statusCode).toBe(401) } finally { await anon.close() }
})
