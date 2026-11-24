import { z } from "zod"
import type { FetchLike } from "./segmind.js"
import { validateOutputImage } from "./image.js"

export const GEMINI_OUTFIT_MODEL = "gemini-3-pro-image"
export const GEMINI_OUTFIT_RESERVE = 350_000n
export const GEMINI_OUTFIT_PRICE_VERSION = "google-nano-banana-pro-2k-2026-11-23"
// https://ai.google.dev/gemini-api/docs/pricing: input $2/M, text/thinking $12/M,
// 1K/2K image output 1120 tokens at $120/M. Computed estimate, not invoice confirmation.
type InlineImage = { bytes: Uint8Array; mime: string; url?: string }
export type OutfitInput = { person: InlineImage; garments: (InlineImage & { category: string; garmentType?: string; slot?: string | null })[] }
export function validateGeminiOutfitInput(input: OutfitInput): void {
  if(input.garments.length<1 || input.garments.length>3 || [input.person,...input.garments].some(i=>!i.bytes.length || !/^image\/(jpeg|png|webp)$/.test(i.mime)) ||
    [input.person,...input.garments].reduce((n,i)=>n+i.bytes.length,0)>14_000_000) throw new Error("invalid_outfit_inputs")
}
const quotaErrorSchema = z.object({ error: z.object({
  status: z.enum(["RESOURCE_EXHAUSTED", "PERMISSION_DENIED", "INVALID_ARGUMENT", "NOT_FOUND", "UNAUTHENTICATED"]).optional(),
  details: z.array(z.object({
    "@type": z.string(), retryDelay: z.string().regex(/^\d+(\.\d+)?s$/).optional(),
    violations: z.array(z.object({ quotaMetric: z.string().regex(/^[a-zA-Z0-9_./-]{1,200}$/).optional(),
      quotaId: z.string().regex(/^[a-zA-Z0-9_-]{1,200}$/).optional(), quotaValue: z.string().regex(/^\d+$/).optional() })).max(20).optional(),
  })).max(20).optional(),
}) })
type QuotaDiagnostic = { status?: string; retryDelay?: string; quotas: { metric?: string; id?: string; value?: string }[] }
async function quotaDiagnostic(response: Response): Promise<QuotaDiagnostic | undefined> {
  try {
    const parsed=quotaErrorSchema.safeParse(await response.json())
    if(!parsed.success) return undefined
    const details=parsed.data.error.details??[]
    return {status:parsed.data.error.status,
      retryDelay:details.find(d=>d["@type"]==="type.googleapis.com/google.rpc.RetryInfo")?.retryDelay,
      quotas:details.filter(d=>d["@type"]==="type.googleapis.com/google.rpc.QuotaFailure").flatMap(d=>(d.violations??[]).map(v=>({metric:v.quotaMetric,id:v.quotaId,value:v.quotaValue}))) }
  } catch { return undefined }
}
export type OutfitResult = { kind: "completed"; bytes: Uint8Array; requestId: string | null; computedMicros: bigint | null; usage: Record<string, number> }
  | { kind: "rejected"; code: string; diagnostic?: QuotaDiagnostic } | { kind: "unknown"; code: string }
const usageSchema = z.object({ promptTokenCount: z.number().int().nonnegative(), candidatesTokenCount: z.number().int().nonnegative(),
  thoughtsTokenCount: z.number().int().nonnegative().optional() })
const responseSchema = z.object({ responseId: z.string().max(200).optional(), usageMetadata: z.unknown().optional(),
  candidates: z.array(z.object({ finishReason: z.string().optional(), content: z.object({ parts: z.array(z.object({
    thought: z.boolean().optional(), inlineData: z.object({ mimeType: z.string(), data: z.string().max(18_000_000) }).optional(),
  }).passthrough()) }).optional() })).optional() })

export function buildOutfitPrompt(input: OutfitInput): string {
  return [
        "Create one photorealistic virtual try-on photograph. Image 1 is the only identity reference: preserve this exact person's face, glasses, hair, skin tone, body proportions, pose, hands, background and camera viewpoint.",
        "Replace only the requested clothing with the garments from the following images, composing the entire outfit in one coherent edit. Keep the garment's actual color, texture, cut, seams and details. Do not copy the reference models' faces, bodies, pose, background, advertising text or graphics.",
        ...(input.garments.some(g=>g.garmentType==="pants" || g.garmentType==="outfit_sets") ? ["For trousers preserve full length to the ankles with a natural hem and clean continuous fabric on both legs. Do not shorten trousers into shorts."] : []),
        "Preserve each garment's actual type and length: never change a skirt, dress or shorts into trousers. No white patches, duplicate legs, invented logos, exposed underwear or text on the waistband. Clothing must meet naturally at the waist; render a believable fit, not a pasted cutout. Preserve the original footwear. Keep the whole original person in frame.",
        ...input.garments.map((g,i)=>g.garmentType==="outfit_sets" ? `Image ${i+2}: a complete outfit sold as one set. Dress the person in EVERY garment of this set (top and bottom, plus blazer or vest when shown), keeping each garment exactly as shown.` : `Image ${i+2}: ${g.garmentType??g.category}, slot ${g.slot??g.category}${g.slot==="outer"?", worn over the inner shirt/top":""}. Ignore any other garments shown in this reference.`),
        "Return only one finished image. Before finalizing, check face consistency, anatomy, hands, garment boundaries, correct garment length, and absence of copied advertising text.",
      ].join("\n")
}

export const VERTEX_OUTFIT_MODEL = "gemini-nano-banana-2.1"
export const VERTEX_OUTFIT_RESERVE = 200_000n
export const VERTEX_OUTFIT_PRICE_VERSION = "vertex-nano-banana-21-1k-2026-11-23"
export function createGeminiOutfitClient(config: { apiKey: string; vertexProject?: string; fetch?: FetchLike }) {
  if(config.vertexProject!==undefined && !/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(config.vertexProject)) throw new Error('invalid_vertex_project')
  const vertex = config.vertexProject !== undefined
  const model = vertex ? VERTEX_OUTFIT_MODEL : GEMINI_OUTFIT_MODEL
  const endpoint = vertex
    ? `https://aiplatform.googleapis.com/v1/projects/${config.vertexProject}/locations/global/publishers/google/models/${model}:generateContent`
    : `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`
  const http = config.fetch ?? fetch
  return {
    model,
    async garment(imageUrl: string): Promise<InlineImage> {
      const u = new URL(imageUrl)
      if(u.protocol !== "https:" || u.username || u.password || u.port || !["alicdn.com","aliexpress-media.com"].some(h => u.hostname===h || u.hostname.endsWith(`.${h}`))) throw new Error("garment_host_not_allowed")
      const response = await http(u, { redirect: "error", signal: AbortSignal.timeout(20000) })
      if(!response.ok || !response.body) throw new Error("garment_download_failed")
      const parts: Uint8Array[] = []; let length = 0
      const reader = response.body.getReader()
      try { for(;;) { const chunk=await reader.read(); if(chunk.done) break; length+=chunk.value.length
        if(length>4_194_304) throw new Error("garment_too_large"); parts.push(chunk.value) } }
      finally { await reader.cancel().catch(()=>undefined) }
      const bytes = Buffer.concat(parts), info = validateOutputImage(bytes)
      return {bytes, mime: info.mime}
    },
    async generate(input: OutfitInput): Promise<OutfitResult> {
      validateGeminiOutfitInput(input)
      const instructions = buildOutfitPrompt(input)
      const parts = [{text:instructions}, ...[input.person,...input.garments].map(i=>({inlineData:{mimeType:i.mime,data:Buffer.from(i.bytes).toString("base64")}}))]
      try {
        const response=await http(endpoint,{
          method:"POST",headers:{"x-goog-api-key":config.apiKey,"Content-Type":"application/json"}, redirect:"error", signal:AbortSignal.timeout(100000),
          body:JSON.stringify({contents:[{role:"user",parts}],generationConfig:{responseModalities:["IMAGE"],candidateCount:1,maxOutputTokens:8192,...(vertex?{thinkingConfig:{thinkingLevel:"MINIMAL"}}:{}),imageConfig:{imageSize:vertex?"1K":"2K",aspectRatio:"3:4"}}}),
        })
        if(!response.ok) return [400,401,403,404,429].includes(response.status) ? {kind:"rejected",code:`gemini_http_${response.status}`,diagnostic:await quotaDiagnostic(response)} : {kind:"unknown",code:`gemini_http_${response.status}`}
        const parsed=responseSchema.safeParse(await response.json())
        if(!parsed.success) return {kind:"unknown",code:"gemini_bad_response"}
        const images=parsed.data.candidates?.flatMap(c=>c.content?.parts.filter(p=>p.inlineData && !p.thought)??[])??[]
        if(images.length!==1) return {kind:"unknown",code:"gemini_image_missing_or_multiple"}
        const inline=images[0]!.inlineData!
        if(!/^image\/(png|jpeg|webp)$/.test(inline.mimeType)) return {kind:"unknown",code:"gemini_image_type"}
        const usage=usageSchema.safeParse(parsed.data.usageMetadata)
        const units: Record<string,number>=usage.success ? {input_tokens:usage.data.promptTokenCount,output_tokens:usage.data.candidatesTokenCount,thinking_tokens:usage.data.thoughtsTokenCount??0} : {}
        const computed=usage.success && usage.data.candidatesTokenCount>=1120
          ? vertex
            ? 33600n+(BigInt(usage.data.promptTokenCount)*3n+BigInt(usage.data.candidatesTokenCount-1120+(usage.data.thoughtsTokenCount??0))*15n+1n)/2n
            : 134400n+BigInt(usage.data.promptTokenCount)*2n+BigInt(usage.data.candidatesTokenCount-1120+(usage.data.thoughtsTokenCount??0))*12n : null
        return {kind:"completed",bytes:Buffer.from(inline.data,"base64"),requestId:parsed.data.responseId??null,computedMicros:computed,usage:units}
      } catch { return {kind:"unknown",code:"gemini_transport_or_response_unknown"} }
    },
  }
}
export type GeminiOutfitClient = ReturnType<typeof createGeminiOutfitClient>
