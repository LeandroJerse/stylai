import { z } from "zod"
import type { OtlpExporter, SpanRecord } from "@stylai/ai"
import type { PrivateDatabase } from "@stylai/supabase"

const spanSchema = z.object({
  traceId: z.string().regex(/^[0-9a-f]{32}$/), spanId: z.string().regex(/^[0-9a-f]{16}$/),
  parentSpanId: z.string().regex(/^[0-9a-f]{16}$/).optional(), name: z.string().max(100),
  startMs: z.number(), endMs: z.number(), error: z.boolean().optional(),
  attributes: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
})
const rowsSchema = z.array(z.object({ id: z.string().uuid(), event_key: z.string(), payload: z.object({ span: z.unknown() }) }))

/**
 * Drains the durable outbox once. One OTLP request per batch; the whole batch
 * shares the outcome. Exporter absent (no Langfuse credentials) = no-op: events
 * stay pending in the database, which remains the source of truth.
 */
export async function flushTelemetryOnce(db: PrivateDatabase<"ai_worker">, exporter: OtlpExporter | null, limit = 50) {
  if (!exporter) return { sent: 0, pending: true }
  const rows = rowsSchema.safeParse(await db.call("claim_telemetry_events", limit))
  if (!rows.success || rows.data.length === 0) return { sent: 0, pending: false }
  const valid: Array<{ id: string; span: SpanRecord }> = []
  for (const row of rows.data) {
    const span = spanSchema.safeParse(row.payload.span)
    if (span.success) valid.push({ id: row.id, span: span.data as SpanRecord })
    else await db.call("mark_telemetry_event", row.id, "dead")
  }
  const outcome = await exporter(valid.map((v) => v.span))
  for (const v of valid) await db.call("mark_telemetry_event", v.id, outcome)
  return { sent: outcome === "sent" ? valid.length : 0, pending: outcome === "retry", outcome }
}
