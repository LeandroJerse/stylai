import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/** Consumes a separately fetched, hash-verified journal; never trusts one inside the old backup. */
export function prepareRecovery({ bytes, expectedSha256, snapshotCreatedAt, nowMs = Date.now() }) {
  if (!/^[a-f0-9]{64}$/i.test(expectedSha256 ?? '') || createHash('sha256').update(bytes).digest('hex') !== expectedSha256.toLowerCase()) throw Error('Recovery journal checksum mismatch')
  const journal = JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''))
  const exportedAt = Date.parse(journal.exportedAt), snapshot = Date.parse(snapshotCreatedAt)
  if (journal.version !== 1 || !Number.isFinite(exportedAt) || !Number.isFinite(snapshot) || exportedAt < snapshot || exportedAt > nowMs || nowMs - exportedAt > 86400000) throw Error('Fresh recovery journal required')
  if (!Array.isArray(journal.accountIds) || journal.accountIds.length > 100000 || typeof journal.tiktokBlocked !== 'boolean') throw Error('Invalid recovery journal')
  const ids = [...new Set(journal.accountIds)]
  if (ids.some(id => typeof id !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id))) throw Error('Invalid recovery identity')
  const replay = ids.map(id => `if exists(select 1 from public.profiles where id='${id}'::uuid) then perform private.request_account_deletion('${id}'::uuid); end if;`).join('\n')
  const checks = ids.map(id => `assert not exists(select 1 from auth.users where id='${id}'::uuid), 'restored identity still present';`).join('\n')
  return {
    accountCount: ids.length, readyToServe: false,
    replaySql: `begin;\ndo $$ begin\n${replay}\n${journal.tiktokBlocked ? 'perform private.block_tiktok_access();' : ''}\nend $$;\ncommit;\n`,
    releaseGateSql: `begin;\ndo $$ begin\n${checks}\n${journal.tiktokBlocked ? "assert not private.tiktok_access_allowed(), 'revoked integration restored';" : ''}\nend $$;\nrollback;\n`,
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [journalPath, expectedSha256, snapshotCreatedAt, outputPrefix] = process.argv.slice(2)
  if (!journalPath || !outputPrefix) throw Error('Usage: node scripts/privacy-recovery.mjs JOURNAL SHA256 SNAPSHOT_ISO OUTPUT_PREFIX')
  const result = prepareRecovery({ bytes: readFileSync(journalPath), expectedSha256, snapshotCreatedAt })
  writeFileSync(`${outputPrefix}.replay.sql`, result.replaySql, { flag: 'wx', mode: 0o600 })
  writeFileSync(`${outputPrefix}.release-gate.sql`, result.releaseGateSql, { flag: 'wx', mode: 0o600 })
  console.log(JSON.stringify({ accountCount: result.accountCount, readyToServe: false, instruction: 'Replay while offline, purge files, complete erasures, run release gate before serving. No database was changed by this command.' }))
}
