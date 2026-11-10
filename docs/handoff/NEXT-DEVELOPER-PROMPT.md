# Suggested kickoff prompt for the implementing developer/agent

Copy the following into the next implementation session after the repository is committed/pushed. It deliberately does not require this planning chat.

---

Implement the StylAI MVP in this repository, following `docs/START-HERE.md`, `docs/handoff/CONTEXT.md` and `docs/handoff/IMPLEMENTATION-PLAN.md`. Read the Asaas, Segmind and marketplace specifications and the actual scaffold verification before changing code.

Confirmed stack/scope: preserve the React/Vite web app; TypeScript/Fastify API and durable worker; Supabase Auth/Postgres/private Storage; Segmind IDM-VTON; integrated merchandise checkout using **Asaas**; AliExpress, Shopee and TikTok Shop source adapters. The supplied architecture diagram guides layers/workstreams, not mandatory adoption of every technology in it. Do not reopen Asaas selection, replace the frontend stack or reduce required source/payment scope silently.

Phase 1 baseline and fact registers are delivered; read docs/decisions/phase-1-readiness.md and docs/qa/2026-11-10-phase-1-baseline.md. Keep external gates open: all people unassigned by owner choice, Asaas account environment/access unverified, no Segmind/marketplace developer accounts yet, business settings not defined. Continue independent Phase 2 work without rerunning folder migration or inventing permissions.

The repository currently has a working monorepo/app scaffold, not a finished backend. API readiness probes the actual Supabase foundation RPC; absent configuration remains 503. Worker remains idle/nonready. Unimplemented business routes (including payment webhook) cannot return fake success. Supabase SDK clients, starter SQL/RLS and isolated PostgreSQL tests exist. Hosted apply/connection and generated public types are complete. App auth, catalog endpoints, rendering, payments and purchasing remain pending. Read docs/SUPABASE-SETUP.md and the latest QA record.

Start by inspecting Git state/origin and running the documented frozen install and root checks. Then execute phases 1–2 for a real database/security foundation, progressing through the dependent vertical slices. Extend existing files; do not repeat the completed frontend move. Preserve the original UI/brand/tests and user work. Use meaningful tests and real role/concurrency checks for auth, RLS, money, jobs and deletion. Keep a progress/evidence record so later sessions can resume.

Do not treat test-only fake providers or browser fixtures as proof of real integration. Record missing external access/commercial rights/merchant/source permissions explicitly and continue independent work. Obtain credentials only through the owner's intended secure channel. No secret or customer media in browser/Git/logs. Commercial IDM-VTON rights, source image/fulfillment permission, Asaas merchant methods and procurement funding remain launch prerequisites.

Critical invariants: one canonical garment/variant/photo per initial render; real products selected before rendering; stable internal and external operation identities; fenced durable workers; separate free rendering/provider spend/customer payment/procurement ledgers; one order per quote and one active payable attempt; authenticated durable Asaas event receipt before HTTP200; authoritative money reconciliation; no duplicate supplier purchase or over-refund; deletion cannot republish media or discard required commerce obligations.

Complete the plan with verifiable app/schema/provider/source evidence and operator runbooks. Report delivered vs pending vs externally blocked scope honestly. Commit/push/deploy and live purchases/paid evaluation follow the current owner's authorization, not assumptions in an old document.

---
