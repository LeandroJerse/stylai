# Hosted Supabase setup and verified foundation

Current target runtime: **Node 26.13.0 LTS**, Bun 1.3.12. Supabase remains the hosted database/Auth/Storage choice; it does not host the standalone Node API/worker by itself.

## What is implemented locally

- Isolated public/user/admin SDK factories, no persisted/auto-refreshed browser session on the server, and validation preventing secret/service-role keys in public client configuration.
- An actual bounded `stylai_health` database RPC probe. API `/health/ready` is 200 only for the expected foundation schema; absent config, bad access, unavailable DB or missing/wrong schema remains 503. This readiness means the foundation is reachable, not that auth/payments/the whole MVP is complete.
- Migration `supabase/migrations/20261110000100_foundation.sql`: profiles, private future session vault/active-session predicate, published-rights-cleared catalog tables, protected private photo buckets and schema-health function. No sample products/accounts or sensitive data are seeded.
- Real PostgreSQL 17 role/RLS/constraint tests via an isolated network-disabled Docker container. Auth/Storage system schemas in that suite are test-only compatibility fixtures; real hosted Supabase still requires its own apply/probe/security verification.
- App auth routes/session encryption/rotation, actual uploads, catalog endpoints, jobs, Asaas and source workflows remain future phases. The schema is a foundation, not delivery of those features.

## Verified workspace state — 2026-11-10

Project `stylai-dev` (`yekhpfwxuiuakxznxaew`) is hosted in `us-east-1` (the region selected at creation). CLI login works. Preflight found no app tables, buckets, users or conflicting functions. Migration `20261110000100` is applied through the migration ledger. `supabase:check` returns `ready`; the actual local API returns readiness 200 against this hosted database. Public types were generated from it and wired into clients. Hosted RLS/grants/private bucket metadata and anonymous read behavior were checked; security advisor returned no warning/error findings. Full Auth/email/Storage upload/deletion workflows are not yet implemented or validated. See [current verification](qa/2026-11-10-node26-supabase-foundation.md).

## 1. Sign in and identify the hosted project

The workspace currently uses authenticated CLI access; the plugin is optional and was not used for this application. Install it, sign in to the account owning the project, and allow the requested project access. Do not paste a personal access token or service-role key into chat.

If you already have a dedicated StylAI development project, identify it by project URL or reference. The owner created project `yekhpfwxuiuakxznxaew`; the starter foundation is now applied and ready. If none exists, use [Supabase Dashboard](https://supabase.com/dashboard) to create a dedicated `stylai-dev` project in the intended organization and nearby region (São Paulo `sa-east-1` for a Brazil-focused launch when available; see [official regions](https://supabase.com/docs/guides/platform/regions)). Use an available free organization/tier when appropriate; do not assume project creation in a paid organization is free. Do not upgrade/accept costs without reviewing them. Save any database password in the owner's password manager, not this repository or chat.

Before hosted apply: inspect project identity, organization/tier/region, existing schemas/tables/functions, migrations and bucket policies. This migration uses common names such as `profiles` and `products`: **do not apply blindly to an existing shared application or production database**. A name collision must be reconciled; do not drop/reset user data to force it through. The SQL is transactional and does not overwrite conflicting tables/buckets.

Only after selecting and inspecting the actual intended development project should migrations be applied. For this workspace the reviewed starter migration was applied with `bun run supabase migration up --remote=yekhpfwxuiuakxznxaew --yes`. Use an explicit target for future changes, inspect pending migrations, and do not replay bootstrap SQL manually over existing objects.

## 2. Configure the API securely

Copy `apps/api/.env.example` to the ignored `apps/api/.env.local`. For the foundation connection, only the project URL and publishable/legacy anon key are needed:

```dotenv
NODE_ENV=development
SERVICE_HOST=127.0.0.1
API_PORT=3000
APP_ORIGIN=http://localhost:5190
SUPABASE_URL=https://YOUR_PROJECT_REFERENCE.supabase.co
SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY
SUPABASE_PROJECT_REF=YOUR_PROJECT_REFERENCE
```

The placeholders above are not working credentials. Get the actual URL/key from the project's Connect dialog or Settings > API Keys ([official API key guide](https://supabase.com/docs/guides/getting-started/api-keys)) or the authenticated connector. Do not put a `sb_secret_` or legacy `service_role` key in `SUPABASE_PUBLISHABLE_KEY`. `SUPABASE_ANON_KEY` is supported as a legacy alternative. Leave the optional server secret unset until an elevated feature needs it; public readiness does not require admin access.

Never copy the API file into web env. The browser talks to the StylAI API; it does not receive the Supabase admin key, session encryption key, Asaas key or Segmind key. Example files remain generic; actual env files are ignored.

## 3. Use Node 26

Install/use the version in `.node-version`/`.nvmrc` with your normal version manager. In the current Windows workspace, this task also downloaded a checksum-verified official portable runtime into ignored `.tools` without changing system Node. Activate it in a PowerShell terminal with:

```powershell
. ./scripts/use-node.ps1
node --version
```

Expected: `v26.13.0`. The portable directory is not committed, so another clone should install/use the pinned runtime normally. CI reads `.node-version`.

## 4. Apply, then probe the actual hosted foundation

After hosted migration application and API env setup:

```sh
bun install --frozen-lockfile
bun run supabase:check
bun run dev:api
```

`supabase:check` loads only the ignored API env file, prints a nonsecret project hostname and a sanitized status, and returns nonzero unless the expected schema RPC actually succeeds. Useful statuses: `not_configured`, `invalid_key`, `schema_missing`, `schema_mismatch`, `unreachable`, `ready`.

Verify `GET http://127.0.0.1:3000/health/ready` returns 200 with Supabase ready. Wrong project/schema must remain nonready. `GET /health/live` stays a separate process check. Never edit the probe to return success to bypass project access or missing migrations.

The hosted connection probe is read-only. It does not prove every ownership policy or Auth/Storage workflow. After applying, verify the real hosted catalog cannot be written anonymously, profile/vault data is unavailable without an active app session, buckets are private, and broad existing policies cannot bypass the restrictive asset guards. Add real hosted role/Storage integration tests as the feature routes are implemented.

## 5. Local checks before Git publication

```sh
bun run check
bun run test:db
bun run test:e2e
bun run supabase:check
```

The first three validate local code, SQL/RLS and preserved fixture frontend behavior. The last one is the actual hosted foundation check and requires configured project access/migration. Do not label it passed when it is still `not_configured`. `test:integration` currently delegates to that hosted foundation probe, not a full end-to-end provider suite.

The database test creates only an ephemeral `stylai-foundation-test-*` container, exposes no port, uses no real keys/data and removes the container afterward. It does not reset a local/shared/hosted project.

Full generated database types must be generated from the actual migrated project, not handwritten and labeled generated. Connector access and CLI login are separate authentication contexts; a working plugin does not automatically sign the CLI in. See the current verification record for which hosted steps actually ran.

No commit/push, external project creation, paid service or production deployment is implied by local test success.
