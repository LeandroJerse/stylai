import { describe, expect, test } from "bun:test"
import { errorFromResponse, messageOf } from "../src/api/errors"
import { parseRules } from "../src/api/parse"
import { formatRoute, needsAccount, parseRoute } from "../src/app/routes"
import { emailError, nameError, newPasswordError, passwordChecks } from "../src/auth/validation"
import { normalizeBaseUrl } from "../src/config/env"
import { fileProblem } from "../src/lib/images"
import { resolvePartnerLink } from "../src/lib/links"
import { relaxRule, summarizeRules } from "../src/lib/rules"

describe("routes", () => {
  test("tabs and defaults", () => {
    expect(parseRoute("#/estudio")).toEqual({ kind: "tab", tab: "estudio" })
    expect(parseRoute("")).toEqual({ kind: "tab", tab: "explorar" })
    expect(parseRoute("#/qualquer-coisa")).toEqual({ kind: "tab", tab: "explorar" })
  })
  test("auth routes keep a valid next and the reset token", () => {
    expect(parseRoute("#/entrar?next=closet")).toEqual({ kind: "auth", screen: "entrar", next: "closet", token: null })
    expect(parseRoute("#/entrar?next=javascript:x")).toEqual({ kind: "auth", screen: "entrar", next: null, token: null })
    expect(parseRoute("#/redefinir-senha?token=abc.123")).toEqual({ kind: "auth", screen: "redefinir-senha", next: null, token: "abc.123" })
  })
  test("format round-trips", () => {
    const r = { kind: "auth", screen: "criar-conta", next: "estudio", token: null } as const
    expect(parseRoute(formatRoute(r))).toEqual(r)
    expect(formatRoute({ kind: "tab", tab: "perfil" })).toBe("#/perfil")
  })
  test("only Explorar is public", () => {
    expect(needsAccount("explorar")).toBe(false)
    expect(needsAccount("closet")).toBe(true)
  })
})

describe("validation", () => {
  test("email", () => {
    expect(emailError("")).not.toBeNull()
    expect(emailError("ana@")).not.toBeNull()
    expect(emailError("  ana@exemplo.com.br ")).toBeNull()
  })
  test("new password needs length, a letter and a number", () => {
    expect(newPasswordError("")).not.toBeNull()
    expect(newPasswordError("abcdefgh")).toContain("um número")
    expect(newPasswordError("12345678")).toContain("uma letra")
    expect(newPasswordError("ção12345")).toBeNull()
    expect(newPasswordError("a1".repeat(70))).not.toBeNull()
    expect(passwordChecks("a1").filter((c) => c.ok).map((c) => c.id)).toEqual(["letter", "number"])
  })
  test("name", () => {
    expect(nameError("   ")).not.toBeNull()
    expect(nameError("Ana")).toBeNull()
  })
})

describe("config", () => {
  test("base URL: absolute http(s), no trailing slash", () => {
    expect(normalizeBaseUrl("https://api.stylai.app/v1/")).toBe("https://api.stylai.app/v1")
    expect(normalizeBaseUrl(" ")).toBeNull()
    expect(normalizeBaseUrl("ftp://x")).toBeNull()
    expect(normalizeBaseUrl("api.stylai.app")).toBeNull()
    expect(normalizeBaseUrl(undefined)).toBeNull()
  })
})

describe("errors", () => {
  test("server message wins; fallback copy otherwise", () => {
    expect(errorFromResponse(402, { error: { code: "insufficient_tokens", message: "Faltam 3 tokens." } }, null).message).toBe("Faltam 3 tokens.")
    expect(errorFromResponse(404, null, null).code).toBe("not_found")
    expect(messageOf(new Error("x"))).toBe("Algo deu errado. Tente de novo.")
  })
})

describe("partner links", () => {
  test("affiliate first, marked sponsored; then direct; else none", () => {
    expect(resolvePartnerLink({ affiliateUrl: "https://a", productUrl: "https://b" })).toEqual({ kind: "affiliate", href: "https://a", rel: "sponsored noopener noreferrer" })
    expect(resolvePartnerLink({ affiliateUrl: null, productUrl: "https://b" }).kind).toBe("direct")
    expect(resolvePartnerLink({ affiliateUrl: null, productUrl: null }).kind).toBe("none")
  })
})

describe("preference rules", () => {
  const base = parseRules({ minRating: { value: 4.5, mode: "require" }, budget: { value: 800, scope: "look", mode: "require" }, excludedPartners: ["x"] })
  test("relax switches off exactly one criterion, without touching the original", () => {
    const r = relaxRule(base, "budget")
    expect(r?.budget.mode).toBe("off")
    expect(r?.minRating.mode).toBe("require")
    expect(base.budget.mode).toBe("require")
    expect(relaxRule(base, "partners")?.excludedPartners).toEqual([])
    expect(relaxRule(base, "unknown-id")).toBeNull()
  })
  test("summary", () => {
    expect(summarizeRules(base)).toContain("Exige nota")
    expect(summarizeRules(parseRules({}))).toBe("Sem exigências")
  })
})

describe("image pre-checks", () => {
  const limits = { acceptedImageTypes: ["image/jpeg", "image/png"], maxImageBytes: 1024 * 1024, minImageHeight: 0 }
  test("type and size", () => {
    expect(fileProblem({ name: "a.gif", type: "image/gif", size: 10 }, limits)).toContain("JPG, PNG")
    expect(fileProblem({ name: "a.jpg", type: "image/jpeg", size: 5 * 1024 * 1024 }, limits)).toContain("limite")
    expect(fileProblem({ name: "a.jpg", type: "image/jpeg", size: 10 }, limits)).toBeNull()
  })
})
