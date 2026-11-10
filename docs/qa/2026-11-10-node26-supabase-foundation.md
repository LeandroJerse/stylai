# Node 26 and Supabase foundation — 2026-11-10

## Delivered locally

- Node 26.13.0 LTS pin, Node 26 service targets/types and CI version file; Bun 1.3.12 remains package manager/test runner. Official portable Node archive was checksum-verified and placed in ignored `.tools`; system Node was not replaced.
- Validated isolated public/user/admin Supabase SDK factories, bounded actual schema RPC probe and API readiness wiring. No configuration means nonready, never simulated connectivity.
- Transactional starter migration for profiles, future private app-session vault, public rights-cleared catalog, private photo buckets and schema health RPC. Full domain/backend features remain planned.
- Real PostgreSQL 17 role/RLS/constraint assertions in a disposable network-disabled container with no exposed port. Auth/Storage schemas there are compatibility fixtures, not the hosted platform.
- Real guarded hosted check/type-generation scripts and hosted setup guide. No handwritten fake generated database types.

## Verification evidence

- Frozen Bun install and full `bun run check` on Node 26.13.0 passed: import guard, TypeScript checks, **65 tests / 0 failures**, service/web builds and built Node API/worker smoke.
- `bun run test:db` passed after the final migration change. Tested profile bootstrap/ownership/active-session revocation, published catalog filtering, prohibited writes, same-product image/variant constraints and restrictive private Storage rules even with a broad permissive test policy. Synthetic data rolled back; disposable container removed.
- Node 26 frontend fixture E2E passed all 16 checks with no page JavaScript errors. This uses its fake backend and proves no actual Supabase/provider integration.
- Missing-config negative checks: `supabase:check` returned `not_configured` and exit 1; `db:types` exited 1 without writing a schema file.
- Pinned CLI 3.1.0 help confirms `migration up` defaults to local; remote targeting requires `--remote`. `db:migrate:local` therefore targets local, not an implicitly linked hosted project.
- Independent source review found no actionable Important/Critical findings. Reviewer sandbox could not run its local HTTP tests or CLI help; the main-agent full checks and CLI inspection above supply that local evidence.
- `git diff --check` passed; origin fetch/push is `https://github.com/LeandroJerse/stylai`.

## Hosted state and remaining work

The owner created hosted project `stylai-dev` (`yekhpfwxuiuakxznxaew`, region `us-east-1`) and authenticated the CLI. Saved publishable configuration is in the ignored API env only. The dashboard URL was corrected to the project API origin. Initial hosted probe correctly reported `schema_missing`; after inspected migration application it returns `ready`.

Hosted evidence:

- Read-only preflight: zero app relations, buckets, users, conflicting functions or custom Storage policies. The unrelated project in the account was not modified.
- CLI 3.1.0 initially rejected deprecated local `[inbucket]` configuration before applying SQL. Renamed it to `[local_smtp]`; migrated deprecated `auth.email.enable_signup` to `enabled`. These are local configuration compatibility changes, not a hosted Auth configuration deployment.
- Explicitly targeted `supabase migration up --remote=yekhpfwxuiuakxznxaew --yes` applied migration `20261110000100`; hosted migration ledger confirms that version.
- All nine app tables have RLS. Three asset buckets are private with 12 MiB limits; four restrictive Storage policies exist. Metadata confirms anon cannot select profiles/insert products and authenticated cannot select the private session vault.
- Actual anonymous HTTP checks: catalog GET 200 with empty rows, profiles GET 401, non-exposed session vault route 404. No customer or synthetic hosted users/products were created.
- Hosted security advisor at warning/error level: no issues found. This is a point-in-time advisor result, not full security certification.
- Actual temporary local API connected to hosted Supabase: readiness HTTP 200 with `dependencies.supabase=ready`; process was stopped afterward.
- Actual hosted public database types generated via `bun run db:types` (CLI 3.1.0) and wired into SDK factories. Corrected no-argument health RPC calls to match that generated signature; no generated output was hand-edited.
- Full local `bun run check` rerun after those code changes passed: types, 65 tests, builds and offline built-service smoke. Offline smoke deliberately clears credentials and expects 503; it is separate from the hosted 200 check.

Remaining hosted feature verification includes real signup/email/recovery/session lifecycle, two authenticated accounts, Storage binary upload/read/deletion and all future domain/provider flows. The foundation connection is complete; the MVP is not.

App Auth/email/session lifecycle, catalog HTTP endpoints, private asset ownership APIs, jobs, Segmind, Asaas, source purchasing and production hosting remain future implementation. Foundation readiness does not certify them. No commit, push, paid request or app deployment was performed. The hosted starter database migration was applied as described above.
