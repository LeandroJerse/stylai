import { describe, expect, test } from "bun:test"
import { lookTitle, shortPieceName } from "../src/lib/titles"

describe("shortPieceName", () => {
  const cases: [string, string][] = [
    ["Calça Pantalona Feminina Cintura Alta Wide Leg Social Elegante Alfaiataria Plus Size", "Calça pantalona"],
    ["2026 Novo Suéter Feminino de Tricô Gola Redonda Manga Comprida Outono Inverno", "Suéter de tricô"],
    ["Jaqueta Corta-Vento Masculina e Feminina Impermeável com Capuz", "Jaqueta corta-vento"],
    ["2026_27 Camisa de Futebol Colete La Coruña Torcedor Edição Especial", "Camisa de futebol"],
    ["Conjunto Feminino 2 Peças Verão Regata Cropped e Short Cintura Alta", "Conjunto 2 peças"],
    ["VESTIDO LONGO FEMININO FLORAL DE VERÃO PRAIA MANGA CURTA ELEGANTE", "Vestido longo"],
    ["Camisetas masculinas de algodão oversized streetwear verão 2026", "Camisetas de algodão"],
    ["Blusa com botões e gola alta para mulheres, moda coreana 2026 outono", "Blusa com botões"],
    ["Tático masculino jaqueta + calça camuflada à prova de vento e chuva", "Jaqueta e calça"],
    ["Moletom com Capuz Masculino + Conjunto de Calças Esportivas de Duas Peças", "Moletom com capuz"],
    ["Camisa + preço especial masculina de linho com botões e gola padre", "Camisa"],
    ["Novo Y2K Harajuku Streetwear Calças Cargo Homens Hip Hop Baggy Pants", "Calças cargo"],
  ]
  for (const [name, short] of cases) test(short, () => expect(shortPieceName(name)).toBe(short))
  test("a short name is kept as written", () => expect(shortPieceName("Blusa básica branca (teste)")).toBe("Blusa básica branca (teste)"))
  test("without a known garment it cuts on a word", () => {
    const out = shortPieceName("Y2K Harajuku Streetwear Oversized Gothic Punk Emo Alternative Aesthetic Vintage")
    expect(out.length).toBeLessThanOrEqual(41)
    expect(out.endsWith("…")).toBe(true)
    expect(out.startsWith("Y2K Harajuku")).toBe(true)
  })
  test("only the garment noun when the next word adds nothing", () => expect(shortPieceName("Saia 2026 Nova Coleção Elegante Verão Casual Moda Feminina Cintura")).toBe("Saia"))
})

describe("lookTitle", () => {
  const p = (name: string) => ({ product: { name } })
  test("several pieces: garments only, in the order of the look", () =>
    expect(lookTitle({ title: "x + y + z", pieces: [p("Calça Pantalona Feminina Cintura Alta Wide Leg Social"), p("2026 Novo Suéter Feminino de Tricô Gola Redonda Manga"), p("Jaqueta Corta-Vento Masculina e Feminina Impermeável")] })).toBe("Calça, suéter e jaqueta"))
  test("two pieces", () => expect(lookTitle({ title: "a + b", pieces: [p("Vestido Longo Feminino Floral De Verão Praia Manga Curta"), p("Jaqueta Corta-Vento Masculina e Feminina Impermeável")] })).toBe("Vestido e jaqueta"))
  test("one piece: short piece name", () => expect(lookTitle({ title: "2026_27 Camisa de Futebol Colete La Coruña Torcedor Edição Especial", pieces: [p("2026_27 Camisa de Futebol Colete La Coruña Torcedor Edição Especial")] })).toBe("Camisa de futebol"))
  test("a short authored title is kept", () => expect(lookTitle({ title: "Noite de verão", pieces: [p("Vestido Longo Feminino Floral De Verão Praia Manga Curta"), p("Calça")] })).toBe("Noite de verão"))
  test("a long title without pieces is cut", () => expect(lookTitle({ title: "A".repeat(20) + " " + "B".repeat(60), pieces: [] }).length).toBeLessThanOrEqual(60))
  test("a piece without a known garment falls back to the short name of the first", () =>
    expect(lookTitle({ title: "a + b", pieces: [p("Y2K Harajuku Streetwear Oversized Gothic Punk Emo Alternative"), p("Calça Pantalona Feminina Cintura Alta Wide Leg Social")] })).toBe("Look com 2 peças"))
})
