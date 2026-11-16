# @stylai/supabase

Server-only isolated public/user/admin SDK factories, validated environment config and real bounded foundation readiness probe are implemented. The starter migration is validated in isolated PostgreSQL; hosted apply/connection is verified and actual generated public types are wired into the SDK factories. Read docs/SUPABASE-SETUP.md. Purpose labels do not substitute for authorization; no auth/session/upload business endpoints are implemented yet.

Development and tests resolve source with the development condition. Root tsup builds ESM packages/services and bundles internal @stylai dependencies into API/worker outputs. Do not move server integrations into the browser.

The private Node/PostgreSQL boundary is implemented in `src/private-{config,transactions,database}.ts`. It uses dedicated API, AI-worker, payments and procurement roles with allowlisted function calls, no direct table access, checked role/ACL identity, bounded connections, remote certificate verification and no mutation retries. A fifth forward migration creates disabled NOLOGIN roles; hosted apply/credentials are pending. Read `docs/operations/private-database-boundary.md` before provisioning. This transport trusts server-derived actors and does not implement app authentication or business routes. Run `bun run test:db:private` for the real disposable Node/pg integration suite.
