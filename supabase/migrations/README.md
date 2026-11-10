# Migrations — foundation implemented

`20261110000100_foundation.sql` creates the starter profiles/session-vault/catalog/private-bucket/readiness foundation. It passed isolated PostgreSQL role/RLS tests with test-only Auth/Storage compatibility schemas. It is applied to `stylai-dev` and its hosted readiness, metadata permissions and security advisor were checked; see the latest QA record. Inspect existing object names first; never reset/drop a shared project to make this migration apply. Later domain migrations remain planned.

Create reviewed SQL migrations here in plan order. Supabase CLI owns the migration ledger. The starter foundation is partial; complete later domain groups through reviewed migrations. Every exposed table needs grants/RLS in its creating migration; private tables and privileged functions need explicit restrictions.

Read docs/handoff/IMPLEMENTATION-PLAN.md phases 2–5 and the detailed schema/invariant sections in the design. Never run reset against a linked/shared project. `bun run db:migrate:local` targets the local stack only and is not evidence that domain schema exists.
