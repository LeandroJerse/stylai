# @stylai/api

Runnable Fastify foundation only. GET /health/live -> 200; GET /health/ready probes the actual expected Supabase foundation RPC: 200 on success, otherwise 503. See docs/SUPABASE-SETUP.md. App auth/domain handlers remain pending. Unimplemented /v1 routes return 503 with the existing error envelope. The Asaas webhook is deliberately NOT acknowledged. Root docs/START-HERE.md explains setup and next work.
