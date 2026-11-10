import type { GarmentSelection } from "@stylai/contracts"

/** Server-only. Implement using the Segmind integration spec, not a fake renderer. */
export interface TryOnRequest {
  jobId: string
  selection: GarmentSelection
  providerRequestKey: string
}
export interface TryOnOperation { requestId: string }
export interface TryOnProvider {
  submit(input: TryOnRequest): Promise<TryOnOperation>
}
export const implementationStatus = "not_implemented" as const
