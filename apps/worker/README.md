# @stylai/worker

Runnable idle Node foundation only. GET /health/live -> 200; GET /health/ready -> 503. It does not consume queues, render images, synchronize products, buy goods or process refunds. Add handlers only with the corresponding idempotency/fencing/ledger tests.
