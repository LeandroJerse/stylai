import { expect, test } from "bun:test"
import { COINS_PER_REQUEST, coinsFromRequests, PLAN_COINS } from "../src/coins"

test("moedas follow the documented daily requests: free 3 -> 30, paid 12 -> 120, 10 per generation", () => {
  expect(COINS_PER_REQUEST).toBe(10)
  expect(coinsFromRequests(3)).toBe(PLAN_COINS.free)
  expect(coinsFromRequests(12)).toBe(PLAN_COINS.paid)
  expect(coinsFromRequests(12 - 2)).toBe(100)
  expect(coinsFromRequests(-1)).toBe(0)
})
