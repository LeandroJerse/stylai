# Phase 1 baseline verification — 2026-11-10

Scope: Phase 1 of the master implementation plan: reproducible baseline, owner/access facts, business-decision register and provider documentation evidence. Development project and existing scaffold were preserved. No new business route, account or paid operation was implemented in this phase.

## Fresh local and hosted evidence

Run from repository root on Node **26.13.0** and Bun **1.3.12**:

| Command/check | Actual result | Limit |
| --- | --- | --- |
| `bun install --frozen-lockfile` | Exit 0; 211 installs/319 packages checked, no changes | Does not certify dependency security |
| `bun run doctor` | Exit 0; pinned runtime/tooling and dependencies present | Does not probe services/provider access |
| `bun run check` | Exit 0; import guard, TypeScript, **65 pass / 0 fail**, builds and built Node smoke | Business handlers remain unavailable |
| Built API/worker smoke (part of `check`) | Liveness 200; credentials cleared, readiness 503 | Worker remains idle; offline readiness is intentionally separate from hosted readiness |
| `bun run test:db` | Exit 0; actual PostgreSQL 17 role/RLS/constraint assertions; rows rolled back and disposable container removed | Supabase Auth/Storage schemas are test fixtures, not full platform verification |
| `bun run test:e2e` | Exit 0; all 16 fixture-backed checks; no page JavaScript errors | Does not prove real Auth, supplier, AI or payment integration |
| `bun run supabase:check` | Exit 0; actual `stylai-dev` foundation RPC `ready` | Does not certify full app readiness |
| `supabase db advisors --remote=yekhpfwxuiuakxznxaew --type security --level warn --fail-on error` | Exit 0; no warning/error findings | Point-in-time advisor result, not security certification |
| `git check-ignore apps/api/.env.local` | Ignored | Do not stage ignored secrets with `-f` |
| Document links / whitespace | 66 local links resolve across Phase 1 documents and README; `git diff --check` clean | External pages can require login or change |
| Origin inspection | `https://github.com/LeandroJerse/stylai` | Remote history/publication not changed |

The actual configured API readiness HTTP 200 and hosted RLS/grants/anonymous access were established in the preceding [foundation record](2026-11-10-node26-supabase-foundation.md); this phase freshly rechecks the hosted RPC and local offline smoke. Do not rewrite prior evidence as a new hosted Auth integration test.

CI now includes `bun run test:db` between root check and browser checks. It uses the disposable PostgreSQL fixture and no hosted credentials. All constituent commands ran locally; GitHub-hosted execution has not been triggered or claimed. The runner needs Docker/image download availability. The doctor status text now distinguishes generated public types from remaining domain integrations.

## Implemented records and owner answers

- [Phase 1 readiness/access/business ledger](../decisions/phase-1-readiness.md).
- [Unassigned responsibility coverage](../operations/owners.md).
- [All three source capability/evidence sheets](../decisions/source-capabilities.md).
- [Segmind rights/data/protocol/evaluation record](../evaluations/idm-vton.md).
- Updated decision register, master plan and start-here to distinguish locally verified work from open account/business gates.

The owner explicitly requested **all people unassigned**, confirms an **Asaas account exists**, no Segmind account and no marketplace developer accounts yet, and states business launch settings are not defined. We did not infer the existing Asaas environment, merchant capability, currency or enabled methods. No secret values were printed during presence checks, and none belongs in these documents.

Official provider docs were inspected on this date, with direct links and limitations in the new records. Segmind async record expiry and output-file retention are distinct. Noncommercial licensing labels differ between upstream and provider, requiring clarification. Shopee portal access returned 403; TikTok docs rendered a JS/login shell; AliExpress historical DS docs were marked deprecated. No successful source authorization is claimed.

## Phase outcome and continuation

Repository-side Phase 1 delivery is implemented and verified. Full Phase 1 acceptance remains open for accepted operating owners, Asaas sandbox/access, Segmind account/rights/data/budget, three marketplace grants/supplier permissions, business settings and separate staging/environment decisions. These external gaps do not prevent independent Phase 2 schema/transaction work. Use new forward migrations; do not recreate the applied starter schema.

Baseline HEAD is `a096c92` (the owner's existing monorepo commit). Phase 1 edits remain uncommitted in the existing feature branch for the owner's review. No commit, push, account registration, external outreach, billable image call, purchase or app deployment was performed in Phase 1.

Independent final review: no actionable Important/Critical findings remained after correcting stale account/Git-state statements against fresh evidence. Review was read-only and performed no provider calls or secret reads; it is separate from the executed verification above.
