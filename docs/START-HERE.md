# Start here — StylAI implementation handoff

This repository is intended to be sufficient for a new developer or coding agent without this chat, the previous developer's computer, or the external Obsidian vault.

## Read in this order

1. [Current context and decisions](handoff/CONTEXT.md): product, scope, architecture, existing behavior, constraints and superseded assumptions.
2. [Complete implementation plan](handoff/IMPLEMENTATION-PLAN.md): ordered phases, files, acceptance tests, dependencies and completion evidence.
3. [Asaas integration specification](integrations/asaas.md): selected payment processor, checkout/events, money states and verification.
4. [API and frontend change matrix](superpowers/plans/2026-11-10-supabase-mvp-api-matrix.md): disposition of each current route and source file.
5. [Detailed architecture/security design](superpowers/specs/2026-11-10-supabase-mvp-design.md), [Segmind spec](integrations/segmind-idm-vton.md), [source adapters](superpowers/plans/2026-11-10-marketplace-connectors.md) and [commerce tasks](superpowers/plans/2026-11-10-supabase-mvp-commerce.md).
6. [Current verification record](qa/2026-11-10-node26-supabase-foundation.md) and [architecture diagram/workstreams](ARCHITECTURE-REFERENCE.md).
7. Optional: [copyable next-developer kickoff prompt](handoff/NEXT-DEVELOPER-PROMPT.md).

Authoritative order: actual source/verification evidence for current behavior; confirmed latest decisions for intended scope; this handoff + current design for implementation; older planning and original context snapshots for background. If these disagree, resolve the discrepancy explicitly; do not silently follow a superseded option.

## Current state

- Frontend moved from root into `apps/web`; its domain implementation/UI is preserved.
- Runnable API and idle worker foundations exist, along with package boundaries, config examples, Supabase local config and CI.
- API live health is 200; readiness probes the real Supabase schema RPC and is 503 until configured with the expected reachable schema. Business routes remain unimplemented 503 errors. Worker consumes no queue.
- Supabase SDK clients, starter schema/RLS/private buckets and isolated PostgreSQL tests exist. Hosted connection and generated public schema types are verified. App auth, catalog endpoints, Asaas, Segmind, source orders and privacy workflows remain pending.
- Asaas is confirmed. Do not reopen Stripe/provider selection. Payment methods, merchant account and commercial settings still need confirmation.
- No live service keys, accounts, actual `.env.local`, cloud projects, migrations, real purchases, paid image calls or deployment are supplied.

## Local setup

Use Node 26.13.0 LTS and Bun 1.3.12. From the repository root:

```sh
bun install --frozen-lockfile
bun run doctor
bun run check
bun run test:e2e:install
bun run test:e2e
```

Then use `bun run dev` for the three app processes, or `bun run dev:web`, `bun run dev:api`, `bun run dev:worker` in separate terminals. Web: http://localhost:5190; API: http://127.0.0.1:3000; idle worker health: http://127.0.0.1:3001.

Copy an app's `.env.example` to its ignored `.env.local` only when needed. No secret belongs in `apps/web`. Without public API config the frontend displays disconnected states. If you configure its example local API URL, business screens display the scaffold's unavailable responses until implemented; this is intentional.

Root `check` runs the browser/server import guard, TypeScript checks, unit tests, builds and real built-Node health smoke tests. `lint` is the narrow dependency/import guard, not a full ESLint/style/security audit. Frontend E2E uses a test-only fake backend; it does not prove real Supabase/AI/payments.

`test:db` runs real PostgreSQL 17 role/RLS tests in an ephemeral Docker container. `test:integration` currently runs only the hosted foundation probe. `db:types` generates from an actual migrated authenticated project and fails if access/configuration is missing.

## Supabase

Follow [hosted Supabase setup](SUPABASE-SETUP.md). The target is hosted Supabase. The pinned CLI and optional local stack are development tools. Starter migration `20261110000100_foundation.sql` is applied to `stylai-dev` (`yekhpfwxuiuakxznxaew`, `us-east-1`) and its actual API readiness is verified. Inspect project identity/existing objects before applying; never reset shared data. Portable Node activation instructions are in the setup guide.

## Repository/publication

Origin: https://github.com/LeandroJerse/stylai. Keep `.git` at root and no nested repositories. Work was prepared on `chore/monorepo-mvp-handoff`; no commit/push was made by this task. Git shows old root source files deleted and `apps/web` untracked until staging; this is the expected move, not lost source. Stage/review the full move together so Git can detect renames. Do not stage `node_modules`, outputs, keys or actual environment files.

Inherited tracking refs can describe the previous frontend remote. Before first push, inspect the actual new remote's history and reconcile non-destructively. Do not force-push based on a copied repository's old refs. The sibling `stylai_frontend` and prototype remain outside the new monorepo and are not required by this handoff.

## First implementation assignment

Follow phases 1–2 in the complete plan: validate this scaffold, establish the real Supabase schema/access controls and capture real role-test evidence. External commercial-rights/app-account work can proceed in parallel through the responsible owner; do not let unavailable credentials lead to fake successful integrations. Work task-by-task, maintain actual coverage/status, and stop calling a feature complete until its named verification exists.
