# StylAI decision register

Updated 2026-11-10. Latest explicit user decisions supersede earlier proposals. This register records project decisions, not long-term assistant memory.

## Confirmed user direction

| ID | Decision | Consequence |
| --- | --- | --- |
| D01 | Active repository: `C:/Users/belch/QKD-Projects/StylAI/stylai` | Keep the original frontend folder/prototype intact; consolidate future work here |
| D02 | Git origin: https://github.com/LeandroJerse/stylai | Local origin fetch/push URLs updated and verified; no push, fetch, remote existence or branch-history verification performed |
| D03 | Supabase | Replaces bespoke local PostgreSQL deployment; local Supabase CLI remains optional development/CI tooling |
| D04 | Segmind IDM-VTON | Replaces tentative Luna/OpenAI image generation; actual provider access and commercial-use rights still require evidence |
| D05 | Integrated payments in MVP | Cart, authoritative quote, payment, order, fulfillment, support/refund and reconciliation are launch-critical; referral-only checkout no longer satisfies scope |
| D06 | AliExpress, Shopee and TikTok Shop APIs | Plan all three adapters; verify each regional program, account and operation instead of assuming generic dropshipping capability |
| D07 | Supplied layered architecture as context | Use frontend/edge/orchestrator/workers/persistence layers and management epics; individual technologies shown are not automatically selected |
| D08 | Plan the full MVP and needed frontend/API changes | Documentation and reviewable plans are authorized; live payments, purchases, cloud creation and public deployment have not been performed |
| D09 | Asaas payment processor | Processor selection is settled; verify merchant settings, methods and sandbox integration. Do not build Stripe |
| D10 | Create runnable monorepo/app structure and detailed successor handoff | Scaffold is implemented under apps/packages; full domain integrations remain next-developer work |

## Engineering/product proposals to validate

| ID | Proposal | Why / validation |
| --- | --- | --- |
| P01 | Preserve React/Vite; TypeScript/Fastify API; Bun workspaces; Node API/worker | Existing frontend investment and one language; verify workspace build/E2E and runtime support |
| P02 | Supabase Postgres queue before Redis/Celery/BullMQ | Durable workflow without another service; test visibility/fencing, load and recovery |
| P03 | One garment/variant and one front photo per render | Conservative IDM-VTON workflow; verify real categories/poses/variant fidelity before extending |
| P04 | One source/seller/region/currency group per paid order | Avoid unsupported split shipping/procurement; allow browsing all three sources and explain separate orders |
| P05 | Three free renders per UTC day; no paid AI plan yet | Cost containment independent of merchandise checkout; confirm actual budgets and communication |
| P06 | Private photos/results and short-lived links | Consent, ownership and lifecycle; test direct Storage bypass, expiry, revocation and deletion |
| P07 | Logical worker modules/queues before many independently deployed services | Keep boundaries from the reference without speculative infrastructure; split when measured resource needs justify it |
| P08 | Verified product hotspots + accessible list | Preserve the original differentiating interaction without inventing geometry or exact-fit claims |

## Remaining decisions and proof owners

Owners below are roles to assign, not named people who have accepted responsibility. No external outreach is authorized by this register.

| ID | Required decision/evidence | Owner role | Blocks |
| --- | --- | --- | --- |
| O01 | Commercial hosted IDM-VTON rights, Segmind account, data terms/retention and evaluation spend ceiling | Business/product + provider account owner | Customer-image processing and commercial release |
| O02 | Official source program/app type, region, credentials/scopes, supplier agreement and approved ordering path for each source | Commerce integrations + business owner | Real catalog/purchase activation per source |
| O03 | Asaas merchant account and enabled methods/currencies; seller identity and refund/dispute process | Business/finance + payments owner | Gateway adapter and public checkout |
| O04 | Supplier procurement funding method, working-capital/FX limits, supplier payment finality and exception owner | Business/finance + fulfillment operator | Automatic or manual supplier purchases |
| O05 | First sellable and renderable products, permitted assets and accurate variant/stock/shipping data | Catalog/operator | Product-first previews and trustworthy quotes |
| O06 | API/worker/web host, domain/edge/SMTP, Supabase region/plan and restore features | Platform owner | Staging/production acceptance |
| O07 | Consent/retention/deletion policy, safety/reporting and retained commerce records | Product/business + appropriate advisers | Public onboarding and account deletion promises |
| O08 | Support/fulfillment/refund/reconciliation operators and response deadlines | Business/operator | Paid-order launch |

## Superseded choices

- Standalone local PostgreSQL: replaced by Supabase.
- Tentative GPT Luna/image-tool approach: replaced by Segmind IDM-VTON.
- Undecided checkout / supplier-checkout-first recommendation: replaced by required integrated payments.
- A single unselected supplier as the entire planned connector scope: replaced by the three named source integrations; a single fulfillment group per order remains a proposal.
- Next.js, React Native/Flutter, FastAPI/NestJS, Medusa/Shopify, Redis, Qdrant, face recognition, CJ Dropshipping and local GPU pipelines in the reference are not selected by merely appearing in the diagram.

No account access, licensing right, regional API permission or production functionality becomes “confirmed” solely because it is listed in a decision register.
