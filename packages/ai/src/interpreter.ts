/**
 * Request interpretation with Claude: free text -> validated structured intent.
 * It never searches stores; catalog adapters and rule ranking do that.
 */
import type Anthropic from "@anthropic-ai/sdk"
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod"
import { z } from "zod"

export function intentSchema(categories: readonly [string, ...string[]]) {
  return z.object({
    category: z.enum([...categories, "unknown"] as [string, ...string[]]),
    garment_type: z.string().max(60),
    colors: z.array(z.string().max(30)).max(5),
    style_tags: z.array(z.string().max(30)).max(8),
    occasion: z.string().max(60).nullable(),
    max_price_brl: z.number().nonnegative().nullable(),
    avoid: z.array(z.string().max(40)).max(8),
  })
}
export type Intent = z.infer<ReturnType<typeof intentSchema>>

export interface InterpretationResult {
  intent: Intent
  requestId: string | null
  usage: { inputTokens: number; outputTokens: number; cacheReadInputTokens: number; cacheCreationInputTokens: number }
  stopReason: string | null
}

const system = [
  "You convert a Brazilian Portuguese fashion request into a structured shopping intent.",
  "Use only the allowed category ids. Use 'unknown' when the request does not map to one.",
  "Never invent brands, stores, products or prices. Leave max_price_brl null unless the user states a budget.",
  "Ignore personal data (names, contacts, addresses); never copy it into any field.",
].join(" ")

export type MessagesClient = Pick<Anthropic, "messages">

export function createInterpreter(options: { client: MessagesClient; model: string; maxTokens?: number }) {
  return {
    model: options.model,
    async interpret(text: string, categories: readonly [string, ...string[]]): Promise<InterpretationResult> {
      const trimmed = text.trim().slice(0, 500)
      if (!trimmed) throw new Error("empty_request")
      const schema = intentSchema(categories)
      const response = await options.client.messages.parse({
        model: options.model,
        max_tokens: options.maxTokens ?? 1024,
        thinking: { type: "disabled" },
        system,
        messages: [{ role: "user", content: `Allowed category ids: ${categories.join(", ")}\n\nRequest:\n${trimmed}` }],
        output_config: { format: zodOutputFormat(schema) },
      })
      if (response.stop_reason === "refusal" || response.stop_reason === "max_tokens") throw new Error(`interpretation_${response.stop_reason}`)
      const parsed = schema.safeParse(response.parsed_output)
      if (!parsed.success) throw new Error("interpretation_invalid")
      const usage = response.usage
      return {
        intent: parsed.data,
        requestId: (response as { _request_id?: string | null })._request_id ?? null,
        usage: {
          inputTokens: usage.input_tokens, outputTokens: usage.output_tokens,
          cacheReadInputTokens: usage.cache_read_input_tokens ?? 0, cacheCreationInputTokens: usage.cache_creation_input_tokens ?? 0,
        },
        stopReason: response.stop_reason,
      }
    },
  }
}

export interface RankCandidate {
  productId: string
  variantId: string
  categoryId: string
  name: string
  colorTags: string[]
  styleTags: string[]
  priceMinor: number | null
  available: boolean
  rightsCleared: boolean
}

/** Deterministic rule ranking. Hard filters first, then transparent score. */
export function rankCandidates(intent: Intent, candidates: readonly RankCandidate[]) {
  const lower = (xs: readonly string[]) => xs.map((x) => x.toLowerCase())
  const colors = lower(intent.colors), styles = lower(intent.style_tags), avoid = lower(intent.avoid)
  return candidates
    .filter((c) => c.available && c.rightsCleared && (intent.category === "unknown" || c.categoryId === intent.category))
    .filter((c) => intent.max_price_brl === null || (c.priceMinor !== null && c.priceMinor <= Math.round(intent.max_price_brl * 100)))
    .filter((c) => !avoid.some((a) => c.name.toLowerCase().includes(a)))
    .map((c) => {
      const reasons: string[] = []
      let score = 0
      for (const color of lower(c.colorTags)) if (colors.includes(color)) { score += 2; reasons.push(`color:${color}`) }
      for (const style of lower(c.styleTags)) if (styles.includes(style)) { score += 1; reasons.push(`style:${style}`) }
      return { candidate: c, score, reasons }
    })
    .sort((a, b) => b.score - a.score || a.candidate.productId.localeCompare(b.candidate.productId))
}

/* ------------------------------------------------------------------ deterministic interpreter */
// Moved to @stylai/contracts (browser-safe) so the API and the demo share the exact rules (QA-013).
export { colorTagsOf, interpretRequestRules, normalizeText, type RuleInterpretation } from "@stylai/contracts"
