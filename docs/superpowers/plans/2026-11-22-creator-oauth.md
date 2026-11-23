# Creator OAuth implementation plan

Goal: complete the authorized creator connection, test offline, then verify creator eligibility and live revocation separately.

Design: retain the existing TikTok client, state validator and catalog. A single operator (explicit UUID allowlist) connects the shared catalog through an authenticated POST. Bind the callback to an HttpOnly SameSite=Lax cookie and single-use state. Exchange codes server-side, validate creator identity/scopes/expiry, and save tokens in an AES-GCM encrypted local vault outside the repository. Refresh is serialized; disconnect removes local tokens and purges cache. The existing database deny gate remains authoritative. Local disconnect is not represented as remote revocation.

Alternatives: plaintext environment tokens lack lifecycle management; database storage needs a broader migration. A local encrypted vault fits the existing single-computer pilot; it requires one API process and a persistent session root key. No new dependency, paid calls, secret-file edits or public deployment.

## Steps
- [ ] Add failing route tests for unauthorized start, origin, browser binding, callback replay, sanitized response, disconnect.
- [ ] Add failing vault tests for encrypted persistence, refresh, invalid identity/scopes, disconnect and network failure.
- [ ] Implement service/vault, routes and server wiring; add operator UI.
- [ ] Run focused tests, full suite, typecheck, build and review.
- [ ] Only after passing, restart local services if the active setup can be safely identified. Keep unconfigured OAuth disabled.
- [ ] Verify creator account in UI, then real query and remote revocation if account/token/callback prerequisites are met.

Review focus: callback browser substitution; expired/replayed state; refresh changing identity; disconnected token resurrected by concurrent work; secret exposure through errors/logs. Test all with temporary storage and fake provider transport, not current data.
