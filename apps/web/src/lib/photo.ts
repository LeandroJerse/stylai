export const MIN_PHOTO_HEIGHT = 600

/**
 * Re-encodes in the browser: applies the camera orientation and drops all metadata
 * (EXIF/GPS) before upload. The server strips metadata again.
 */
export async function normalizePhoto(file: File): Promise<File> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" })
  const scale = Math.min(1, 2048 / Math.max(bitmap.width, bitmap.height))
  const width = Math.round(bitmap.width * scale)
  const height = Math.round(bitmap.height * scale)
  if (height < MIN_PHOTO_HEIGHT) throw new Error(`A foto precisa ter pelo menos ${MIN_PHOTO_HEIGHT} px de altura.`)
  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext("2d")
  if (!ctx) throw new Error("Seu navegador não conseguiu preparar a foto.")
  ctx.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92))
  if (!blob) throw new Error("Seu navegador não conseguiu preparar a foto.")
  return new File([blob], "foto-frente.jpg", { type: "image/jpeg" })
}
