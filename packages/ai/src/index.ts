/** Server-only provider adapters, pricing and telemetry. Never import from the browser. */
export * from "./pricing.js"
export * from "./image.js"
export * from "./segmind.js"
export * from "./fal.js"
export * from "./interpreter.js"
export * from "./composer.js"
export * from "./telemetry.js"

/** Garment categories the try-on provider can render in this slice (config-driven). */
export const implementationStatus = "first_slice" as const
