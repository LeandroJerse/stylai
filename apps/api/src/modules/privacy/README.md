# Privacy module — implementation status

POST /v1/privacy/deletion-requests accepts `{ confirm: true }` with an authenticated session and exact app Origin. The actor comes exclusively from the session. Returns 202 `{ requestId, status: "pending" }`; never claims completed erasure.

Database request revokes app sessions and photo consent and cancels pending jobs. Migration 20261122163645_account_deletion_asset_purge additionally queues the account's private images for the existing physical purger. This migration has been tested in an isolated PostgreSQL container; deployment to the active database must be tracked separately.

Remaining: frontend request UI, final metadata/Auth removal, export/correction workflow, deletion replay after backup restoration, and completion receipts. Do not advertise complete account erasure. Photo consent/removal routes already live under modules/photos.
