# integrations module

- `tiktok/` — TikTok Shop Creator Collaborations: sanitized status, operator-only OAuth start,
  callback with single-use state bound to the session, encrypted token vault, disconnect.
- `aliexpress/` — AliExpress Affiliates API: sanitized status, operator-only real verification call
  (`POST /v1/integrations/aliexpress/verify`) and the registration-only callback
  `GET /api/integrations/aliexpress/callback`. The catalog uses app-level signature (no seller
  OAuth), so the callback never exchanges or stores codes and never reports a connection.
  Details: `docs/integrations/2026-11-23-aliexpress-affiliates.md`.

Shopee remains unimplemented. Unknown capabilities fail closed; do not add fake success handlers.
