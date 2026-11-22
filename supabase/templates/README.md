# Auth e-mail templates

- `confirmation.html` — sign-up confirmation. Link = `{{ .RedirectTo }}?token_hash=…&type=email`, where RedirectTo is the
  `emailRedirectTo` the API sends: `<APP_ORIGIN>/#/confirmar-email` (server config, never chosen by the browser). The origin
  must be in `auth.additional_redirect_urls`; otherwise Supabase uses the Site URL; the
  app sends the hash to `POST /v1/auth/email/verify`, which verifies it with Supabase (`verifyOtp`, type `email`)
  and starts the server-side session. No custom token implementation.
- Recovery (password reset) template: not implemented yet (the reset flow is pending).

Local (`supabase start`) e-mails go to Mailpit (http://127.0.0.1:54324). Hosted projects need the same template,
the app URL in the redirect allowlist and a real SMTP sender configured per environment. Never put credentials here.
