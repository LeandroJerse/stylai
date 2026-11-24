import { expect, test } from "bun:test"
import { parseAuthorization } from "../pilot"

const ok = ["--attempts=19", "--limit-usd=2", "--policy-references=on", "--note=Leandro, validação real do comparativo"]
test("authorization needs every number spelled out; nothing is defaulted or widened by omission", () => {
  expect(parseAuthorization(ok)).toEqual({ attempts: 19, limitMicros: 2_000_000, policyReferences: true, note: "Leandro, validação real do comparativo" })
  for (const i of ok.keys()) expect(() => parseAuthorization(ok.filter((_, j) => j !== i))).toThrow()
  for (const bad of ["--attempts=0", "--attempts=201", "--attempts=1.5"]) expect(() => parseAuthorization([bad, ...ok.slice(1)])).toThrow("--attempts")
  for (const bad of ["--limit-usd=0", "--limit-usd=21", "--limit-usd=abc"]) expect(() => parseAuthorization([ok[0]!, bad, ...ok.slice(2)])).toThrow("--limit-usd")
})
