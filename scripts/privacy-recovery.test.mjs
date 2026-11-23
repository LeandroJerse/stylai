import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { prepareRecovery } from './privacy-recovery.mjs'
const now = Date.parse('2026-11-22T18:00:00Z')
const journal = { version: 1, exportedAt: '2026-11-22T17:55:00Z', accountIds: ['71000000-0000-4000-8000-000000000001'], tiktokBlocked: true }
const bytes = Buffer.from(JSON.stringify(journal))
const expected = createHash('sha256').update(bytes).digest('hex')
const input = { bytes, expectedSha256: expected, snapshotCreatedAt: '2026-11-21T12:00:00Z', nowMs: now }
test('rejects missing, stale, future, tampered or malformed recovery evidence', () => {
 for (const patch of [{ expectedSha256: '' }, { expectedSha256: 'b'.repeat(64) }, { nowMs: now + 2 * 86400000 }, { nowMs: now - 86400000 }, { snapshotCreatedAt: '2026-11-23T00:00:00Z' }]) assert.throws(() => prepareRecovery({ ...input, ...patch }))
 const invalid = Buffer.from(JSON.stringify({ ...journal, accountIds: ["'; delete from auth.users; --"] }))
 assert.throws(() => prepareRecovery({ ...input, bytes: invalid, expectedSha256: createHash('sha256').update(invalid).digest('hex') }))
})
test('old snapshot requires replay and a separate release gate', () => {
 const result = prepareRecovery(input)
 assert.equal(result.accountCount, 1)
 assert.match(result.replaySql, /request_account_deletion/)
 assert.match(result.replaySql, /block_tiktok_access/)
 assert.doesNotMatch(result.replaySql, /delete from auth.users/)
 assert.match(result.releaseGateSql, /restored identity still present/)
 assert.match(result.releaseGateSql, /tiktok_access_allowed/)
 assert.equal(result.readyToServe, false)
})
