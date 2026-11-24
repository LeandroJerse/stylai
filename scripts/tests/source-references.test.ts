import { describe, expect, test } from "bun:test"
import { validateSourceReferences, importSourceReferences, validateExistingSourceOwner } from "../import-authorized-source-references.js"

const fixture = () => ({
  evidence: "Operator declares AliExpress partnership and authorizes these garment images for try-on.",
  authorizedAt: "2026-11-24T00:30:00Z",
  items: [{ externalProductId: "123456", seller: "aliexpress-shop-123", sellerName: "Example shop", name: "Shirt",
    category: "shirts", imageUrl: "https://ae01.alicdn.com/example.jpg", productUrl: "https://www.aliexpress.com/item/123456.html",
    priceMinor: 9069, observedAt: "2026-11-24T00:26:00Z" }],
})
describe("authorized source reference importer", () => {
  test("a source product cannot silently change seller or have ambiguous mappings", () => {
    expect(() => validateExistingSourceOwner([{ id: "p1", partner_id: "sellerA" }], "sellerB")).toThrow()
    expect(() => validateExistingSourceOwner([{ id: "p1", partner_id: "sellerA" }, { id: "p2", partner_id: "sellerA" }], "sellerA")).toThrow()
    expect(() => validateExistingSourceOwner([{ id: "p1", partner_id: "sellerA" }], "sellerA")).not.toThrow()
  })
  test("dry run preserves observed commerce and does not require a database", async () => {
    const manifest = validateSourceReferences(fixture())
    const report = await importSourceReferences(manifest, { mode: "dry_run" })
    expect(report.mode).toBe("dry_run")
    expect(report.items[0]?.priceMinor).toBe(9069)
    expect(report.items[0]?.referenceKind).toBe("image_reference")
  })
  test("rejects untrusted image hosts, missing authorization, unidentified sellers and duplicate products", () => {
    const bad = fixture(); bad.items[0]!.imageUrl = "https://localhost/image.jpg"
    expect(() => validateSourceReferences(bad)).toThrow()
    expect(() => validateSourceReferences({ ...fixture(), evidence: "" })).toThrow()
    const seller = fixture(); seller.items[0]!.seller = "aliexpress-unidentified-shop"
    expect(() => validateSourceReferences(seller)).toThrow()
    const duplicate = fixture(); duplicate.items.push(duplicate.items[0]!)
    expect(() => validateSourceReferences(duplicate)).toThrow()
  })
})
