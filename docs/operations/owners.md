# Owners and operating responsibilities

Updated 2026-11-10. **All people remain unassigned by the owner's explicit instruction.** An account holder, repository author or AI assistant is not automatically an accepted operating owner. The roles below define the work; they do not invent appointments.

## Responsibility register

| Role | Responsible person | Required decisions and evidence | When required |
| --- | --- | --- | --- |
| Product/business | Unassigned | Launch market, currency, legal seller identity, MVP acceptance and explicit scope changes | Before public commerce/onboarding |
| Platform/security | Unassigned | Hosting, domains, secrets, Supabase administration, monitoring, restore and incident ownership | Before staging operations |
| Catalog/source authorization | Unassigned | Three developer programs, account/region grants, supplier agreements, permitted images and accurate variants | Before source activation |
| Payment operations | Unassigned | Asaas sandbox vs production, merchant capability, methods, webhook reconciliation and disputes | Before payment activation |
| Procurement/fulfillment | Unassigned | Funding, supplier purchases, delivery/tracking, ambiguous-order reconciliation and returns | Before accepting paid orders |
| Privacy/support | Unassigned | Consent/retention, deletion requests, customer support channel, escalation and response deadlines | Before customer photos/orders |
| Technical implementation | Unassigned | Implement plan with actual tests and update contracts/status together | Before assigning delivery work |
| Independent technical review | Unassigned | Review authorization, money flows, migrations, recovery and release evidence independently of implementation | Before release decision |

One person may eventually cover several roles, but must explicitly accept each responsibility. An independent review should be separate from implementation where feasible. No staff member, adviser or support provider has been contacted or appointed by this document.

## Decisions still open

Brazil/BRL and Pix/card/boleto are confirmed and a CNPJ exists. Exact merchant/seller verification, procurement budget, support/refund ownership and deadlines remain open. See [launch decisions](../decisions/2026-11-10-launch-answers.md) and [operations](commerce-and-admin.md).

## Assignment and handover procedure

1. Record the accepted person's name, role, backup, effective date and restricted contact/runbook location. Keep personal contact details out of a public repository.
2. Grant least-privilege account access directly; never share another person's password or commit credentials. Record access verification and revocation/recovery responsibility.
3. Agree escalation triggers and response deadlines for stuck payments, paid-but-unfulfilled orders, supplier outage, data deletion and security incidents.
4. Link the actual evidence and acceptance decision in [Phase 1 readiness](../decisions/phase-1-readiness.md). Revoke access on handover and test continuity without the departed account.

Until assignments exist, development can continue on isolated schema, contracts and tests. Public launch and unattended money/fulfillment operations cannot claim operational ownership is established.
