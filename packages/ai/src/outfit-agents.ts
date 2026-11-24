/**
 * Specialized outfit agents (separate prompts, minimal context, structured outputs):
 *   1. plan:    validated intent -> store queries (complete outfits first, then pieces). Never sees the raw request.
 *   2. compose: validated intent + COMPACT candidates under short aliases -> up to MAX_OUTFITS coordinated outfits.
 * The server stays sovereign: queries are sanitized, aliases map back to ids the store really returned and every outfit
 * is revalidated (validateOutfits). The model never approves rights, prices, availability or spending.
 */
import Anthropic from "@anthropic-ai/sdk"
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod"
import { z } from "zod"
import {
  MAX_OUTFITS, OUTFIT_SLOTS, OUTFIT_WINDOW_PER_SLOT, sanitizeBundleQuery, sanitizeSlotQuery, SLOT_IDS, validateOutfits,
  type CompositionIntent, type LockedPieces, type OutfitCandidate, type OutfitPools, type OutfitProposal, type OutfitSlot, type SlotId, type ValidOutfit,
} from "@stylai/contracts"
import { AGENT_PROMPTS, DEFAULT_COMPOSER_MODEL, SELECT_TITLE_CHARS, type AgentPrompt } from "./agent-prompts.js"
import { ComposerResponseError, type ComposerUsage } from "./composer.js"
import type { MessagesClient } from "./interpreter.js"

const slotEnum = z.enum(SLOT_IDS as unknown as [string, ...string[]])
const outfitSlotEnum = z.enum(OUTFIT_SLOTS as unknown as [string, ...string[]])
const planOut = z.object({
  bundle_queries: z.array(z.string().max(80)).max(3),
  slot_queries: z.array(z.object({ slot: slotEnum, queries: z.array(z.string().max(80)).max(2) })).max(4),
})
const outfitsOut = z.object({
  outfits: z.array(z.object({
    title: z.string().max(60), rationale: z.string().max(160),
    pieces: z.array(z.object({ slot: outfitSlotEnum, id: z.string().max(24), why: z.string().max(80) })).min(1).max(3),
  })).max(MAX_OUTFITS),
})

export interface PlannedQueries { bundles: string[]; slots: Partial<Record<SlotId, string[]>>; usage: ComposerUsage; promptVersion: string }
export interface ComposedOutfits { outfits: ValidOutfit[]; rejected: { index: number; reason: string }[]; usage: ComposerUsage; promptVersion: string }
export interface OutfitAgents {
  readonly model: string
  plan(intent: CompositionIntent): Promise<PlannedQueries>
  compose(intent: CompositionIntent, pools: OutfitPools, options: { locked?: LockedPieces; exclude?: readonly string[]; max?: number }): Promise<ComposedOutfits>
}

/** What both roles may know about the request: the validated plan, never the raw text or free-form terms. */
const compactIntent = (intent: CompositionIntent) => ({
  audience: intent.audience ?? null, style: intent.style ?? [], occasion: intent.occasion, climate: intent.climate ?? null,
  slots: intent.slots.map((s) => ({ slot: s.slot, required: s.required, query: s.query ?? null, color: s.color ?? null })),
  budget_total_cents: intent.budgetTotalBrl === null ? null : Math.round(intent.budgetTotalBrl * 100), budget_mode: intent.budgetMode, avoid: intent.avoid,
})

export function createOutfitAgents(options: { client: MessagesClient; model?: string }): OutfitAgents {
  const model = options.model?.trim() || DEFAULT_COMPOSER_MODEL
  async function call<T extends z.ZodTypeAny>(prompt: AgentPrompt, content: string, schema: T): Promise<{ data: z.infer<T>; usage: ComposerUsage }> {
    const response = await options.client.messages.create({
      model, max_tokens: prompt.maxTokens, system: prompt.system, messages: [{ role: "user", content }],
      output_config: { effort: "low", format: zodOutputFormat(schema) },
    })
    const usage: ComposerUsage = { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens }
    if (response.stop_reason === "refusal" || response.stop_reason === "max_tokens") throw new ComposerResponseError(`composer_${response.stop_reason}`, usage)
    let raw: unknown
    try { raw = JSON.parse(response.content.filter((b) => b.type === "text").map((b) => b.text).join("")) } catch { throw new ComposerResponseError("composer_invalid", usage) }
    const parsed = schema.safeParse(raw)
    if (!parsed.success) throw new ComposerResponseError("composer_invalid", usage)
    return { data: parsed.data, usage }
  }

  return {
    model,
    async plan(intent) {
      const { data, usage } = await call(AGENT_PROMPTS.plan, `Plan: ${JSON.stringify(compactIntent(intent)).replace(/</g, "\\u003c")}`, planOut)
      const wanted = new Set(intent.slots.map((s) => s.slot))
      const slots: Partial<Record<SlotId, string[]>> = {}
      for (const entry of data.slot_queries) {
        const slot = entry.slot as SlotId
        if (!wanted.has(slot)) continue
        const clean = entry.queries.map((q) => sanitizeSlotQuery(q, slot)).filter((q): q is string => q !== null)
        if (clean.length) slots[slot] = [...new Set(clean)].slice(0, 2)
      }
      return {
        bundles: [...new Set(data.bundle_queries.map(sanitizeBundleQuery).filter((q): q is string => q !== null))].slice(0, 2),
        slots, usage, promptVersion: AGENT_PROMPTS.plan.version,
      }
    },

    async compose(intent, pools, { locked = {}, exclude = [], max = MAX_OUTFITS }) {
      const excluded = new Set(exclude)
      const byAlias = new Map<string, { slot: OutfitSlot; id: string }>()
      const aliasOf = new Map<string, string>()
      const candidates: Record<string, unknown[]> = {}
      const windows: OutfitPools = {}
      for (const slot of OUTFIT_SLOTS) {
        const pool = pools[slot] ?? []
        const lockedItem = locked[slot] ? pool.find((x) => x.id === locked[slot]) : undefined
        const window: OutfitCandidate[] = [...(lockedItem ? [lockedItem] : []), ...pool.filter((x) => x !== lockedItem && !excluded.has(x.id))].slice(0, OUTFIT_WINDOW_PER_SLOT)
        if (!window.length) continue
        windows[slot] = window
        candidates[slot] = window.map((x, i) => {
          const alias = `${slot}${i + 1}`
          byAlias.set(alias, { slot, id: x.id }); aliasOf.set(x.id, alias)
          return { id: alias, t: x.name.slice(0, SELECT_TITLE_CHARS), p: x.priceMinor, c: x.colorTags.slice(0, 3) }
        })
      }
      const lockedAliases = Object.fromEntries(Object.entries(locked).filter(([, id]) => id && aliasOf.has(id)).map(([slot, id]) => [slot, aliasOf.get(id!)]))
      const content = [
        `Plan: ${JSON.stringify(compactIntent(intent)).replace(/</g, "\\u003c")}`, `Max outfits: ${Math.min(max, MAX_OUTFITS)}`, `Locked: ${JSON.stringify(lockedAliases)}`,
        `<candidates>\n${JSON.stringify(candidates).replace(/</g, "\\u003c")}\n</candidates>`,
      ].join("\n")
      const { data, usage } = await call(AGENT_PROMPTS.outfits, content, outfitsOut)
      const proposals: OutfitProposal[] = data.outfits.map((o) => ({
        title: o.title, rationale: o.rationale,
        // An unknown alias stays unknown: validation rejects the whole outfit instead of guessing a product.
        pieces: o.pieces.map((x) => ({ slot: x.slot as OutfitSlot, productId: byAlias.get(x.id)?.id ?? `unknown:${x.id}`, reason: x.why })),
      }))
      const { outfits, rejected } = validateOutfits(intent, windows, proposals, { max, locked })
      return { outfits, rejected, usage, promptVersion: AGENT_PROMPTS.outfits.version }
    },
  }
}

/** Server factory: no SDK retries (a failure falls back to labelled rules instead of multiplying paid calls). */
export function createAnthropicOutfitAgents(options: { apiKey: string; model?: string; timeoutMs?: number }): OutfitAgents {
  return createOutfitAgents({ client: new Anthropic({ apiKey: options.apiKey, maxRetries: 0, timeout: options.timeoutMs ?? 25_000 }), model: options.model })
}
