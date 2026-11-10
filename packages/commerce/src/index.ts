import type { MoneyMinor, SourceKey } from "@stylai/contracts"

/** Server-only. Customer collection and supplier procurement are different flows. */
export interface SourceIdentity {
  source: SourceKey
  connectionId: string
  sellerId: string
  region: string
  externalProductId: string
  externalVariantId: string
}
export interface CheckoutIntent { orderId: string; quoteId: string; total: MoneyMinor }
export const paymentProcessor = "asaas" as const
export const implementationStatus = "not_implemented" as const
