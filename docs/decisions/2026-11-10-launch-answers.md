# Launch decisions — owner answers, 2026-11-10

This record supersedes earlier Phase 1 statements that all launch settings were undefined. Earlier QA records describe what was known at that time. Confirmed scope is distinct from implemented code, verified provider access and recommendations awaiting a business decision.

## Confirmed requirements

| Area | Owner decision | Implementation consequence |
| --- | --- | --- |
| Launch | Brazil, Portuguese, BRL; existing CNPJ | Brazilian checkout/address/currency and seller disclosures; exact legal identity/merchant match stays in restricted business records |
| Sources | AliExpress, Shopee and TikTok Shop desired at launch | Retain all three adapters; current lack of developer accounts/grants is not resolved by naming them |
| Clothing | Tops, bottoms and dresses | Catalog taxonomy and model category mapping for all three; category-specific quality evaluation |
| Operations | Asked for explanation/recommendations; no person assigned | Roles remain unassigned; see commerce/admin operating proposal |
| Asaas | Owner has production and sandbox accounts; may create dedicated StylAI account | Existence confirmed; credentials/capabilities/KYC/merchant matching remain unverified. No new account was created here |
| Methods | Pix, credit card and boleto required; installments requested for explanation | Plan three methods. Maximum installments/interest/minimum parcel remain a decision; do not imply every method uses identical hosted checkout |
| Pricing | Admin panel required to configure pricing/shipping | Add secured admin workstream; no hardcoded markup/shipping or public settings mutation |
| Catalog | No suppliers/products yet; prepare curated workflow | Intake and rights/variant verification templates, publication review, no production sample catalog |
| Model | Segmind **Try-On Diffusion** at `/models/try-on-diffusion/api` | Replaces IDM-VTON as target; different payload/category strings and separate rights evidence |
| Free usage | Logged-in users: 3 generations daily | Verified active account and atomic server quota; no anonymous render allowance |
| Paid usage | AI membership/subscription: up to 20 daily | Separately billed AI entitlement, not a benefit granted forever by a clothing purchase. 20 is total daily limit, not 20+3 |
| Rendering | One garment/front photo and one active job accepted | Preserve product-first ownership/consent/variant mapping and DB concurrency limit |
| Evaluation | Prepare dataset collection | Protocol and manifest only; no test photos received, billable run or benchmark result |
| Authentication | Email/password plus Google required at launch | Google implementation/configuration becomes required Phase 3 work, not a permanently hidden feature |
| Audience | 18+ accepted | Age affirmation and appropriate policy; no biometric identity pipeline requested |
| Retention | 7 days for original uploads and unsaved previews; saved looks retained until deleted | Saving output must not silently retain its original input photo; worker cleanup and UI expiry semantics required |
| Policies | Prepare drafts | Privacy, photo consent, purchases/shipping/returns and membership drafts; not published/approved legal text |
| Domain/email | Being acquired/configured | Exact domains, DNS and sender/SMTP provider still pending; no speculative domain/contact published |
| Hosting | Hetzner VM suggested by owner; advice requested | Document modest VM/API/worker/web design with managed Supabase; no VM purchased or vendor selected by this proposal |
| Environments | Initially requested staging, then explicitly deferred: keep Free `stylai-dev` only; paid staging later | **Do not create/upgrade/pause/delete projects now.** Existing dev remains sole StylAI hosted environment |
| Git | Small phase/adjustment commits allowed; user always pushes; keep 1–2 branches | Continue existing branch, create local focused commits, never push automatically |

## Recommendations still awaiting approval

- Procurement working-capital amount/order cap, refund reserve, supplier agreements and who operates purchases/support.
- Manual fulfillment fallback where no approved automatic ordering API exists. This must be approved per source, not treated as API permission.
- Maximum card installments, fee allocation and installment settlement/anticipation policy.
- Membership price, monthly included allowance or full daily-limit economics, account billing cadence/grace/refund rules and actual AI spending limits. No price/budget is authorized by the sample economics.
- Hosting provider/VM size/budget and future paid Supabase staging budget, domain/SMTP choice and operational owners.

## Prepared artifacts

- [Current Segmind contract](../integrations/segmind-try-on-diffusion.md)
- [Operations and admin specification](../operations/commerce-and-admin.md)
- [Budget and hosting recommendations](../operations/budget-and-hosting.md)
- [Curated catalog intake](../catalog/README.md)
- [Evaluation collection protocol](../evaluations/try-on-diffusion.md)
- [Portuguese policy drafts](../legal/mvp-policy-drafts.pt-BR.md)

The shared Gemini URL `https://share.gemini.google/sB96mULTyhPX` could not be accessed by the research tool. No content or decisions from that conversation were invented. The user's explicit answers and linked Segmind documentation supply the current scope.
