import { createHmac } from "node:crypto"
import { describe, expect, test } from "bun:test"
import { buildTikTokSignBaseString, isValidTikTokTimestamp, signTikTokRequest } from "../src/index"

describe("TikTok Shop HMAC-SHA256 signing", () => {
  const secret = "fake_secret_for_independent_vector"
  const path = "/affiliate_creator/202405/open_collaborations/products/search"

  test("matches independent official algorithm, ignores sign/access_token and is invariant to key order", () => {
    const rawBody = JSON.stringify({ title_keywords: ["camisa", "off-white"] })
    const expected = createHmac("sha256", secret)
      .update(`${secret}${path}app_key6lvudbnilidmdpage_size20timestamp1732233600${rawBody}${secret}`, "utf8")
      .digest("hex")

    const sigA = signTikTokRequest({
      path,
      query: { timestamp: 1732233600, page_size: 20, app_key: "6lvudbnilidmd", sign: "must_be_ignored", access_token: "must_be_ignored" },
      rawBody,
      contentType: "application/json",
    }, secret)

    const sigB = signTikTokRequest({
      path,
      query: { app_key: "6lvudbnilidmd", page_size: 20, timestamp: 1732233600 },
      rawBody,
      contentType: "application/json",
    }, secret)

    expect(sigA).toBe(expected)
    expect(sigB).toBe(expected)
    expect(sigA).toMatch(/^[0-9a-f]{64}$/)
  })

  test("changing a single byte of rawBody changes signature; multipart bodies are excluded", () => {
    const sig1 = signTikTokRequest({ path, query: { app_key: "k", timestamp: 100 }, rawBody: "{\"a\":1}", contentType: "application/json" }, secret)
    const sig2 = signTikTokRequest({ path, query: { app_key: "k", timestamp: 100 }, rawBody: "{\"a\":2}", contentType: "application/json" }, secret)
    expect(sig1).not.toBe(sig2)

    const mpBase = buildTikTokSignBaseString({ path, query: { app_key: "k", timestamp: 100 }, rawBody: "--boundary...", contentType: "multipart/form-data; boundary=abc" })
    expect(mpBase).toBe(`${path}app_keyktimestamp100`)
  })

  test("validates timestamp window (-300s to +30s)", () => {
    const nowMs = 1_732_233_600_000
    expect(isValidTikTokTimestamp(1_732_233_600, nowMs)).toBe(true)
    expect(isValidTikTokTimestamp(1_732_233_300, nowMs)).toBe(true)
    expect(isValidTikTokTimestamp(1_732_233_630, nowMs)).toBe(true)
    expect(isValidTikTokTimestamp(1_732_233_299, nowMs)).toBe(false)
    expect(isValidTikTokTimestamp(1_732_233_631, nowMs)).toBe(false)
  })
})
