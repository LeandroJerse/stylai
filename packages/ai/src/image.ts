/** Decodes only the container header: MIME and pixel size. No trust in file names or vendor content-type. */
export interface ImageInfo { mime: "image/png" | "image/jpeg" | "image/webp"; width: number; height: number }

export const imageLimits = { maxBytes: 12_582_912, maxPixels: 24_000_000 } as const

function u32be(b: Uint8Array, o: number) { return ((b[o]! << 24) >>> 0) + (b[o + 1]! << 16) + (b[o + 2]! << 8) + b[o + 3]! }
function u16be(b: Uint8Array, o: number) { return (b[o]! << 8) + b[o + 1]! }
function u16le(b: Uint8Array, o: number) { return b[o]! + (b[o + 1]! << 8) }
function u24le(b: Uint8Array, o: number) { return b[o]! + (b[o + 1]! << 8) + (b[o + 2]! << 16) }

export function sniffImage(bytes: Uint8Array): ImageInfo | null {
  if (bytes.length >= 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    && String.fromCharCode(...bytes.subarray(12, 16)) === "IHDR") {
    return { mime: "image/png", width: u32be(bytes, 16), height: u32be(bytes, 20) }
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let o = 2
    while (o + 9 < bytes.length) {
      if (bytes[o] !== 0xff) return null
      const marker = bytes[o + 1]!
      if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) { o += 2; continue }
      const length = u16be(bytes, o + 2)
      if (length < 2) return null
      const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
      if (isSof) return { mime: "image/jpeg", height: u16be(bytes, o + 5), width: u16be(bytes, o + 7) }
      o += 2 + length
    }
    return null
  }
  if (bytes.length >= 30 && String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF" && String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP") {
    const chunk = String.fromCharCode(...bytes.subarray(12, 16))
    if (chunk === "VP8X") return { mime: "image/webp", width: u24le(bytes, 24) + 1, height: u24le(bytes, 27) + 1 }
    if (chunk === "VP8L" && bytes[20] === 0x2f) {
      const b = bytes
      const width = 1 + (((b[22]! & 0x3f) << 8) | b[21]!)
      const height = 1 + (((b[24]! & 0x0f) << 10) | (b[23]! << 2) | ((b[22]! & 0xc0) >> 6))
      return { mime: "image/webp", width, height }
    }
    if (chunk === "VP8 " && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
      return { mime: "image/webp", width: u16le(bytes, 26) & 0x3fff, height: u16le(bytes, 28) & 0x3fff }
    }
  }
  return null
}

/** Throws a sanitized code when the bytes are not an acceptable output image. */
export function validateOutputImage(bytes: Uint8Array): ImageInfo {
  if (bytes.length < 1 || bytes.length > imageLimits.maxBytes) throw new Error("output_size_invalid")
  const info = sniffImage(bytes)
  if (!info) throw new Error("output_not_image")
  if (info.width < 1 || info.height < 1 || info.width * info.height > imageLimits.maxPixels) throw new Error("output_dimensions_invalid")
  return info
}

export type StripResult = { ok: true; bytes: Uint8Array; removed: number } | { ok: false; reason: "rotated" | "malformed" }

/** EXIF orientation (1 = upright) from a JPEG APP1 segment, or null when absent. */
function jpegOrientation(seg: Uint8Array): number | null {
  // seg starts at the APP1 payload: "Exif\0\0" + TIFF header.
  if (seg.length < 14 || String.fromCharCode(...seg.subarray(0, 4)) !== "Exif") return null
  const t = seg.subarray(6)
  const le = t[0] === 0x49 && t[1] === 0x49
  const r16 = (o: number) => (le ? t[o]! + (t[o + 1]! << 8) : (t[o]! << 8) + t[o + 1]!)
  const r32 = (o: number) => (le ? t[o]! + (t[o + 1]! << 8) + (t[o + 2]! << 16) + t[o + 3]! * 2 ** 24 : t[o]! * 2 ** 24 + (t[o + 1]! << 16) + (t[o + 2]! << 8) + t[o + 3]!)
  const ifd = r32(4)
  if (ifd + 2 > t.length) return null
  const n = r16(ifd)
  for (let i = 0; i < n; i++) {
    const e = ifd + 2 + i * 12
    if (e + 12 > t.length) return null
    if (r16(e) === 0x0112) return r16(e + 8)
  }
  return null
}

/**
 * Removes metadata (EXIF incl. GPS, XMP, IPTC, comments, PNG text chunks) from
 * an uploaded photo without decoding pixels. A JPEG whose EXIF says it must be
 * rotated is refused: dropping the tag would silently turn the photo sideways.
 */
export function stripImageMetadata(bytes: Uint8Array): StripResult {
  const info = sniffImage(bytes)
  if (!info) return { ok: false, reason: "malformed" }
  const out: Uint8Array[] = []
  let removed = 0
  if (info.mime === "image/jpeg") {
    out.push(bytes.subarray(0, 2))
    let o = 2
    while (o + 4 <= bytes.length) {
      if (bytes[o] !== 0xff) return { ok: false, reason: "malformed" }
      const marker = bytes[o + 1]!
      if (marker === 0xda) { out.push(bytes.subarray(o)); o = bytes.length; break }
      if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) { out.push(bytes.subarray(o, o + 2)); o += 2; continue }
      const length = u16be(bytes, o + 2)
      if (length < 2 || o + 2 + length > bytes.length) return { ok: false, reason: "malformed" }
      const segment = bytes.subarray(o, o + 2 + length)
      const payload = bytes.subarray(o + 4, o + 2 + length)
      const isIcc = marker === 0xe2 && String.fromCharCode(...payload.subarray(0, 11)) === "ICC_PROFILE"
      if (marker === 0xe1) {
        const orientation = jpegOrientation(payload)
        if (orientation !== null && orientation !== 1) return { ok: false, reason: "rotated" }
      }
      if ((marker >= 0xe1 && marker <= 0xef && !isIcc) || marker === 0xfe) removed++
      else out.push(segment)
      o += 2 + length
    }
    if (o < bytes.length) return { ok: false, reason: "malformed" }
  } else if (info.mime === "image/png") {
    out.push(bytes.subarray(0, 8))
    let o = 8
    const drop = new Set(["tEXt", "iTXt", "zTXt", "eXIf", "tIME"])
    while (o + 12 <= bytes.length) {
      const length = u32be(bytes, o)
      const type = String.fromCharCode(...bytes.subarray(o + 4, o + 8))
      const end = o + 12 + length
      if (end > bytes.length) return { ok: false, reason: "malformed" }
      if (drop.has(type)) removed++
      else out.push(bytes.subarray(o, end))
      o = end
      if (type === "IEND") break
    }
  } else {
    // WebP: drop EXIF/XMP chunks, clear their VP8X flags and fix the RIFF size.
    const chunks: Uint8Array[] = []
    let o = 12
    while (o + 8 <= bytes.length) {
      const type = String.fromCharCode(...bytes.subarray(o, o + 4))
      const size = bytes[o + 4]! + (bytes[o + 5]! << 8) + (bytes[o + 6]! << 16) + bytes[o + 7]! * 2 ** 24
      const end = o + 8 + size + (size % 2)
      if (end > bytes.length) return { ok: false, reason: "malformed" }
      if (type === "EXIF" || type === "XMP ") removed++
      else {
        const chunk = bytes.slice(o, end)
        if (type === "VP8X") chunk[8] = chunk[8]! & ~0x0c
        chunks.push(chunk)
      }
      o = end
    }
    const total = chunks.reduce((n, c) => n + c.length, 4)
    const header = new Uint8Array(12)
    header.set(bytes.subarray(0, 4), 0)
    header[4] = total & 0xff; header[5] = (total >> 8) & 0xff; header[6] = (total >> 16) & 0xff; header[7] = (total >>> 24) & 0xff
    header.set(bytes.subarray(8, 12), 8)
    out.push(header, ...chunks)
  }
  const size = out.reduce((n, c) => n + c.length, 0)
  const result = new Uint8Array(size)
  let at = 0
  for (const c of out) { result.set(c, at); at += c.length }
  return sniffImage(result) ? { ok: true, bytes: result, removed } : { ok: false, reason: "malformed" }
}
