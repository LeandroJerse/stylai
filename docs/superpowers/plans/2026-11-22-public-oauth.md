# Public OAuth test gateway

Authorized scope: prepare and test a free public callback connected to the existing local backend before applying publicly.

Design decision: use a dedicated stable hostname (`oauth.stylai.shop`, subject to DNS availability) through the already installed Cloudflare Tunnel. Serve a small operator console and an exact allowlist of authentication/OAuth routes from a loopback-only gateway. Preserve the backend's session and single-use state validation. Validate the public Origin before translating it to the configured local backend Origin; never trust forwarded headers supplied by clients. Force Secure cookies at the public boundary. No generic proxy, database, development server, uploads or paid operations.

Alternatives: moving the complete backend to cloud hosting exceeds this test scope; exposing Vite exposes development tooling; a temporary tunnel hostname changes between runs and is unsuitable for the registered callback. The existing landing page remains untouched. The Partner Center callback must be changed to the dedicated hostname only after public negative tests pass.

The operator's PC and tunnel must be running. This is an operator test facility, not production hosting. Cloudflare account access, a stable DNS route, persistent local credentials and creator eligibility remain prerequisites, not assumed facts.

- [x] Write boundary tests using a fake loopback backend, without current data or TikTok calls.
- [x] Implement exact route/method allowlist, origin/host checks, bounded bodies, safe cookies and sanitized failures.
- [x] Add a minimal console with in-memory bearer token and no third-party assets.
- [x] Run boundary tests and existing OAuth tests/typecheck.
- [ ] Configure the tunnel only after account access is available; verify public denied paths and callback invalid-state behavior before updating Partner Center.
