# @stylai/contracts

Browser-safe DTOs and future runtime schemas. Never import a server-only package. Existing frontend types/parsers still need deliberate migration; the initial shared types are not a completed API contract.

Development and tests resolve source with the development condition. Root tsup builds ESM packages/services and bundles internal @stylai dependencies into API/worker outputs. Do not move server integrations into the browser.
