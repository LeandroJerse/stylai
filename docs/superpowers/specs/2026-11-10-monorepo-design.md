# StylAI monorepo and local PostgreSQL — proposed design

Status: superseded by `2026-11-10-supabase-mvp-design.md`. The user replaced local PostgreSQL with Supabase on 2026-11-10 and requested a complete MVP plan. Retained only as historical context; do not execute this design.
Date: 2026-11-10.

## Intent and existing evidence

Consolidate the existing frontend, a new API, database migrations, and project documentation in `stylai`, preserving the frontend's behavior and Git history. The user requested a scalable, secure structure and local PostgreSQL. The source `stylai_frontend` remains intact.

The destination was empty. All 89 source files, including hidden files and `.git`, were copied and compared using SHA-256. The copied repository is still the original standalone frontend; the structure below is the proposed next step, not implemented behavior.

Reviewed sources: frontend README, `docs/API-CONTRACT.md`, HTTP client, Vite configuration, E2E runner, root `CONTEXTO-DO-PROJETO.md`, and brain notes 03, 07, and 08. The original static prototype and the API-driven React frontend are distinct deliverables. The new repository uses the React frontend as its starting point.

The product helps people discover curated real clothing, visualize a look, and visit partner stores through affiliate links. Real catalog access, affiliate tracking, generation quality, image permissions, and photo retention remain unresolved. A technical token/plan contract does not authorize payments or establish a commercial pricing model.

## Goals and boundaries

- Preserve React 19, Vite 6, TypeScript, Tailwind 4, TanStack Query, existing screens, and tests.
- One workspace install and documented root commands for development, checking, builds, tests, and migrations.
- A modular API and a real local PostgreSQL connection, with reviewed migrations.
- Keep database code and all secrets out of browser packages.
- Make delivered endpoints, unimplemented contract endpoints, and external dependencies explicit.
- No deployment, paid service, production credentials, automated purchases, or partner outreach.
- No fabricated catalog, generated looks, plans, balances, or commission results.
- No real photo ingestion, AI generation, payment, or Google authentication in this infrastructure change.

## Approaches

1. **Bun workspaces + TypeScript modular API (recommended engineering choice).** Reuse the frontend's package manager and language. Fastify supplies HTTP routing, schema validation, and plugin boundaries. PostgreSQL access uses `pg` and versioned SQL migrations. This keeps the initial toolchain small and makes schema changes inspectable.
2. **Bun workspaces + NestJS API.** Adds stronger framework conventions and dependency injection, but more ceremony than the current project needs. Revisit if the team needs that uniformity.
3. **Separate frontend/API repositories or independently deployed microservices.** Adds coordination and operational overhead before either a backend or external integrations exist. It does not fit the requested consolidated development workflow.

Use option 1 unless the user selects another approach. These framework and layout choices are recommendations, not previously approved product decisions. No Turborepo, Redis, worker service, or shared UI abstraction until a demonstrated need exists.

## Proposed repository

```text
stylai/
  apps/
    web/                     existing frontend, preserved with path fixes
      src/
      tests/
      scripts/e2e.mjs
      .env.example           public VITE_* configuration only
    api/
      src/
        app.ts               testable server factory; no socket on import
        server.ts            validated environment, startup, shutdown
        config/              validated server configuration
        plugins/             database, CORS, security headers, error handling
        modules/
          health/            liveness/readiness
          catalog/           first real public domain, read-only initially
      tests/
      .env.example           backend-only configuration placeholders
  packages/
    database/
      src/                   pool lifecycle, repositories, migration runner
      migrations/            ordered SQL, schema_migrations ledger
      tests/
  docs/
    API-CONTRACT.md          existing contract stays canonical
    architecture.md         boundaries, request flow, actual endpoint coverage
    development.md          Windows setup, PostgreSQL, commands, troubleshooting
    security.md             implemented controls and remaining release work
    context/                source snapshots + origin/date manifest
    superpowers/
  package.json               private workspace; root scripts
  bun.lock                   single workspace lockfile
  .gitignore
  README.md
```

Create shared contracts only when API and browser actually share runtime schemas; do not extract all frontend types speculatively. Database internals must never become web dependencies. Keep one root Git repository; no nested `.git`. Move the copied Git history with the repository root unchanged. Do not change remotes or push automatically.

The frontend E2E runner currently resolves `node_modules/vite` relative to its own project. Adapt resolution for the selected workspace linker and verify the runner still works. Update moved source comments and README links pointing to the canonical API contract.

## First implementation slice

1. Move the copied frontend into `apps/web` and establish Bun workspaces. Pin the verified local Bun version (1.3.12), install once at root, and regenerate one lockfile deliberately. Keep browser E2E fixtures test-only.
2. Implement the API foundation using Fastify on port 3000, loopback binding by default, JSON schema validation, consistent Portuguese error envelopes, explicit CORS origin `http://localhost:5190`, body limits, conservative request limits, redacted logs, and graceful shutdown.
3. Add `/health/live` and `/health/ready`. Readiness checks PostgreSQL with a bounded timeout and returns 503 when unavailable. A live process must not imply database readiness.
4. Add a minimal catalog schema and public `/v1/catalog/products`, `/v1/catalog/products/:id`, `/v1/catalog/facets`, and `/v1/explore/hero`. Use actual PostgreSQL queries; the initial catalog is empty. Return the shapes expected by the existing parsers, including null hero, empty items, nullable unknown prices, facets, and bounded cursor pagination. No public catalog-write route.
5. Keep all other contract endpoints explicitly unavailable using the documented envelope and 503 `service_unavailable` (temporary) without successful-looking placeholder responses. Reject `favorites=true` until authentication is implemented. Document exact coverage. Authenticated areas remain unavailable rather than acquiring partial or insecure authentication.
6. Document root development/check/build/test/migration commands, local database creation, example environment files, and backend implementation phases.

This slice establishes the monorepo and a usable public read API; it does not implement the entire frontend contract. Authentication, closet, preferences, account data, uploads, jobs, and partner ingestion are separate next slices.

## Local PostgreSQL

Use an existing local PostgreSQL instance via backend-only `DATABASE_URL`. Do not silently install a Windows service, reuse an unrelated database, or use a superuser for application traffic. Create a dedicated `stylai` database and role through an explicit documented setup. Provide manual SQL/psql instructions for native PostgreSQL and an optional loopback-only Docker Compose development instance with a persistent named volume and health check. Compose must require an explicit local password rather than embed reusable credentials. Native PostgreSQL is sufficient; Docker is optional.

No `psql` or `pg_isready` command is currently on PATH. Docker is installed, but querying its daemon was denied by the current tool permissions. These facts do not prove PostgreSQL is absent. Investigate available local connectivity without exposing credentials; if inaccessible, deliver and validate setup instructions and report DB integration checks as blocked rather than claim a running database.

Use parameterized SQL, a bounded pool and query timeout, UTC timestamps, foreign keys, and indexes for actual catalog filters/cursors. Store money as integer minor units plus currency; convert at the API boundary to the contract's decimal amount. Keep absent prices unknown. Use deterministic `(created_at, id)` pagination and validated opaque cursors. Version migrations and serialize execution with a PostgreSQL advisory lock; record each applied migration in the same transaction as its schema changes. Do not auto-migrate at server startup or use destructive reset commands as setup.

Initial catalog tables: partners, categories, products (partner/category references, nullable price, currency, availability, timestamps), and product images with ordered positions. Additional optional contract fields may remain null/empty until real source data exists. Use synthetic rows only in an isolated integration-test database, with cleanup scoped to those rows. Never overwrite an existing user database or reset its schema.

## Security and later features

Validate environment on startup; redact URLs containing credentials, authorization headers, passwords, and cookies. Never return stacks or SQL details to clients. Fail closed on malformed filters, unsupported authenticated requests, unknown identifiers, and configuration errors. Do not enable arbitrary proxy trust. Allow only configured browser origins; CORS does not substitute for authorization. Browser `VITE_*` values are public. Ignore environment files, build artifacts, uploads, and test outputs in Git.

Subsequent authentication must meet the existing contract: password hashing with a suitable memory-hard algorithm, short-lived access tokens in browser memory, hashed refresh tokens with rotation/revocation, HttpOnly cookies with production Secure attributes, explicit same-site/CSRF protections, rate limits, generic recovery responses, and ownership checks. Implement and test those together before enabling protected features. Do not return pretend sessions in the foundation.

Photos will require consent, private object storage, type/size/content validation, access controls, retention/deletion, and provider agreements before ingestion is enabled. Job dispatch and token charging will require idempotency, transactional reservations or another overspend-safe mechanism, and charging only on confirmed success. Affiliate links require allowlisted partner handling; catalog ingestion must not fetch arbitrary user-supplied URLs. Future services integrate through adapters rather than coupling frontend screens to vendors.

## Verification and acceptance

- Verify migration-copy content before restructuring and leave the source folder unchanged.
- Run existing frontend unit tests, typecheck, production build, and E2E checks after workspace migration.
- Exercise API errors, CORS, limits, validated filters/cursors, empty public responses, and liveness/readiness with deterministic tests.
- Use real PostgreSQL integration tests for migration replay, catalog persistence/filtering/pagination, and DB-unavailable readiness. Never substitute mocks as evidence of database connectivity.
- Scan tracked files for accidental environment values and confirm database/server-only packages cannot enter the web dependency graph.
- Keep network/install failures and unavailable database/browser tools explicit. Do not claim unrun checks passed.
- No commit, push, or deployment as part of this task unless separately requested.

## References checked

- Bun workspace/isolated dependencies: https://bun.sh/docs/pm/isolated-installs
- Fastify request/response schemas and error sanitization: https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/

These support tool choices; they do not certify the resulting application as secure. Security depends on the implementation and verification above.
