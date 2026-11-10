# Asaas — selected payment processor

Implement the Asaas adapter here following docs/integrations/asaas.md and C0-C7. No Stripe implementation is needed. Use dedicated webhook authentication, durable event receipt/deduplication and authoritative payment reconciliation; no webhook 200 ACK before persistence. Customer payment and supplier procurement are different ledgers.
