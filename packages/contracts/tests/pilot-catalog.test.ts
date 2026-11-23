import { describe, expect, test } from "bun:test"
import { PILOT_SELLER_ID, PILOT_SELLER_NAME, PilotCatalogValidationError, validatePilotCatalog } from "../src/pilot-catalog.js"

const validCc0Item = {
  externalProductId: "pilot-polo-azul-01",
  name: "Camisa polo azul (peça piloto)",
  category: "shirts",
  color: "azul",
  variantLabel: "Peça fotografada",
  imageUrl: "https://upload.wikimedia.org/wikipedia/commons/f/f7/Polo_shirt.jpg",
  rights: {
    basis: "cc0",
    sourcePageUrl: "https://commons.wikimedia.org/wiki/File:Polo_shirt.jpg",
    author: "David Ring",
    licenseLabel: "CC0 1.0",
    evidence: "Wikimedia Commons file page verified as CC0 1.0 Universal Public Domain Dedication.",
    verifiedAt: "2026-11-21",
    reviewer: "QA Pilot Triage",
    tryOnAllowed: true,
  },
}

describe("pilot catalog manifest validation (P1)", () => {
  test("accepts verified CC0 and owner_authorized real garments with no commercial offer fields", () => {
    const manifest = validatePilotCatalog({
      batchId: "pilot-real-2026-11-21",
      items: [
        validCc0Item,
        {
          externalProductId: "pilot-camiseta-propria-01",
          name: "Camiseta preta própria",
          category: "tops",
          color: "preto",
          variantLabel: "Tamanho M (peça própria)",
          imageUrl: "https://cdn.example.org/garments/own-tee.jpg",
          rights: {
            basis: "owner_authorized",
            sourcePageUrl: null,
            author: "Titular do piloto",
            licenseLabel: "Autorização direta do titular",
            evidence: "Foto própria da peça fornecida pelo titular para o piloto supervisionado.",
            verifiedAt: "2026-11-21",
            reviewer: "Leandro",
            tryOnAllowed: true,
          },
        },
      ],
    })
    expect(manifest.seller).toBe(PILOT_SELLER_ID)
    expect(manifest.sellerName).toBe(PILOT_SELLER_NAME)
    expect(manifest.items).toHaveLength(2)
  })

  test("rejects missing AI try-on rights or unconfirmed store references (e.g. SHEIN)", () => {
    expect(() => validatePilotCatalog({
      batchId: "pilot-bad-rights",
      items: [{ ...validCc0Item, rights: { ...validCc0Item.rights, basis: "unconfirmed" } }],
    })).toThrow(PilotCatalogValidationError)

    expect(() => validatePilotCatalog({
      batchId: "pilot-no-tryon",
      items: [{ ...validCc0Item, rights: { ...validCc0Item.rights, tryOnAllowed: false } }],
    })).toThrow(PilotCatalogValidationError)
  })

  test("rejects disguised synthetic test-catalog or localhost images", () => {
    expect(() => validatePilotCatalog({
      batchId: "pilot-fake-img",
      items: [{ ...validCc0Item, imageUrl: "https://test-catalog.stylai.invalid/blusa-basica-branca.png" }],
    })).toThrow(PilotCatalogValidationError)

    expect(() => validatePilotCatalog({
      batchId: "pilot-local-img",
      items: [{ ...validCc0Item, imageUrl: "http://127.0.0.1:5190/blusa.png" }],
    })).toThrow(PilotCatalogValidationError)
  })

  test("rejects unsupported categories, duplicate ids, and invented commercial prices or store links", () => {
    expect(() => validatePilotCatalog({
      batchId: "pilot-bad-cat",
      items: [{ ...validCc0Item, category: "sets" }],
    })).toThrow(PilotCatalogValidationError)

    expect(() => validatePilotCatalog({
      batchId: "pilot-dup",
      items: [validCc0Item, validCc0Item],
    })).toThrow(PilotCatalogValidationError)

    expect(() => validatePilotCatalog({
      batchId: "pilot-price",
      items: [{ ...validCc0Item, priceMinor: 9990 }],
    })).toThrow(PilotCatalogValidationError)

    expect(() => validatePilotCatalog({
      batchId: "pilot-link",
      items: [{ ...validCc0Item, productUrl: "https://br.shein.com/item-123.html" }],
    })).toThrow(PilotCatalogValidationError)
  })
})
