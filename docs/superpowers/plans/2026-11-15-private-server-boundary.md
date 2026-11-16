# Private server transaction boundary implementation plan

**Goal:** execute the existing private SQL transactions from Node through dedicated, restricted database credentials, without exposing a browser RPC or enabling a provider operation.

**Architecture:** retain the four applied migrations and add a forward permission migration. Separate API, AI execution, payment reconciliation and procurement capabilities. Use parameterized node-postgres calls with an explicit operation allowlist, verified TLS remotely, bounded connections, role checks, redacted errors and no automatic mutation retries.

**Spec:** `docs/superpowers/specs/2026-11-10-supabase-mvp-design.md`, Phase 2 follow-on evidence, and the owner's 2026-11-15 continuation request. The owner authorized independent implementation; work continues in the requested clean checkout and existing branch. No additional design approval is needed for this server implementation.

## Constraints and decisions

- Keep `private` outside PostgREST exposed schemas; no browser/shared-contract imports of database code.
- No runtime owner, service_role, BYPASSRLS, table access or cross-purpose role membership.
- Capability roles start NOLOGIN with no password. Credential activation is a separate owner operation; no hosted migration or role activation in this task.
- Remote connections are restricted to the recorded `stylai-dev` project, with certificate verification; URL options cannot override TLS.
- Trusted actor UUIDs remain a server responsibility. This boundary is not authentication, and no HTTP business route is enabled before authentication exists.
- Preserve `apps/web` byte-for-byte. Hue, Refero and design-taste are scoped to preserving the current source design; no new visual language or design artifact is needed for this backend slice.
- No paid calls, marketplace requests, purchases, deployments or pushes.

## Approaches

Use dedicated database roles and direct SQL. Public SECURITY DEFINER RPCs would unnecessarily expand the browser surface. A postgres/service-role connection would defeat least privilege. Dedicated roles can reuse the existing transaction bodies while denying raw mutation and separating financial authority.

## Tasks and acceptance

### Task 1: Database privileges

- [x] Add failing real PostgreSQL role tests, including cross-purpose execution denial, direct table denial, no browser membership and owned/foreign-photo enqueue.
- [x] Add `20261115000100_server_boundary.sql`: four NOLOGIN roles, explicit EXECUTE grants, future function default-deny and boundary version probe.
- [x] Replay all migrations and transaction/concurrency tests in a disposable PostgreSQL 17 container. No hosted data touched.

### Task 2: Node boundary

- [x] Add failing configuration tests for owner credentials, wrong purpose/project, TLS URL overrides and redacted errors.
- [x] Implement `packages/supabase/src/private-config.ts`, `private-transactions.ts`, `private-database.ts` with typed allowlisted calls, exact numeric handling, runtime result validation, restricted role preflight, pool lifecycle and no retry.
- [x] Add a real Node/PostgreSQL integration check using disposable role logins. Verify replay, account ownership, stale fencing, unknown outcomes, parameterization and privilege-drift rejection through the actual driver.
- [x] Wire optional API connection lifecycle/readiness; worker execution remains idle and is not represented as implemented.

### Task 3: Handoff and verification

- [x] Update environment examples, package/runtime documentation and START-HERE's stale state.
- [x] Record all 12 workstreams with owning files/contracts, status, acceptance, evidence, external decisions and next deliverable.
- [x] Run pinned doctor/root check, database suite and fixture browser E2E. Record fresh results separately from historical hosted evidence.
- [x] Review the final diff for privilege escalation, credentials/logging, retries after ambiguous writes, frontend drift and unsupported completion claims.

## Review focus

Untrusted operation names/SQL parameters; owner or overly privileged credentials; TLS options overriding verification; commit/response loss causing duplicate mutations; credentials or provider details escaping through errors. A verified boundary does not mean auth, photo ingestion, durable workers or commerce features work.

## Execution ledger

- Initial source: clean `d582788`, branch `chore/monorepo-mvp-handoff`; all four migrations retained. System Node 22; portable pinned Node 26.13.0 available. Bun and Docker require execution outside the restricted sandbox; no external provider activation involved.
- Tasks 1–3 complete locally. Final root check: 69 tests, all typechecks/builds/smoke passed. Both disposable PostgreSQL suites and 16 fixture browser checks passed. Hosted access is not claimed. Full evidence, review outcomes and implementation rulings are recorded in `docs/qa/2026-11-15-mvp-continuation.md`.
