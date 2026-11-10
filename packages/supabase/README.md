# @stylai/supabase

Server-only isolated public/user/admin SDK factories, validated environment config and real bounded foundation readiness probe are implemented. The starter migration is validated in isolated PostgreSQL; hosted apply/connection is verified and actual generated public types are wired into the SDK factories. Read docs/SUPABASE-SETUP.md. Purpose labels do not substitute for authorization; no auth/session/upload business endpoints are implemented yet.

Development and tests resolve source with the development condition. Root tsup builds ESM packages/services and bundles internal @stylai dependencies into API/worker outputs. Do not move server integrations into the browser.
