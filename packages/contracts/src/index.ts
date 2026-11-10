/** Browser-safe shared interfaces. No provider SDK, server config or secrets. */
export interface ApiErrorBody {
  error: { code: string; message: string; fields?: Record<string, string> }
}

export interface HealthStatus {
  status: "ok" | "not_ready"
  service: "api" | "worker"
}

/** Future route schemas must validate these values at runtime as well. */
export interface GarmentSelection {
  productId: string
  variantId: string
  bodyPhotoId: string
}

export type SourceKey = "aliexpress" | "shopee" | "tiktok_shop"
export interface MoneyMinor { minor: number; currency: string }

export function apiError(code: string, message: string): ApiErrorBody {
  return { error: { code, message } }
}
