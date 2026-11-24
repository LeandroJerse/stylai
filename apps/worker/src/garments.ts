/** Garment bytes for one generation: the verified private copy first, then the very same image from the store (hash checked). */
import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { isTestImageUrl, TEST_IMAGE_ORIGIN } from "@stylai/contracts"
import type { ReferenceDownloader } from "@stylai/ai"
import type { PrivateObjectStore } from "@stylai/supabase"

export interface CachedReference { sha256: string; object_key: string; mime: "image/jpeg" | "image/png" | "image/webp" }
export type GarmentLoader = (url: string, reference: CachedReference | undefined) => Promise<{ bytes: Uint8Array; mime: string }>

const TEST_IMAGE_DIR = fileURLToPath(new URL("../../../packages/contracts/assets/test-catalog/", import.meta.url))

export function createGarmentLoader(deps: {
  store: PrivateObjectStore
  download: ReferenceDownloader
  /** Manually authorized products without a cached copy keep the provider client's own bounded download. */
  fallback: (url: string) => Promise<{ bytes: Uint8Array; mime: string }>
  /** Simulation only: synthetic test-catalog images are files of this repository. */
  testImages: boolean
}): GarmentLoader {
  return async (url, reference) => {
    if (deps.testImages && isTestImageUrl(url)) {
      const name = url.slice(TEST_IMAGE_ORIGIN.length)
      if (!/^[a-z0-9-]+\.png$/.test(name)) throw new Error("garment_download_failed")
      return { bytes: new Uint8Array(await readFile(`${TEST_IMAGE_DIR}${name}`)), mime: "image/png" }
    }
    if (!reference) return deps.fallback(url)
    const cached = await deps.store.get("references", reference.object_key).catch(() => null)
    if (cached && createHash("sha256").update(cached).digest("hex") === reference.sha256) return { bytes: cached, mime: reference.mime }
    const image = await deps.download(url)
    if (image.sha256 !== reference.sha256) throw new Error("garment_image_changed")
    return { bytes: image.bytes, mime: image.mime }
  }
}
