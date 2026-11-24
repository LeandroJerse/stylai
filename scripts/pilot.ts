/**
 * Operator-only CLI for the supervised real try-on pilot (P3/P6).
 * Requires explicit admin/operator database connection (STYLAI_ADMIN_DATABASE_URL or DATABASE_URL).
 * Never prints secrets, signed URLs or private user photos.
 *
 * Usage:
 *   node --import tsx scripts/pilot.ts status [pilotId]
 *   node --import tsx scripts/pilot.ts report [pilotId]
 *   node --import tsx scripts/pilot.ts pause <pilotId> [reason]
 *   node --import tsx scripts/pilot.ts resume <pilotId>
 *   node --import tsx scripts/pilot.ts mark-usable <pilotId> <providerCallId> <true|false> [note]
 *   node --import tsx scripts/pilot.ts release-unsent <pilotId> <providerCallId> [reason]
 *   node --import tsx scripts/pilot.ts authorize <pilotId> --attempts=N --limit-usd=X --policy-references=on|off --note="..." [--commit]
 *   node --import tsx scripts/pilot.ts revoke-source aliexpress --note="..." [--commit]
 * authorize/revoke-source only SHOW the change unless --commit is given; nothing is widened silently.
 */
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { Client } from "pg"

export interface PilotDispatchRow {
  attempt_no: number
  provider_call_id: string
  job_id: string
  status: string
  provider: string
  model: string
  price_version: string
  provider_request_id: string | null
  reserved_usd_micros: number
  computed_usd_micros: number | null
  confirmed_usd_micros: number | null
  settled_usd_micros: number | null
  cost_source: string
  units: Record<string, unknown>
  provider_report: Record<string, unknown>
  params: Record<string, unknown>
  latency_ms: number | null
  error_code: string | null
  usable: boolean | null
  usable_note: string | null
  created_at: string
  finished_at: string | null
}

export interface PilotProviderBreakdown {
  provider: string
  model: string
  attempts_used: number
  succeeded_count: number
  failed_count: number
  uncertain_count: number
  in_flight: number
  spent_usd_micros: number
  reserved_usd_micros: number
}

export interface PilotStatusReport {
  id: string
  provider: string
  model: string
  allowed_targets?: Array<{ provider: string; model: string }>
  mode: string
  limit_usd_micros: number
  max_attempts: number
  active_since: string
  paused: boolean
  paused_at: string | null
  paused_reason: string | null
  attempts_used: number
  attempts_remaining: number
  succeeded_count: number
  failed_count: number
  uncertain_count: number
  in_flight: number
  released_count: number
  usable_count: number
  spent_usd_micros: number
  confirmed_usd_micros: number
  computed_usd_micros: number
  reserved_usd_micros: number
  remaining_usd_micros: number
  blocked_reason: string | null
  by_provider?: PilotProviderBreakdown[]
  dispatches: PilotDispatchRow[]
}

const fmtUsd = (micros: number | null | undefined): string =>
  micros == null ? "desconhecido" : `US$ ${(micros / 1_000_000).toFixed(4)}`

export function formatPilotReport(st: PilotStatusReport): string {
  const costPerGen = st.succeeded_count > 0 ? Math.round(st.spent_usd_micros / st.succeeded_count) : null
  const costPerUsable = st.usable_count > 0 ? Math.round(st.spent_usd_micros / st.usable_count) : null
  const targetsText = st.allowed_targets && st.allowed_targets.length > 0
    ? st.allowed_targets.map((t) => `${t.provider}/${t.model}`).join(", ")
    : `${st.provider}/${st.model}`
  const lines = [
    `=== Relatório do Piloto: ${st.id} ===`,
    `Provedores/Modelos permitidos (orçamento compartilhado): ${targetsText} (modo: ${st.mode})`,
    `Estado: ${st.paused ? `PAUSADO (${st.paused_reason ?? "manual"})` : st.blocked_reason ? `BLOQUEADO (${st.blocked_reason})` : "ATIVO"}`,
    `Tentativas: ${st.attempts_used}/${st.max_attempts} (restantes: ${st.attempts_remaining}) | sucessos=${st.succeeded_count} falhas=${st.failed_count} incertos=${st.uncertain_count} em_voo=${st.in_flight} liberadas_nao_enviadas=${st.released_count}`,
    `Imagens marcadas aproveitáveis: ${st.usable_count}`,
    `Orçamento total compartilhado: ${fmtUsd(st.limit_usd_micros)}`,
    `  Gasto liquidado (total):      ${fmtUsd(st.spent_usd_micros)}`,
    `  - Confirmado pelo provedor:   ${fmtUsd(st.confirmed_usd_micros)}`,
    `  - Computado (GPU-s / imagem): ${fmtUsd(st.computed_usd_micros)}`,
    `  Reservas pendentes:           ${fmtUsd(st.reserved_usd_micros)}`,
    `  Saldo restante do piloto:     ${fmtUsd(st.remaining_usd_micros)}`,
    `  Custo médio por geração:      ${fmtUsd(costPerGen)}`,
    `  Custo por imagem aproveitável:${fmtUsd(costPerUsable)}`,
    `Comando para pausar imediatamente: node --import tsx scripts/pilot.ts pause ${st.id} "parada manual"`,
  ]
  if (st.by_provider && st.by_provider.length > 0) {
    lines.push("", "--- Consumo por provedor/modelo ---")
    for (const p of st.by_provider) {
      lines.push(
        `${p.provider}/${p.model}: tentativas=${p.attempts_used} sucessos=${p.succeeded_count} falhas=${p.failed_count} incertos=${p.uncertain_count} gasto=${fmtUsd(p.spent_usd_micros)} reservado=${fmtUsd(p.reserved_usd_micros)}`,
      )
    }
  }
  if (st.dispatches.length > 0) {
    lines.push("", "--- Tentativas registradas (sem URLs assinadas ou segredos) ---")
    for (const d of st.dispatches) {
      lines.push(
        `#${d.attempt_no} [${d.status}] ${d.provider}/${d.model} call=${d.provider_call_id} req=${d.provider_request_id ?? "-"} ` +
        `cost_source=${d.cost_source} settled=${fmtUsd(d.settled_usd_micros)} computed=${fmtUsd(d.computed_usd_micros)} confirmed=${fmtUsd(d.confirmed_usd_micros)} ` +
        `units=${JSON.stringify(d.units ?? {})} latency_ms=${String(d.latency_ms ?? "-")} usable=${String(d.usable ?? "pendente")}` +
        (d.error_code ? ` err=${d.error_code}` : ""),
      )
    }
  }
  return lines.join("\n")
}

export interface AuthorizationChange { attempts: number; limitMicros: number; policyReferences: boolean; note: string }
/** Parses the operator's explicit numbers. Anything missing or out of bounds is an error, never a default. */
export function parseAuthorization(args: readonly string[]): AuthorizationChange {
  const value = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3).trim()
  const attempts = Number(value("attempts")), usd = Number(value("limit-usd")), refs = value("policy-references"), note = value("note") ?? ""
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 200) throw new Error("--attempts must be an integer between 1 and 200 (total, not additional)")
  if (!Number.isFinite(usd) || usd <= 0 || usd > 20) throw new Error("--limit-usd must be above 0 and at most 20 (total, not additional)")
  if (refs !== "on" && refs !== "off") throw new Error("--policy-references must be on or off")
  if (note.length < 10 || note.length > 300) throw new Error("--note must say who authorized it and why (10 to 300 characters)")
  return { attempts, limitMicros: Math.round(usd * 1_000_000), policyReferences: refs === "on", note }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
if (isMain) {
  const [cmd = "report", pilotId = process.env.STYLAI_PILOT_ID ?? "stylai-first-real-tryon-pilot", arg3, arg4, ...rest] = process.argv.slice(2)
  const dbUrl = process.env.STYLAI_ADMIN_DATABASE_URL ?? process.env.DATABASE_URL
  if (!dbUrl) {
    console.error("Erro: defina STYLAI_ADMIN_DATABASE_URL ou DATABASE_URL (acesso administrativo obrigatório).")
    process.exit(2)
  }
  const client = new Client({ connectionString: dbUrl, connectionTimeoutMillis: 10_000 })
  await client.connect()
  try {
    if (cmd === "status" || cmd === "report") {
      const res = await client.query<{ status: PilotStatusReport | null }>("select private.pilot_status($1) as status", [pilotId])
      const st = res.rows[0]?.status
      if (!st) {
        console.error(`Piloto não encontrado: ${pilotId}`)
        process.exit(1)
      }
      console.log(cmd === "status" ? JSON.stringify(st, null, 2) : formatPilotReport(st))
    } else if (cmd === "pause") {
      const reason = [arg3, arg4, ...rest].filter(Boolean).join(" ") || "operator_paused"
      const res = await client.query<{ ok: boolean }>("select private.pause_pilot($1, $2) as ok", [pilotId, reason])
      console.log(JSON.stringify({ action: "pause", pilotId, ok: Boolean(res.rows[0]?.ok), reason }))
    } else if (cmd === "resume") {
      const res = await client.query<{ ok: boolean }>("select private.resume_pilot($1) as ok", [pilotId])
      console.log(JSON.stringify({ action: "resume", pilotId, ok: Boolean(res.rows[0]?.ok) }))
    } else if (cmd === "mark-usable") {
      if (!arg3 || (arg4 !== "true" && arg4 !== "false")) {
        console.error("Usage: scripts/pilot.ts mark-usable <pilotId> <providerCallId> <true|false> [note]")
        process.exit(2)
      }
      const note = rest.join(" ") || null
      const res = await client.query<{ ok: boolean }>("select private.mark_pilot_dispatch_usable($1, $2::uuid, $3, $4) as ok", [pilotId, arg3, arg4 === "true", note])
      console.log(JSON.stringify({ action: "mark-usable", pilotId, providerCallId: arg3, usable: arg4 === "true", ok: Boolean(res.rows[0]?.ok) }))
    } else if (cmd === "release-unsent") {
      if (!arg3) {
        console.error("Usage: scripts/pilot.ts release-unsent <pilotId> <providerCallId> [reason]")
        process.exit(2)
      }
      const reason = [arg4, ...rest].filter(Boolean).join(" ") || "operator_released"
      const res = await client.query<{ ok: boolean }>("select private.release_unsent_pilot_call($1, $2::uuid, $3) as ok", [pilotId, arg3, reason])
      console.log(JSON.stringify({ action: "release-unsent", pilotId, providerCallId: arg3, ok: Boolean(res.rows[0]?.ok) }))
    } else if (cmd === "authorize") {
      const args = [arg3, arg4, ...rest].filter((a): a is string => Boolean(a))
      const change = parseAuthorization(args)
      const commit = args.includes("--commit")
      await client.query("begin")
      const before = (await client.query<{ max_attempts: number; limit_usd_micros: string; allow_policy_references: boolean }>(
        "select max_attempts,limit_usd_micros,allow_policy_references from private.ai_pilots where id=$1 for update", [pilotId])).rows[0]
      if (!before) { console.error(`Piloto não encontrado: ${pilotId}`); process.exitCode = 1 }
      else {
        if (commit) {
          await client.query(`update private.ai_pilots set max_attempts=$2,limit_usd_micros=$3,allow_policy_references=$4,
            authorization_note=left($5||' | '||authorization_note,500) where id=$1`, [pilotId, change.attempts, change.limitMicros, change.policyReferences, `${new Date().toISOString().slice(0, 10)}: ${change.note}`])
        }
        console.log(JSON.stringify({ action: "authorize", pilotId, committed: commit,
          before: { attempts: before.max_attempts, limitUsd: Number(before.limit_usd_micros) / 1e6, policyReferences: before.allow_policy_references },
          after: { attempts: change.attempts, limitUsd: change.limitMicros / 1e6, policyReferences: change.policyReferences }, ...(commit ? {} : { hint: "nada foi alterado; repita com --commit" }) }, null, 2))
      }
      await client.query("commit")
    } else if (cmd === "revoke-source") {
      const args = [arg3, arg4, ...rest].filter((a): a is string => Boolean(a))
      const note = args.find((a) => a.startsWith("--note="))?.slice(7).trim() ?? ""
      if (note.length < 5 || note.length > 200) throw new Error("--note is required (5 to 200 characters)")
      const commit = args.includes("--commit")
      const policy = (await client.query<{ id: string; references: string }>(`select p.id,(select count(*) from private.catalog_image_rights r where r.policy_id=p.id and r.try_on_allowed)::text as "references"
        from private.source_image_policies p where p.source=$1 and p.revoked_at is null`, [pilotId])).rows[0]
      if (policy && commit) await client.query("update private.source_image_policies set revoked_at=now(),revoked_reason=$2 where id=$1 and revoked_at is null", [policy.id, note])
      console.log(JSON.stringify({ action: "revoke-source", source: pilotId, policy: policy?.id ?? null, activeReferences: Number(policy?.references ?? 0), committed: Boolean(policy && commit) }))
    } else {
      console.error(`Comando desconhecido: ${cmd}`)
      process.exit(2)
    }
  } finally {
    await client.end()
  }
}
