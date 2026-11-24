# Google Cloud Vertex outfit integration plan

**Goal:** Use existing Google Cloud postpay credit for StylAI image generation without a new top-up.
**Architecture:** Explicit Google backend configuration (developer API vs Vertex) with project-scoped global Vertex endpoint. Reuse existing bound backend credential only after user approval of the additional API restriction. Retain existing job/ledger/photo authorization gates and do not silently fallback across billing routes. Prefer Nano Banana 2.1 at 1K after verifying model availability and published token pricing. No .env edits.
**Scope authorized:** User requested investigation and configuration if viable; API activation and Cloud terms separately approved. Credential permission expansion awaiting explicit browser confirmation.

- [x] Verify manual postpay credit applies to future Google Cloud costs; inspect billing balance R$180 and separate AI Studio balance R$0.
- [x] Verify current image generation support on project-scoped aiplatform.googleapis.com.
- [x] Probe existing credential with countTokens only: 403 API_KEY_SERVICE_BLOCKED; no paid generation.
- [x] Activate API in intended project with user-approved terms; UI status Ativado.
- [x] Existing key update failed; separately authorized dedicated Vertex-only bound key and custom predict-only role created. countTokens HTTP200 after IAM propagation.
- [x] Add transport/profile tests then minimal client, worker/API/runtime configuration and accurate provider cost metadata.
- [x] Run focused tests and complete project check.
- [x] One bounded real validation only when auth, model, pricing and pilot gates are verified; preserve accumulated budget and record any attempt allowance extension.
- [x] Record outcome and limitations in chronological QA diary. No top-up, automatic recharge, push or deployment.

Sources:
- https://docs.cloud.google.com/billing/docs/how-to/manual-payment?hl=en
- https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/capabilities/image-generation
- https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/start/api-keys?usertype=standard

Ruling: paid generation remains pending explicit approval of one additional attempt; existing 7/7 counter and budget are unchanged. Runtime readiness and countTokens succeeded; neither proves generateContent or invoice application.

Completed: user approved eighth attempt; app job succeeded via Vertex, calculated USD0.039053, accumulated USD0.669215, zero pending reserve. Invoice credit application remains unverified. Temporary sandbox membership revoked.
