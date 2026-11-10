/**
 * Client-side pre-checks for image uploads (body photos, Estúdio references). Limits come from
 * GET /studio/config; the API validates again and its answer wins.
 */
import type { StudioConfig } from "../api/types"
import { formatMB } from "./format"

const TYPE_LABEL: Record<string, string> = { "image/jpeg": "JPG", "image/png": "PNG", "image/webp": "WEBP", "image/heic": "HEIC", "image/heif": "HEIF" }

export const typesText = (types: string[]): string => types.map((t) => TYPE_LABEL[t] ?? t.replace("image/", "").toUpperCase()).join(", ")

export type ImageLimits = Pick<StudioConfig, "acceptedImageTypes" | "maxImageBytes" | "minImageHeight">

/** Synchronous checks (type and size). Returns the problem in Portuguese, or null. */
export function fileProblem(file: { name: string; type: string; size: number }, limits: ImageLimits): string | null {
  if (limits.acceptedImageTypes.length > 0 && !limits.acceptedImageTypes.includes(file.type)) return `“${file.name}” não é ${typesText(limits.acceptedImageTypes)}.`
  if (limits.maxImageBytes > 0 && file.size > limits.maxImageBytes) return `“${file.name}” tem ${formatMB(file.size)}; o limite é ${formatMB(limits.maxImageBytes)}.`
  return null
}

/** Full pre-check, including decoding the image to read its height. */
export function checkImageFile(file: File, limits: ImageLimits): Promise<string | null> {
  const quick = fileProblem(file, limits)
  if (quick) return Promise.resolve(quick)
  if (limits.minImageHeight <= 0) return Promise.resolve(null)
  const url = URL.createObjectURL(file)
  return new Promise((resolve) => {
    const probe = new Image()
    probe.onload = () => {
      URL.revokeObjectURL(url)
      resolve(probe.naturalHeight < limits.minImageHeight ? `“${file.name}” tem ${probe.naturalHeight}px de altura; use pelo menos ${limits.minImageHeight}px.` : null)
    }
    probe.onerror = () => {
      URL.revokeObjectURL(url)
      resolve(`Não conseguimos abrir “${file.name}”. O arquivo pode estar corrompido.`)
    }
    probe.src = url
  })
}
