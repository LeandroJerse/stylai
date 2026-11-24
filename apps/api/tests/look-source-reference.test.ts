import { expect, test } from "bun:test"
import { presentPiece } from "../src/modules/studio/routes.js"

test("reopened source look preserves commerce without exposing a visual reference as stock", () => {
  const piece = presentPiece({ name: "Shirt", source: "aliexpress", partner: "Seller", reference_kind: "image_reference",
    canonical_id: "aliexpress:123", affiliate_url: "https://s.click.aliexpress.com/e/example", variant_label: "Visual reference",
    product_url: "https://www.aliexpress.com/item/123.html" }, "internal-product", "internal-variant", "http://localhost/v1", [])
  expect(piece.product.id).toBe("aliexpress:123")
  expect(piece.product.variants).toEqual([])
  expect(piece.product.links.affiliateUrl).toBe("https://s.click.aliexpress.com/e/example")
})
