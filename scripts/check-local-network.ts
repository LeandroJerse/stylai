// Read-only checks. Credentials remain in memory and are never printed.
import { spawnSync } from 'node:child_process'
import { createConnection } from 'node:net'
import { probeFoundation, readSupabaseConfig } from '@stylai/supabase'
const inspect = spawnSync('docker', ['inspect', 'supabase_kong_stylai-local'], { encoding: 'utf8', windowsHide: true })
if (inspect.status !== 0) throw new Error('Cannot inspect local gateway')
const env: string[] = JSON.parse(inspect.stdout)[0].Config.Env
const path = env.find(value => value.startsWith('KONG_DECLARATIVE_CONFIG='))?.split('=', 2)[1]
if (!path) throw new Error('Gateway configuration path missing')
const result = spawnSync('docker', ['exec', 'supabase_kong_stylai-local', 'cat', path], { encoding: 'utf8', windowsHide: true })
if (result.status !== 0) throw new Error('Cannot read local gateway configuration')
const keys = result.stdout.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g) ?? []
const key = keys.find(value => JSON.parse(Buffer.from(value.split('.')[1]!, 'base64url').toString()).role === 'anon')
const config = readSupabaseConfig({ SUPABASE_URL: 'http://127.0.0.1:54321', SUPABASE_ANON_KEY: key })
if (!config || !['127.0.0.1', 'localhost'].includes(new URL(config.url).hostname)) throw new Error('Local configuration required')
const foundation = await probeFoundation(config)
console.log(JSON.stringify({ check: 'application-foundation', status: foundation.status }))
if (foundation.status !== 'ready') process.exitCode = 1
for (const port of [54321, 54322, 54323, 54324, 54327]) {
  await new Promise<void>((resolve, reject) => {
    const socket = createConnection({ host: '127.0.0.1', port })
    socket.setTimeout(3000)
    socket.once('connect', () => { socket.destroy(); resolve() })
    socket.once('error', () => { socket.destroy(); reject(new Error(`Local TCP failed: ${port}`)) })
    socket.once('timeout', () => { socket.destroy(); reject(new Error(`Local TCP timeout: ${port}`)) })
  })
  console.log(JSON.stringify({ check: 'loopback-tcp', port, status: 'connected' }))
}
for (const [name, url] of [
  ['auth', config.url + '/auth/v1/health'],
  ['rest', config.url + '/rest/v1/'],
  ['storage', config.url + '/storage/v1/status'],
  ['studio', 'http://127.0.0.1:54323/'],
  ['mail', 'http://127.0.0.1:54324/'],
] as const) {
  const response = await fetch(url, { headers: { apikey: config.publishableKey } })
  console.log(JSON.stringify({ check: name, status: response.status }))
  if (!response.ok) process.exitCode = 1
}
