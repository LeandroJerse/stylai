# Worker handlers — not implemented

Planned logical handlers: asset-validation, generation (Segmind), catalog-sync, fulfillment, payment-reconciliation (Asaas), source-reconciliation, cleanup and deletion. Use separate bounded queues/concurrency; inference kill switches must not stop paid-order reconciliation or privacy cleanup. Implement lease fencing, idempotency, durable results and provider spend/procurement reservations before dispatch. The current worker only exposes health and consumes no work.
