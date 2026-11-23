# tiktok-shop — Creator Affiliate Source Adapter (`v202405`)

Server-only connector for the approved Brazil modality **Colaborações do criador** (Partner Center app service ID `7710474909072181044`).

## Implemented components (tested locally without live credentials)
- `sign.ts`: official HMAC-SHA256 request signing (`signTikTokRequest`) and timestamp window check (`-300s..+30s`).
- `oauth.ts`: Creator OAuth URL builder, single-use 10-minute `state` store, code exchange (`/api/v2/token/get`) and refresh (`/api/v2/token/refresh`) enforcing `user_type = 1` and required `granted_scopes`.
- `client.ts`: read-only `POST /affiliate_creator/202405/open_collaborations/products/search` and `POST /affiliate_creator/202405/open_collaborations/products` (by IDs), dynamic-QPS backoff/jitter on 429/5xx, never mutating showcases or calling Seller APIs.
- `catalog.ts`: BR/BRL normalization (exact string IDs, no invented prices/sizes/stock), explicit capability separation (`displayAndLink: true` vs `aiTryOn: false` until image AI rights are proven), 5-minute TTL cache with expiration, cursor binding, canonical deduplication (`tiktok_shop:BR:<id>`) and purge on revocation.

## Still required for live external calls
1. Provision `TIKTOK_SHOP_APP_KEY`, `TIKTOK_SHOP_APP_SECRET` and an authorized BR Creator token (`TIKTOK_SHOP_CREATOR_ACCESS_TOKEN`, `user_type = 1`) via secure local configuration (never committed or pasted in chat).
2. Complete Partner Center security/privacy evaluation and Creator OAuth authorization granting `creator.affiliate_collaboration.read`.
3. Keep `aiTryOn` disabled for TikTok product images until explicit AI try-on rights + SKU/variant evidence exist.
