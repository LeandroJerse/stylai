import { expect, test } from "bun:test"
import { encodePrivateArgs } from "../src/private-transactions"

test("jsonb parameters are sent as JSON text (arrays would otherwise become Postgres array literals)", () => {
  const items = [{ slot: "lower", product_id: "p" }]
  expect(encodePrivateArgs(["uuid", "jsonb", "jsonb", "text"], ["u", items, { a: 1 }, "t"])).toEqual(["u", JSON.stringify(items), "{\"a\":1}", "t"])
  expect(encodePrivateArgs(["jsonb"], [null])).toEqual([null])
})
