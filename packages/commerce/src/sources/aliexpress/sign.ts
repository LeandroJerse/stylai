/**
 * AliExpress Open Platform request signing (HMAC-SHA256, `sign_method=sha256`).
 * Source: https://openservice.aliexpress.com/doc/doc.htm#/?docId=1386 (Signature algorithm) and
 * https://openservice.aliexpress.com/doc/doc.htm#/?docId=1385 (HTTP request sample, test vectors).
 *   1. Take every request parameter except `sign` (business APIs include `method` as a parameter).
 *   2. Sort by parameter name (ASCII order) and concatenate `key + value`, skipping empty values.
 *   3. System APIs only (e.g. `/auth/token/create`): prepend the API path.
 *   4. HMAC-SHA256 over the UTF-8 string with the App Secret as key; uppercase hex digest.
 */
import { createHmac } from "node:crypto"

export const ALIEXPRESS_SIGN_METHOD = "sha256" as const

export type AliExpressParams = Record<string, string | number | undefined>

export function buildAliExpressSignBase(params: AliExpressParams, systemApiPath?: string): string {
  if (systemApiPath !== undefined && !systemApiPath.startsWith("/")) throw new Error("AliExpress system API path must start with '/'")
  const keys = Object.keys(params)
    .filter((key) => key !== "sign" && params[key] !== undefined && String(params[key]) !== "")
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  return `${systemApiPath ?? ""}${keys.map((key) => `${key}${String(params[key])}`).join("")}`
}

export function signAliExpressRequest(params: AliExpressParams, appSecret: string, systemApiPath?: string): string {
  if (!appSecret) throw new Error("AliExpress appSecret is required for signing")
  return createHmac("sha256", appSecret).update(buildAliExpressSignBase(params, systemApiPath), "utf8").digest("hex").toUpperCase()
}
