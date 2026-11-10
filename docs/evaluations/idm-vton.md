# IDM-VTON access, rights and evaluation record

Updated 2026-11-10. Selected provider/model: **Segmind IDM-VTON**. Owner confirms no Segmind account yet. No API key inspected, image uploaded, paid call made or measured quality/cost result exists. All people remain unassigned and evaluation spend is not approved.

## Access and rights evidence

| Gate | Current evidence | Required next evidence |
| --- | --- | --- |
| Account/model entitlement | No account yet | Account-scoped access to the chosen model/version, actual endpoint/limits and restricted credential storage |
| Commercial hosted use | Unresolved | Written applicable permission/terms covering commercial StylAI inference and outputs; clarify model/version and any downstream restrictions |
| Supplier/garment assets | No approved catalog yet | Right to display and send the exact garment/variant images to the provider |
| Person/photo processing | No approved data protocol yet | Participant consent, retention/deletion terms and approved provider-processing disclosure |
| Evaluation funding | Not defined | Maximum total spend/currency and billable-attempt ceiling, approving owner and stop conditions |
| Technical/quality result | Not evaluated | Versioned sanitized case results and explicit go/no-go decision |

The [upstream model card](https://huggingface.co/yisol/IDM-VTON) identifies CC BY-NC-SA 4.0; [Segmind's model page](https://www.segmind.com/models/idm-vton) describes a different noncommercial label. Both signal an unresolved commercial-use question, and their discrepancy should be clarified with the provider. Neither buying credits nor a public API listing proves StylAI has commercial rights. This record is documentation evidence, not a legal opinion or conclusion that a separate commercial agreement cannot exist.

## Provider data and protocol findings

Checked official docs 2026-11-10; all are documentation claims, not tested account guarantees.

- [Model API](https://www.segmind.com/models/idm-vton/api): person/garment inputs; supported categories `upper_body`, `lower_body`, `dresses`; async submit/poll/result path. Its async result record is described as expiring after one hour. Capture model/schema version at actual integration.
- [Logging policy](https://docs.segmind.com/docs/serverless-api/logging): inference input media is transient; prompts/settings are logged and output files retained seven days. Thus async record expiry must not be described as deletion of every provider copy. Confirm account terms, URL privacy and deletion/retention exceptions before customer uploads.
- [Async API](https://docs.segmind.com/docs/serverless-api/async-inference) warns about duplicate submissions; [JavaScript SDK](https://docs.segmind.com/docs/sdks/javascript) documents request-key deduplication. Validate the chosen pinned SDK/endpoint/account behavior and deduplication lifetime rather than promising exactly-once billing. Unknown submissions must not be blindly retried under a new key.

Do not use public persistent provider file uploads for customer photos by default. Prefer reviewed short-lived private input delivery; keep personal data out of prompts/logs. Provider-retained output and StylAI-owned private Storage have independent lifecycles. Request cancellation is not proof of completed deletion or stopped billing.

## Prepared evaluation protocol — not yet executed

Use at least 20 rights-cleared, consented cases spanning the three supported garment categories, sizes/poses/body representations and lighting. Record unsupported footwear/accessories, occlusion, non-front crops and mismatched variants as negative cases; do not imply support merely from one attractive image. Keep person images, outputs and signed links out of Git.

Before running: obtain the rights/access/data/spend gates above, freeze dataset IDs and expected garment variants, pin provider contract/parameters, define acceptance thresholds and reviewers, and store media only in an approved restricted location. The main design's numerical thresholds are proposals until accepted; no invented pass rate is a result.

| Measurement | Record per case | Acceptance focus |
| --- | --- | --- |
| Input provenance | Opaque case ID, consent/rights references, photo/garment hashes, category/variant and framing | No wrong asset, person or unapproved data |
| Exact settings | Model slug/version if exposed, SDK/REST version, preprocessing, seed/steps/crop and request-key version | Reproducible evidence; unknown model version explicitly recorded |
| Quality | Human review of garment color/pattern/logo/silhouette, identity preservation, artifacts and usable resolution | No exact-fit/measurement claim; no silent wrong-variant result |
| Reliability | Submission/poll/final-copy status, failure class, timeout/unknown outcome and recovery | Completion only after validated private output persistence |
| Latency | Queue, inference, download/final-copy and end-to-end times; p50/p95 plus sample count | Include failures and queue time; small sample is exploratory |
| Cost | Every billable attempt/reservation, actual currency/charge, failures/retries and cost per accepted result | No marketing-price assumption; no lost unknown spend |
| Lifecycle | Request-record expiry, output retrieval, deletion/cancel race and provider cleanup evidence | Local deletion cannot falsely promise all provider copies gone |

Stop on budget ceiling, missing rights/consent, unexpected billing, wrong-person/garment privacy error or uncontrolled duplicate submissions. Reconcile every submitted request and retained output before closing evaluation. An interrupted evaluation is inconclusive, not a pass.

## Result and decision template

Append a dated run containing dataset/version, approved budget, environment/model/SDK, counts attempted/completed/accepted/failed/unknown, measured latency/cost, failures, reviewers and accepted decision (`go`, `revise`, `no-go`, `inconclusive`). Link restricted evidence by opaque identifier. Do not invent values until the actual run exists.

Current decision: **not evaluated; customer-photo processing and commercial activation remain gated.** Continue independent schema/contracts/UI work. See [integration specification](../integrations/segmind-idm-vton.md) and [Phase 1 readiness](../decisions/phase-1-readiness.md).
