# Segmind IDM-VTON — planned integration

> Historical model reference. Implement [Segmind Try-On Diffusion](segmind-try-on-diffusion.md) under the current scope.

Updated 2026-11-10. User-selected provider, replacing the earlier Luna suggestion. Planning only: no credentials read, account inspected, image uploaded, or billable call made.

## Verified documentation and limits

The [IDM-VTON API](https://www.segmind.com/models/idm-vton/api) takes `human_img` and `garm_img`; documented categories are `upper_body`, `lower_body`, `dresses`. Async v2 supports submit/status/result retrieval. Documented states are QUEUED, PROCESSING, COMPLETED and FAILED. The model page describes one-hour async result-record expiry; the [logging policy](https://docs.segmind.com/docs/serverless-api/logging) separately describes seven-day output-file retention and logged prompts/settings. Record expiry is not deletion of all provider media. The [JavaScript SDK](https://docs.segmind.com/docs/sdks/javascript) documents stable `X-Request-ID` submission deduplication; generic async guidance differs, so verify the chosen account/SDK contract before relying on retries. See the [Phase 1 evaluation and rights record](../evaluations/idm-vton.md).

The [model page](https://www.segmind.com/models/idm-vton) lists a noncommercial license. Obtain explicit confirmation of commercial hosted-use rights covering StylAI; paid API availability alone does not establish that permission. This is a launch dependency, not a conclusion that a specific commercial agreement cannot exist.

## MVP workflow decisions

These are StylAI design choices inferred from the documented interface, not promises made by the provider:

- One garment/variant and one owned ready photo per render. Set `maxChosenPieces=1`. Keep Closet/outfit collections independent of rendered garment count.
- Use deterministic catalog/style filtering for recommendations. Disable unrestricted outfit/text-to-image generation and editing. No language-model orchestrator is needed for the initial renderer.
- Map source categories explicitly to supported VTON categories. Shoes/accessories remain purchasable if approved but not renderable; communicate that distinction before submission.
- Use the selected variant's actual garment reference. A color/size choice cannot silently use a different garment image. Missing renderable asset -> unavailable try-on, not invented media.
- Version and snapshot preprocessing, category, garment description, crop behavior and model parameters. Treat any user text as selection intent; compose `garment_des` from bounded catalog metadata.
- Do not assume arbitrary multi-garment pipelines, identity recognition, region localization, provider-side cancellation, callback delivery, or guaranteed fit. Add them only with evidence.

## Server boundary and protocol

Implement `packages/ai/src/{provider,segmind,garment-input}.ts`. Keep `SEGMIND_API_KEY` in worker secrets. Fix the model slug to the approved `idm-vton` configuration; users cannot submit a model name, inference URL or arbitrary provider flags.

Use v2 async submission rather than holding the browser/API request open. At execution, pin the official SDK or documented REST contract and capture an actual sanitized example response; do not guess SDK field names from another language.

```text
queued internal job + free usage reservation
  -> claim with fencing token
  -> validate photo/variant/consent/category
  -> reserve conservative provider spend
  -> persist stable external submission key before sending
  -> submit IDM-VTON and persist returned request ID
  -> durable status polling with bounded backoff
  -> fetch output promptly
  -> validate image and garment mapping
  -> copy output to private Supabase Storage
  -> atomic look publication + free usage spend + actual cost reconciliation
```

Construct an account-scoped deterministic request key from internal job/attempt ID (valid SDK character/length rules), persist it, and reuse it across SDK retries and restarts. Do not generate a new key for an ambiguous transport failure. Verify deduplication lifetime and same-key/different-payload behavior in this account before relying on retries after long outages. Do not add a second retry layer that changes the SDK key or exceeds the configured spend reservation.

Map external QUEUED/PROCESSING to internal queued/running; COMPLETED is not internal succeeded until validation/storage/finalization commit. FAILED records a sanitized user-facing error. Timeout/unknown result retains operator-spend reservation until reconciliation. An expired external record does not prove no inference ran or no cost occurred; never resubmit under a new key solely because result retrieval returns 404.

Treat app cancellation as withholding publication and releasing user allowance under the core state machine; reconcile any already-started provider cost. Late results cannot override fenced cancellation/account deletion. Do not claim a refund of provider credits unless an actual provider agreement/response supports it.

## Private input delivery

Prefer an officially supported private byte-upload mechanism if verified. If remote URLs are required, issue narrowly scoped signed URLs for specific ready assets. Their provider-fetch TTL is distinct from the 5-minute browser display TTL: it must cover bounded queue/fetch latency, be recorded in job state, and never become a permanent public link. If the provider cannot consume our approved delivery mechanism reliably, fail before dispatch or require a reviewed ingestion design.

Do not log signed input URLs, photos, masks, provider keys or raw request bodies. Do not send measurements, email, order addresses or unrelated images. Verify provider request-history/input/output retention, data region, deletion capabilities and subprocessor terms before customer uploads. If those are not established, mark them unresolved; SDK output expiry is not proof of deletion everywhere.

Fetch outputs using an allowlisted/provider-origin policy, HTTPS, strict size/time/image limits and safe redirect handling. Store the validated binary under an owner-scoped private key. Do not return the provider media URL as the permanent look image. Track orphan objects for cleanup when DB finalization fails.

## Image and coordinate handling

Retain the original aspect ratio and version any crop/resize transform. Show guidance before modifying framing. Validate person visibility and garment/category compatibility; do not add face-recognition templates or biometric identity scores. A successful render is a visual preview, not a measurement/fit certification.

IDM-VTON output alone is not verified clothing-region geometry. Any optional mask/localization aid must be evaluated against the actual rendered garment. Only verified provider/operator mappings become hotspots. An accepted image without reliable mapping keeps the accessible product list and the documented review path; do not invent a rectangle just to satisfy UI.

## Required verification at implementation

- [ ] Commercial hosted-use rights and account/region access recorded.
- [ ] Real payload/response examples with secrets and customer media removed; SDK version pinned.
- [ ] Category, variant-image matching, framing and unsupported footwear/multi-garment behavior tested.
- [ ] 20 rights-cleared consented cases; proposed quality/latency/cost gates in the main design evaluated.
- [ ] Same-key transport retry, double submission, process restart and expired result tested; no duplicate logical render/cost assumption without provider evidence.
- [ ] Provider failure/insufficient credit/rate limit, worker death, cancel/delete race, output fetch failure and stale fence tested.
- [ ] Input-link expiry during queue delay, private output storage, signature/redaction and cleanup verified.
- [ ] Full actual attempt/success costs measured; no fixed latency/price taken from a marketing example.

No new paid model or fallback provider is silently added if these checks fail. Revisit the relevant scope with the user while continuing independent nonblocked work.
