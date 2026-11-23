/**
 * Specialized outfit agents (structured outputs, minimal context per role; instructions in agent-prompts.ts):
 *   1. interpret: delimited request text -> CompositionIntent (audience, slots with their own query/colour, budget);
 *   2. select: validated plan + COMPACT candidates (closed id list) -> one id per slot or an explicit abstention.
 * The server always revalidates (validateComposition); refusal, malformed output or an invalid choice makes the caller
 * use the labelled rules fallback. Store text is untrusted data: JSON inside a delimited block, "<" escaped.
 * Provider-independent contract: OutfitAgent (an adapter for another LLM only needs interpret/select).
 */
import { createHash } from "node:crypto"
import Anthropic from "@anthropic-ai/sdk"
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod"
import { z } from "zod"
import {
  normalizeSlots, SLOT_IDS, validateComposition,
  type CandidatesBySlot, type CompositionIntent, type CompositionValidation, type LockedSlots, type SlotId,
} from "@stylai/contracts"
import { AGENT_PROMPTS, DEFAULT_COMPOSER_MODEL, SELECT_TITLE_CHARS, SELECT_WINDOW_PER_SLOT, type AgentPrompt } from "./agent-prompts.js"
import type { MessagesClient } from "./interpreter.js"

const slotEnum = z.enum(SLOT_IDS as unknown as [string, ...string[]])
const intentOut = z.object({
  audience: z.enum(["masculino", "feminino"]).nullable(),
  slots: z.array(z.object({ slot: slotEnum, required: z.boolean(), query: z.string().max(80).nullable(), color: z.string().max(20).nullable() })).min(1).max(4),
  occasion: z.string().max(40).nullable(),
  budget_total_brl: z.number().nonnegative().max(100000).nullable(),
  budget_mode: z.enum(["require", "prefer"]),
  avoid: z.array(z.string().max(30)).max(5),
})
const selectionOut = z.object({
  choices: z.array(z.object({ slot: slotEnum, product_id: z.string().max(120).nullable(), reason: z.string().max(80) })).max(4),
})

export interface ComposerUsage { inputTokens: number; outputTokens: number }
const usageOf = (u: { input_tokens: number; output_tokens: number }): ComposerUsage => ({ inputTokens: u.input_tokens, outputTokens: u.output_tokens })

export type SelectionResult = CompositionValidation & { abstained: SlotId[]; usage: ComposerUsage; requestId: string | null; promptVersion: string }

/** Provider-independent agent contract used by the API (Anthropic today; any adapter implementing it later). */
export interface OutfitAgent {
  readonly model: string
  interpret(text: string): Promise<{ intent: CompositionIntent; usage: ComposerUsage; requestId: string | null; promptVersion: string }>
  select(intent: CompositionIntent, bySlot: CandidatesBySlot, locked: LockedSlots): Promise<SelectionResult>
}

export function createComposer(options: { client: MessagesClient; model?: string }): OutfitAgent {
  const model = options.model?.trim() || DEFAULT_COMPOSER_MODEL
  async function call<T extends z.ZodTypeAny>(prompt: AgentPrompt, content: string, schema: T): Promise<{ data: z.infer<T>; usage: ComposerUsage; requestId: string | null }> {
    const response = await options.client.messages.parse({
      model,
      max_tokens: prompt.maxTokens,
      system: prompt.system,
      messages: [{ role: "user", content }],
      // Low effort: short bounded classification/selection.
      output_config: { effort: "low", format: zodOutputFormat(schema) },
    })
    if (response.stop_reason === "refusal" || response.stop_reason === "max_tokens") throw new Error(`composer_${response.stop_reason}`)
    const parsed = schema.safeParse(response.parsed_output)
    if (!parsed.success) throw new Error("composer_invalid")
    return { data: parsed.data, usage: usageOf(response.usage), requestId: (response as { _request_id?: string | null })._request_id ?? null }
  }

  return {
    model,
    async interpret(text) {
      const trimmed = text.trim().slice(0, 500)
      if (!trimmed) throw new Error("empty_request")
      // Only the request, delimited ("<" escaped): no catalog, no history, no personal profile.
      const { data, usage, requestId } = await call(AGENT_PROMPTS.interpret, `<request>${trimmed.replace(/</g, "‹")}</request>`, intentOut)
      const slots = normalizeSlots(data.slots.map((s) => ({ slot: s.slot as SlotId, required: s.required, query: s.query, color: s.color })))
      const intent: CompositionIntent = {
        audience: data.audience,
        slots,
        colors: [...new Set(slots.map((s) => s.color).filter((c): c is string => Boolean(c)))],
        terms: [], occasion: data.occasion, budgetTotalBrl: data.budget_total_brl,
        budgetMode: data.budget_total_brl === null ? "prefer" : data.budget_mode, avoid: data.avoid,
      }
      return { intent, usage, requestId, promptVersion: AGENT_PROMPTS.interpret.version }
    },

    async select(intent, bySlot, locked) {
      // Compact window per slot; a locked piece is always inside it.
      const candidates = Object.fromEntries(intent.slots.map(({ slot }) => {
        const pool = bySlot[slot] ?? []
        const lockedItem = locked[slot] ? pool.find((c) => c.id === locked[slot]) : undefined
        const window = [...(lockedItem ? [lockedItem] : []), ...pool.filter((c) => c !== lockedItem)].slice(0, SELECT_WINDOW_PER_SLOT)
        // id, title, price (budget), e = can be generated (rights + try-on image): all used by the selection rules.
        return [slot, window.map((c) => ({ id: c.id, t: c.name.slice(0, SELECT_TITLE_CHARS), p: c.priceMinor, e: c.generationEligible }))]
      }))
      const plan = {
        audience: intent.audience ?? null,
        slots: intent.slots.map((s) => ({ slot: s.slot, query: s.query ?? null, color: s.color ?? null })),
        budget_total_cents: intent.budgetTotalBrl === null ? null : Math.round(intent.budgetTotalBrl * 100), budget_mode: intent.budgetMode,
        occasion: intent.occasion, avoid: intent.avoid,
      }
      const content = [
        `Plan: ${JSON.stringify(plan)}`,
        `Locked: ${JSON.stringify(locked)}`,
        `<candidates>\n${JSON.stringify(candidates).replace(/</g, "\\u003c")}\n</candidates>`,
      ].join("\n")
      const { data, usage, requestId } = await call(AGENT_PROMPTS.select, content, selectionOut)
      const abstained = data.choices.filter((x) => x.product_id === null).map((x) => x.slot as SlotId)
      const proposed = data.choices.filter((x) => x.product_id !== null)
        .map((x) => ({ slot: x.slot as SlotId, productId: x.product_id!, reason: x.reason }))
      return {
        ...validateComposition(intent, bySlot, proposed, locked, { requireAll: true, abstained }),
        abstained, usage, requestId, promptVersion: AGENT_PROMPTS.select.version,
      }
    },
  }
}
export type Composer = OutfitAgent

/** Server factory: no SDK retries (a failure falls back to rules instead of multiplying paid calls). */
export function createAnthropicComposer(options: { model?: string; apiKey: string; timeoutMs?: number }): OutfitAgent {
  return createComposer({ client: new Anthropic({ apiKey: options.apiKey, maxRetries: 0, timeout: options.timeoutMs ?? 20_000 }), model: options.model })
}

/**
 * Reuses one interpretation for identical requests (normalized: case, accents kept, whitespace collapsed).
 * Keys are SHA-256 hashes (the request text is not stored); bounded size and TTL; in-memory per process.
 * Safe: the interpretation depends only on the text and the prompt version, never on the person.
 */
export function createInterpretationCache(options: { ttlMs?: number; maxEntries?: number; now?: () => number } = {}) {
  const ttlMs = options.ttlMs ?? 10 * 60_000
  const maxEntries = Math.max(options.maxEntries ?? 500, 1)
  const now = options.now ?? Date.now
  const entries = new Map<string, { intent: CompositionIntent; expiresAt: number; model: string; promptVersion: string }>()
  const keyOf = (model: string, text: string) =>
    createHash("sha256").update(`${model}|${AGENT_PROMPTS.interpret.version}|${text.trim().toLowerCase().replace(/\s+/g, " ")}`).digest("hex")
  type Out = { intent: CompositionIntent; usage: ComposerUsage | null; cached: boolean; model: string; promptVersion: string }
  const inFlight = new Map<string, Promise<Out>>()
  return {
    /**
     * `acquire` (global call budget) is consulted ONLY on a miss, right before the paid call: hits stay free and keep
     * working when the quota is exhausted. Concurrent identical misses share one call (single-flight).
     */
    async interpret(agent: OutfitAgent, text: string, acquire?: () => Promise<boolean>): Promise<Out> {
      const key = keyOf(agent.model, text)
      const hit = entries.get(key)
      if (hit && hit.expiresAt > now()) return { intent: structuredClone(hit.intent), usage: null, cached: true, model: hit.model, promptVersion: hit.promptVersion }
      entries.delete(key)
      const pending = inFlight.get(key)
      if (pending) { const r = await pending; return { ...r, intent: structuredClone(r.intent), usage: null, cached: true } }
      const run = (async (): Promise<Out> => {
        if (acquire && !(await acquire())) throw new Error("agent_budget")
        const r = await agent.interpret(text)
        while (entries.size >= maxEntries) entries.delete(entries.keys().next().value!)
        entries.set(key, { intent: structuredClone(r.intent), expiresAt: now() + ttlMs, model: agent.model, promptVersion: r.promptVersion })
        return { intent: r.intent, usage: r.usage, cached: false, model: agent.model, promptVersion: r.promptVersion }
      })().finally(() => inFlight.delete(key))
      inFlight.set(key, run)
      return run
    },
    keys: () => [...entries.keys()],
  }
}
export type InterpretationCache = ReturnType<typeof createInterpretationCache>
