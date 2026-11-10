# StylAI monorepo

Origin: [LeandroJerse/stylai](https://github.com/LeandroJerse/stylai).

**Start with [docs/START-HERE.md](docs/START-HERE.md).** It links the self-contained context, complete implementation plan, integration specifications, original project/UX snapshots and current verification evidence. No chat history or external vault is required.

## Current delivery

The existing React frontend is under apps/web. Runnable Fastify API and idle Node worker foundations, shared packages, environment examples, local Supabase configuration and verification CI are provided.

The Supabase foundation includes isolated SDK clients, a starter SQL/RLS migration, private buckets and a bounded database readiness probe. The starter foundation is applied and verified on `stylai-dev`; follow [hosted setup](docs/SUPABASE-SETUP.md). App auth, catalog endpoints, Segmind, Asaas and fulfillment remain future implementation. Business API routes return unavailable. API readiness is 200 only when the expected schema RPC succeeds; the idle worker stays nonready.

Confirmed stack: React/Vite + TypeScript/Fastify + Supabase + Segmind Try-On Diffusion + **Asaas** + AliExpress/Shopee/TikTok Shop adapters. The project architecture reference is documented, not a requirement to adopt every illustrated technology.

## Structure

    apps/web/        existing mobile-first frontend, tests and assets
    apps/api/        HTTP foundation and documented future domain modules
    apps/worker/     idle health service and future durable handler locations
    packages/        contracts, config, supabase, ai and commerce boundaries
    supabase/        starter migration, isolated PostgreSQL tests and future email templates
    scripts/         boundary guard, doctor, database checks and built-service smoke
    docs/            complete handoff, plans, context, integrations and evidence

## Run and verify

Use Node 26.13.0 LTS and Bun 1.3.12. Run from this root:

    bun install --frozen-lockfile
    bun run doctor
    bun run check
    bun run test:e2e:install
    bun run test:e2e
    bun run dev

Web runs on localhost:5190, API on 127.0.0.1:3000, worker health on 127.0.0.1:3001. Each also has a root dev:web/dev:api/dev:worker command. Copy each app's .env.example into an ignored .env.local if needed. Web config is public; never put secrets there.

The root check verifies imports, types, tests, builds and real built Node services. Fixture browser E2E does not prove real provider integration. `test:db` runs isolated PostgreSQL role/RLS tests. `supabase:check` probes the configured hosted foundation; `db:types` needs the actual migrated project and CLI authentication. The owner created `stylai-dev`; its ignored API env is local only. No app deployment or credentials are committed. See the [current verification record](docs/qa/2026-11-10-node26-supabase-foundation.md).

## Successor handoff

- [Complete context](docs/handoff/CONTEXT.md)
- [Detailed implementation plan and verification inventory](docs/handoff/IMPLEMENTATION-PLAN.md)
- [Asaas protocol, money invariants and acceptance tests](docs/integrations/asaas.md)
- [Segmind and commercial-use/data/quality gates](docs/integrations/segmind-try-on-diffusion.md)
- [Three marketplace connector plan](docs/superpowers/plans/2026-11-10-marketplace-connectors.md)
- [Current scaffold verification](docs/qa/scaffold-progress.md)
- [Phase 1 readiness and current access facts](docs/decisions/phase-1-readiness.md)
- [Current launch decisions and prepared artifacts](docs/decisions/2026-11-10-launch-answers.md)
- [Phase 1 verification](docs/qa/2026-11-10-phase-1-baseline.md)

The owner committed the monorepo baseline as `a096c92`; the frontend move is tracked. Phase 1 and subsequent launch decisions are maintained in focused local commits. The owner handles pushes. Do not stage node_modules, build outputs or actual environment values. Verify new-remote history before the first push; inherited tracking refs may describe the old frontend repository.
