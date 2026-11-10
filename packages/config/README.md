# @stylai/config

Server configuration validation for current scaffold. Add provider-specific validation only when that implementation exists. Do not expose secrets through VITE_ variables.

Development and tests resolve source with the development condition. Root tsup builds ESM packages/services and bundles internal @stylai dependencies into API/worker outputs. Do not move server integrations into the browser.
