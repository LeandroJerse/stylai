# @stylai/commerce

Server-only Asaas and source adapters. Read docs/integrations/asaas.md and the marketplace plan. Current exports identify boundaries only; no money-changing or source calls exist.

Development and tests resolve source with the development condition. Root tsup builds ESM packages/services and bundles internal @stylai dependencies into API/worker outputs. Do not move server integrations into the browser.
