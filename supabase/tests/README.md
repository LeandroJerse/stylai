# Real database tests — foundation

Run `bun run test:db` for real PostgreSQL 17 SQL/RLS/constraint assertions in an ephemeral network-disabled container. `bootstrap-postgres.sql` is a test-only minimal Auth/Storage compatibility schema; NEVER apply it to a Supabase project. `foundation.sql` rolls back all synthetic data. This is real SQL/RLS evidence, not proof of the hosted platform's complete Auth/Storage behavior. Real hosted connection is checked separately via `bun run supabase:check`.

Add isolated migration/RLS/transaction/concurrency tests with anon, user A, user B and worker/admin roles. Root `test:db` covers the starter foundation; remaining domain cases below are still required. Required cases include cross-owner denial, direct Storage mutation denial, revoked sessions, job quota races, unique quote-to-order/payment attempts, worker fencing, procurement budgets and deletion with retained commerce obligations.

Do not replace these checks with fake Supabase clients or report them as passing from a green scaffold unit suite.
