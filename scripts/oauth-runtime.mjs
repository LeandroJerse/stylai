import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export function runtimeEnvironment(value, directory) {
  if (value.appKey !== '6lvudbnilidmd' || value.operatorId !== '3bf4ddbd-6a70-413d-ad58-92b441367fe9' ||
      value.callback !== 'https://oauth.stylai.shop/api/integrations/tiktok/callback' ||
      typeof value.secret !== 'string' || value.secret.length < 12 ||
      typeof value.sessionKey !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(value.sessionKey) || Buffer.from(value.sessionKey,'base64').length !== 32) {
    throw new Error('Invalid protected OAuth configuration')
  }
  return { TIKTOK_SHOP_APP_KEY:value.appKey, TIKTOK_SHOP_APP_SECRET:value.secret,
    STYLAI_TIKTOK_OPERATOR_ID:value.operatorId, STYLAI_TIKTOK_VAULT_PATH:resolve(directory,'creator-vault.json'),
    STYLAI_SESSION_KEY:value.sessionKey }
}

export function loadOAuthEnvironment() {
  const directory = resolve(process.env.LOCALAPPDATA, 'StylAI-OAuth')
  const reader = fileURLToPath(new URL('../docs/security/adequacao/Read-OAuthRuntime.ps1',import.meta.url))
  const result = spawnSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',reader], {encoding:'utf8',windowsHide:true})
  if (result.status !== 0) throw new Error('Protected OAuth configuration unavailable')
  try { return runtimeEnvironment(JSON.parse(result.stdout.replace(/^\uFEFF/,'')),directory) }
  finally { result.stdout=''; result.stderr='' }
}
