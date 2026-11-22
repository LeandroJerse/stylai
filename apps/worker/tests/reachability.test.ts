// Real mode refuses inputs a paid provider cannot fetch BEFORE any spend (honest error, no charge).
import { expect, test } from "bun:test"
import { publiclyFetchable } from "../src/engine"

test("local, private and test-catalog addresses are never sent to a real provider", () => {
  for (const url of [
    "https://test-catalog.stylai.invalid/blusa-basica-branca.png", "http://127.0.0.1:54321/storage/v1/object/sign/x", "https://localhost/x.png",
    "https://192.168.0.10/x.png", "https://10.1.2.3/x.png", "https://172.20.0.1/x.png", "https://fixtures.stylai.test/a.png", "ftp://example.com/x", "not a url",
  ]) expect([url, publiclyFetchable(url)]).toEqual([url, false])
  expect(publiclyFetchable("https://cdn.example.com/garment.png")).toBe(true)
})
