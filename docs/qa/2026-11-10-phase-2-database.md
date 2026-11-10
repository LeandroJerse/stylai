# Phase 2 database implementation and evidence

The forward migrations build on `20261110000100`. All new tables and functions are in the unexposed `private` schema. Browser roles have no direct access. Existing public profiles/catalog policies and the foundation readiness marker stay in place. SQL entry points accept trusted server actor IDs. An API must derive each actor from its authenticated app session and use a server-side database connection or an explicitly reviewed narrow boundary. The public Supabase SDK cannot call the private functions through PostgREST. Keep `private` out of exposed schemas.

| Migration | Delivered |
| --- | --- |
| `20261110000200_private_domain.sql` | Source connections and variant identity, consent/assets, preferences, roles/versioned settings/audit, memberships, AI jobs and usage, Closet ownership, account deletion request. Atomic submission, 3/12 allowance, worker fencing, cancellation and revocation of sessions on deletion. |
| `20261110000300_checkout_transactions.sql` | Carts, quotes, orders, payment attempts/inbox/outbox, procurement reservation and settlement, refund/supplier/shipment storage. One order per quote, single dispatch claim, verified payment correlation, separately bound instrument deadline and supplier funding reservation. |
| `20261110000400_ai_spend_and_closet.sql` | Daily/monthly BRL spend reservations in millionths of a real, separate search/generation costs, unresolved-attempt guard, exclusive fenced dispatch, durable verified variant, saved output retention and distinct product favorites. |

AI requests use a stable owner-scoped key and canonical hash. Persist the bounded search query and any explicitly selected variant before queueing. The database consumes one unit after a successful or completed no-match request and releases the unit on failure or cancellation. This is the initial quota behavior for review. Reconcile actual provider spend independently. Confirmed payments and supplier funding are separate. Reconcile the authoritative provider event and timestamp, bind the instrument deadline, and revalidate supplier eligibility before an external purchase. Retain minimized order and spend records when user identity is removed.

## Verification

- `bun run test:db` starts a network-isolated PostgreSQL 17 container and replays every numbered migration. Fixture tests cover anonymous/authenticated denial, 3/12 quota, owned photos, idempotency and fencing, explicit variant preservation, saved look provenance and expiry, separate cost accounting, duplicate payment events, payment amount checks, supplier reserve/settlement and order retention after account deletion.
- Two independent PostgreSQL sessions check same-key enqueue and competing orders against one insufficient shared budget. Fixtures exist only inside the disposable database.
- `bun run check` passed 65 tests, TypeScript checks, builds and offline smoke on Node 26.13.0 / Bun 1.3.12.
- `stylai-dev` (`yekhpfwxuiuakxznxaew`) preflight showed only the starter migration and zero profiles. All three Phase 2 migrations applied through the CLI. Read-only verification found all four migration versions in the ledger, RLS enabled on all 32 private tables, zero browser-role table grants and zero browser-callable Phase 2 functions. The hosted foundation probe returned `ready` and public types regenerated with no diff. No test fixtures were applied remotely.
- Review findings addressed in SQL include exclusive AI dispatch claims, input and consent locks during finalization, durable search and selected variant, and separating quote creation expiry from the provider's payment timestamp/deadline. Real hosted authorization flows and full privacy/provider race drills remain release verification work.

## Follow-on work

The existing `stylai_health` RPC proves the original foundation only. Public generated types continue to describe the public schema. API handlers, worker transport and the connection-specific least-privilege SQL credentials are follow-on integration. No operating budget, admin identity, merchant account or supplier connection is seeded by these migrations. The settings/grants, membership, refund, supplier and shipment tables need their feature-specific validated mutations and reconciliation in their owning phases. Binary cleanup, retention enforcement and deletion completion run in the future worker. Asaas setup is in progress with the owner. Use verified sandbox evidence before enabling checkout.
