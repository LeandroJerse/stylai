// AliExpress Affiliates runtime for the LOCAL API process only. The App Secret is read from the
// DPAPI-protected store (docs/security/adequacao/Set-AliExpressAffiliate.ps1) through a private
// stdout pipe and returned as env entries for the API child; it is never printed or written.
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

/** Validates the protected config; messages never include values. */
export function aliexpressRuntimeEnvironment(value) {
  const { appKey, secret } = value ?? {}
  const trackingId = typeof value?.trackingId === 'string' ? value.trackingId.trim() : ''
  if (typeof appKey !== 'string' || !/^\d{4,20}$/.test(appKey)) throw new Error('Invalid AliExpress App Key in protected config')
  if (typeof secret !== 'string' || secret.length < 16) throw new Error('Invalid AliExpress App Secret in protected config')
  if (trackingId && (!/^[A-Za-z0-9_-]{1,64}$/.test(trackingId) || trackingId === appKey)) throw new Error('Invalid AliExpress tracking ID in protected config')
  return {
    ALIEXPRESS_APP_KEY: appKey,
    ALIEXPRESS_APP_SECRET: secret,
    ...(trackingId ? { ALIEXPRESS_TRACKING_ID: trackingId } : {}),
    STYLAI_CATALOG_MODE: 'aliexpress_affiliate',
  }
}

/** Drops any inherited ALIEXPRESS_* entry so only the API child receives the credentials. */
export function withoutAliExpressEnv(env) {
  return Object.fromEntries(Object.entries(env).filter(([key]) => !/^ALIEXPRESS_/i.test(key)))
}

export function loadAliExpressEnvironment() {
  const reader = fileURLToPath(new URL('../docs/security/adequacao/Read-AliExpressRuntime.ps1', import.meta.url))
  const result = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', reader], { encoding: 'utf8', windowsHide: true })
  try {
    if (result.status !== 0) throw new Error('Protected AliExpress configuration unavailable (run Set-AliExpressAffiliate.ps1)')
    return aliexpressRuntimeEnvironment(JSON.parse(result.stdout.replace(/^﻿/, '')))
  } finally { result.stdout = ''; result.stderr = '' }
}
