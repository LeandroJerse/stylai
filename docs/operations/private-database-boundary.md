# Private server database boundary

Implemented locally on 2026-11-15. Hosted application/provisioning is pending. This is an executable server transport for existing transactions, not an authenticated application feature.

## Contracts and authority

`packages/supabase/src/private-config.ts` reads purpose-specific credentials. `private-transactions.ts` defines operation names, tuples, fixed SQL casts and decoded results. `private-database.ts` owns the PostgreSQL pool, validates the effective/login role and privileges before each call, and executes one parameterized atomic SQL statement. No caller-supplied SQL identifier or raw query method is exposed.

`PrivateDatabase<P>.call(operation, ...arguments)` only accepts operations for purpose `P`; JavaScript calls also pass an explicit runtime allowlist. UUIDs are strings, bigint money/fences are decimal strings, JSON snapshots use `Json`, booleans are validated, and void is `undefined`. SQL ownership checks are reused. **Actor UUIDs must be derived from verified app sessions by future handlers; passing an arbitrary UUID into this trusted internal API is not authentication.** No HTTP business route was enabled in this slice.

| Purpose / role | Allowed existing transactions | Explicitly absent |
| --- | --- | --- |
| `api` / `stylai_api` | `enqueue_ai_job`, `cancel_ai_job`, `request_account_deletion`, `save_ai_look`, `set_favorite_product` | Worker dispatch, payment reconciliation, supplier settlement, direct sessions/tables |
| `ai_worker` / `stylai_ai_worker` | `claim_ai_job`, `finish_ai_job`, `reserve_ai_attempt`, `begin_ai_attempt`, `settle_ai_attempt`, `record_ai_selection` | Account deletion, payment confirmation, supplier settlement, direct assets/tables |
| `payments` / `stylai_payments` | `start_order_payment`, `begin_payment_submission`, `record_payment_event`, `bind_payment_resource`, `confirm_order_payment`, `close_unpayable_attempt` | Supplier settlement, membership activation, raw quote/payment mutation |
| `procurement` / `stylai_procurement` | `record_supplier_purchase` | Payment confirmation, AI spend, raw supplier/funding mutation |

These are capability boundaries, not four launched services. Payment/procurement adapters remain unimplemented. The current worker still consumes no queue. Auth/vault, catalog publication, ingestion, deletion completion, membership and read models need additional narrowly reviewed SQL entry points; do not grant table access to make those features work.

## Connection and failure behavior

- Only `STYLAI_<PURPOSE>_DATABASE_URL` is read; there is no fallback to `DATABASE_URL`, owner credentials, or a Supabase service key. Purpose names in env keys are `API`, `AI_WORKER`, `PAYMENTS`, `PROCUREMENT`.
- Remote URLs accept only `db.yekhpfwxuiuakxznxaew.supabase.co` with the matching role username, or a Supabase pooler host with `<role>.yekhpfwxuiuakxznxaew`. This intentionally restricts the implementation to the recorded `stylai-dev` project. Custom hosts or future environments require a reviewed code/config change.
- All URL query parameters are rejected, including `sslmode`, certificate files and `options`. Remote TLS always verifies certificates. Supply `STYLAI_<PURPOSE>_DATABASE_CA_CERT` securely if the actual endpoint requires its CA. Hosted TLS/custom-role/pooler access is still unverified.
- Loopback PostgreSQL without TLS is accepted for disposable/local development, and rejected when `NODE_ENV=production`.
- Pools have maximum 4 connections, 3-second acquisition/connect timeout, 10-second idle timeout, 5-second statement timeout, 7-second driver query timeout and 2-second lock timeout. Each capability role has a database connection limit of 8. Future process counts must fit the actual hosted budget; these values are not a load-test result.
- Before each probe/call the connection must have the expected `current_user` and `session_user`, an enabled login, no elevated attributes, role memberships, schema-create privileges or table/column privileges in application/system schemas, and exactly the expected private function signatures and boundary version. Disabling a login blocks new application dispatch even on an existing pooled connection.
- `PrivateDatabaseError` exposes a generic message, optional sanitized SQLSTATE and `outcome`: `not_dispatched` for preflight/input failure, `rejected` for known statement rejection, `unknown` for transport/shutdown/lost or malformed response after dispatch. No driver message, detail, SQL parameters, URL, credential or raw error cause is returned.
- **No mutation is retried automatically.** After an unknown result, reconcile through the owning durable workflow. A client timeout is not evidence of rollback or proof that provider spend/funding can be released. Failed/ambiguous connections are discarded.

Parameterized values and TLS configuration follow [node-postgres queries](https://node-postgres.com/features/queries) and [TLS configuration](https://node-postgres.com/features/ssl). Custom roles follow the [Supabase role model](https://supabase.com/docs/guides/database/postgres/roles); documentation is not evidence that hosted credentials were provisioned.

## Migration and owner provisioning

`supabase/migrations/20261115000100_server_boundary.sql` is a fifth, forward-only migration. The original four migrations are unchanged. It creates four distinct NOLOGIN/NOINHERIT/NOBYPASSRLS roles with no passwords, no memberships and no table grants. It grants schema usage and only the listed functions. Role-name collision fails instead of trusting an existing role.

The migration revokes the migration owner's global default PUBLIC function execution for **future** functions. PostgreSQL's built-in global default cannot be removed by a schema-only REVOKE. Future public RPCs must explicitly grant their intended callers. Existing grants are retained; functions created under another owner require their own default privilege policy and tests. `private` remains outside exposed PostgREST schemas.

No part of the following owner procedure was executed against hosted Supabase:

1. Review the migration and inspect the target project identity and migration ledger. Only `stylai-dev` is authorized. Use a forward migration apply, never reset/rebuild the project or copy disposable test bootstrap/fixtures into it.
2. Use an approved secure database administration connection. Set a separate random password per required role using interactive `psql` `\password stylai_api` (and the corresponding role names as needed), then enable that role with `ALTER ROLE stylai_api LOGIN`. Keep passwords out of SQL files, shell history, command arguments, chat and logs. Do not enable unused financial capabilities.
3. Put the selected connection URL into that process's ignored environment/secret store. API receives only API credentials. AI execution receives only AI-worker credentials. Future financial processes receive separate credentials. Do not grant one login several capability roles or use `SET ROLE` from an owner/service-role pool.
4. Verify real role identity, ACLs, certificate validation, schema version and denied cross-purpose/raw-table calls in the intended connection mode. No hosted success is claimed until this succeeds. Avoid passing passwords in CLI arguments or sharing admin credentials with application processes.
5. For rotation/revocation, stop new dispatch, disable the login and terminate existing sessions through an authorized operator connection, then replace secrets and restart affected processes. NOLOGIN alone does not disconnect already-open PostgreSQL sessions.

## API health and verification

`apps/api/src/server.ts` owns an optional API database pool and closes it through Fastify's `onClose`. `/health/live` remains process liveness. `/health/ready` now requires both the foundation RPC and current restricted database probe, returning separate dependency states (`not_configured`, `ready`, `unavailable` for private access). A successful foundation RPC alone returns 503. This does not verify auth, catalog, queue, Segmind, Asaas or fulfillment.

- `bun run test:db`: original network-isolated PostgreSQL 17 migration/RLS/domain/commerce/concurrency suite plus actual restricted-role tests; synthetic rows roll back.
- `bun run test:db:private`: a separate disposable PostgreSQL 17 container with one dynamically assigned **loopback-only** published port. It uses random transient login passwords, all migrations, synthetic fixtures and the actual Node/pg adapter. Faults cover backend termination before commit and a loopback protocol proxy that withholds the mutation response until PostgreSQL reports ReadyForQuery after commit, then disconnects. The committed row remains, the caller receives `unknown`, and explicit same-key reconciliation reuses it. It never reads `.env.local` or a hosted URL. Container/proxy/pool cleanup runs in `finally`.
- CI runs both suites. Local SQL/driver tests do not prove hosted Supabase custom-role provisioning, TLS, email, provider integration or deployment.

Next deliverable: design and implement the encrypted app-session vault and actor verification with narrow SQL entry points, then email/password verification/recovery/refresh/revocation and two-account API tests. Google/SMTP round trips require actual provider configuration.
