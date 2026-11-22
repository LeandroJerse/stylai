# Complete local demo implementation plan

Goal: make port 5192 exercise the current frontend with a local simulated API.
Architecture: retain the existing frontend imports; isolate demo data, endpoint behavior and browser-only controls under .preview. No production API changes.
Authorization: user requested updating 5192 with fake data and all existing 5190 functionality.

- [ ] Add contract regression tests for populated initial state, multiple offers, dress/search, job cancellation and charging, encoded Match undo, uploads, preferences and account lifecycle.
- [ ] Complete the demo engine and add local controls for reset, sign-out, balance and job failures. Keep uploaded photos and credentials out of persistent storage.
- [ ] Reuse local demo images; expose working simulated store pages; document limits (no real AI, Google OAuth, email delivery or payments).
- [ ] Run strict typecheck, contract tests, frontend tests and preview build; exercise principal flows in the browser and refresh the downloadable artifact.
