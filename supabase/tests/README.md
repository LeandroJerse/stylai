# Real database tests — foundation

Run `bun run test:db` for real PostgreSQL 17 SQL/RLS/constraint assertions in an ephemeral network-disabled container. `bootstrap-postgres.sql` is a test-only minimal Auth/Storage compatibility schema; NEVER apply it to a Supabase project. `foundation.sql` rolls back all synthetic data. This is real SQL/RLS evidence, not proof of the hosted platform's complete Auth/Storage behavior. Real hosted connection is checked separately via `bun run supabase:check`.

The harness replays all numbered migrations. `domain.sql` and `commerce.sql` test private privileges and core business transactions. `concurrency-fixtures.sql` seeds only the disposable database for independent-session request idempotency and procurement balance races. See [Phase 2 verification](../../docs/qa/2026-11-10-phase-2-database.md) for coverage and remaining hosted/provider checks.

Do not replace these checks with fake Supabase clients or report them as passing from a green scaffold unit suite.
