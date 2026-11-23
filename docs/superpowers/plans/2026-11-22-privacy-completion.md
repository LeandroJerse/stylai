# Privacy completion plan — approved scope, 2026-11-22

Use existing deletion request and purger; no real user erasure during tests.

1. TikTok: add regression tests for token loss on cache hits, cached item reads and in-flight responses; invalidate cache on authorization change; fence explicit revocation; persistent local revocation gate for the configured connection. Provider-side revocation remains distinct and must be observed in Partner Center.
2. Deletion: restricted administrative completion requires every owned asset confirmed deleted and no unresolved provider calls; remove identity/profile through a reviewed path, preserve minimal deletion receipt without raw identity; protect other users. Test real PostgreSQL synthetic fixtures before application.
3. Restore: preserve deletion journal outside the restored database, validate format and freshness, replay pending erasures before service release; fail closed if journal is missing/stale. Test old snapshot + newer deletion and other-user preservation.
4. Verify types, API/catalog tests and isolated PostgreSQL. Apply additive changes only after checks. No secrets/env changes, paid calls or real deletion.
5. Update evidence and public-notice status; distinguish implemented, deployed, simulated and externally verified.
