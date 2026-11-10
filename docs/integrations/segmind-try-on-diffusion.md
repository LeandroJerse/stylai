# Segmind Try-On Diffusion — current integration specification

Target selected 2026-11-10: `try-on-diffusion`, superseding `idm-vton`. Adapter remains unimplemented. The model names are not interchangeable; do not send IDM-VTON fields to the new endpoint. No Segmind account, media transfer, commercial terms acceptance or paid evaluation is claimed.

## Contract verified from official documentation

[API reference](https://www.segmind.com/models/try-on-diffusion/api): async `POST /v2/try-on-diffusion`, followed by returned status/result URLs. Required fields are `model_image`, `cloth_image`, `category`; map internal tops/bottoms/dress to provider strings `Upper body`, `Lower body`, `Dress`. Optional controls include `num_inference_steps`, `guidance_scale`, `seed`, `base64`. The example uses different steps from the parameter default: pin an evaluated explicit preset, not a copied accidental default. No arbitrary browser-supplied URL/model/control is trusted.

[Pricing](https://www.segmind.com/models/try-on-diffusion/pricing) observed 2026-11-10: serverless US$0.0072 per GPU-second. Actual charged duration and attempt costs must be measured; preview page wall time is not a guaranteed billed duration. [Model overview](https://www.segmind.com/models/try-on-diffusion) did not establish specific commercial license rights in the retrieved content. IDM-VTON's noncommercial label must not be copied onto this different model. Obtain applicable commercial hosted-use/output and data terms for this model/account before customer processing.

Retain the existing provider-neutral workflow: product/variant + owned ready photo + explicit consent -> atomic allowance/job reservation -> fenced queue claim -> conservative provider-cost reservation -> durable submission key/intent -> async submit/poll -> validated private output copy -> atomic result/usage finalization. Only the evaluated mapped garment category is renderable; no claim of physical fit/measurements.

## Persistence, privacy and retries

- Persist model slug, adapter/preset versions, input hashes/variant, consent version, quota period, membership entitlement snapshot and request intent before submission. Never store a signed URL as permanent object identity.
- [SDK docs](https://docs.segmind.com/docs/sdks/javascript) describe stable `requestId`/`X-Request-ID`; generic async guidance differs. Pin and verify the selected account/SDK behavior, deduplication window, same-key/different-body behavior and restart recovery. No new-key retry for an unknown billable outcome.
- [Logging policy](https://docs.segmind.com/docs/serverless-api/logging) distinguishes transient inference inputs, retained prompts/settings and seven-day output files. Short-lived async request-record expiry is separate. Confirm actual provider deletion, URL privacy, subprocessors/locations and any exceptions before customer consent text is finalized.
- Do not put person names, contact details, addresses or order details into the model payload/prompts. Prefer short-lived private input delivery over provider public/persistent upload helpers.
- Bound submission/poll/download duration, output bytes/pixels/MIME and allowed destinations. Validate URL/DNS/redirects against SSRF; never proxy arbitrary browser/vendor URLs into internal networks.
- A local cancel, deletion request or timeout does not prove the inference stopped or cost disappeared. Fence late results; prevent republishing deleted media; reconcile unknown vendor spend independently of user allowance release.

## Membership and quota requirements

Free: 3/day; active paid AI membership: up to 20/day total. One active job/user. Daily periods initially UTC as an engineering proposal; disclose reset time locally and confirm before marketing. Membership is not inferred from a merchandise payment, client flag, email metadata or checkout redirect.

Separate immutable ledgers for user usage and provider spend. Provider failures can cost money even when user units are returned. Global limits reserve conservatively under concurrency across all workers/instances. Missing defensible per-attempt ceiling means no dispatch. Budget pausing must not stop payment reconciliation or deletion work.

Membership price/monthly allowance/spending caps remain proposals in [budget recommendations](../operations/budget-and-hosting.md). Do not sell 20/day while implementing a hidden monthly cap. Entitlement activation/expiry/revocation is controlled by reconciled membership billing and server validity period, with a job-time snapshot and consistent refund/cancel race policy.

## Acceptance evidence

Use [the collection/evaluation protocol](../evaluations/try-on-diffusion.md). Verify all three categories; variant/image matching; malformed/unsupported inputs; real sanitized submit/poll/result; actual duration/cost; paid entitlement expiry/concurrent consumption; stable-key retry; unknown submission; insufficient balance/rate limits; stale worker; cancellation/deletion and expired external records. No measured latency/quality/cost claim exists yet.
