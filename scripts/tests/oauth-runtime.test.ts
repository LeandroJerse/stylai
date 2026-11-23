import { test, expect } from 'bun:test'
import { runtimeEnvironment } from '../oauth-runtime.mjs'
test('OAuth configuration is bound to the dedicated operator and vault; invalid values fail closed', () => {
  const valid = {appKey:'6lvudbnilidmd', operatorId:'3bf4ddbd-6a70-413d-ad58-92b441367fe9', callback:'https://oauth.stylai.shop/api/integrations/tiktok/callback', secret:'synthetic-secret-value', sessionKey:Buffer.alloc(32,1).toString('base64')}
  const env = runtimeEnvironment(valid, 'C:\\Private\\StylAI-OAuth')
  expect(env.STYLAI_TIKTOK_OPERATOR_ID).toBe(valid.operatorId)
  expect(env.TIKTOK_SHOP_APP_SECRET).toBe(valid.secret)
  expect(env.STYLAI_SESSION_KEY).toBe(valid.sessionKey)
  expect(() => runtimeEnvironment({...valid,operatorId:'someone-else'},'C:\\Private')).toThrow()
  expect(() => runtimeEnvironment({...valid,sessionKey:'bad'},'C:\\Private')).toThrow()
  expect(() => runtimeEnvironment({...valid,secret:''},'C:\\Private')).toThrow()
})
