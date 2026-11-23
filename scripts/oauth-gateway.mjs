import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const callback = '/api/integrations/tiktok/callback'
// Registration-only callback: no OAuth exchange, so no cookies are forwarded to it.
const aliexpressCallback = '/api/integrations/aliexpress/callback'
const callbacks = new Set([callback, aliexpressCallback])
const allowed = new Set([
  `GET ${callback}`, `GET ${aliexpressCallback}`, 'POST /v1/auth/sign-in', 'POST /v1/auth/refresh',
  'POST /v1/auth/sign-out', 'GET /v1/integrations/tiktok/management',
  'POST /v1/integrations/tiktok/connect', 'POST /v1/integrations/tiktok/disconnect',
])
const headers = {
  'cache-control': 'no-store', 'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY',
  'content-security-policy': "default-src 'none'; script-src 'self'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
}

/** A bounded operator-only entry point, never a general-purpose reverse proxy. */
export async function startOAuthGateway({ publicOrigin, backendOrigin, backendPort = 3100, port = 3110, lifetimeMs = 3600000 }) {
  const external = new URL(publicOrigin)
  const internal = new URL(backendOrigin)
  if (external.protocol !== 'https:' || external.origin !== publicOrigin || external.username || external.password) throw new Error('Invalid public origin')
  if (!['localhost', '127.0.0.1'].includes(internal.hostname) || internal.protocol !== 'http:' || internal.origin !== backendOrigin) throw new Error('Backend origin must be loopback')
  if (!Number.isInteger(backendPort) || backendPort < 1 || backendPort > 65535) throw new Error('Invalid backend port')
  const html = await readFile(new URL('./oauth-console/index.html', import.meta.url))
  const js = await readFile(new URL('./oauth-console/console.js', import.meta.url))
  const server = createServer({ requestTimeout: 15000, headersTimeout: 10000, maxHeaderSize: 16384 }, async (req, res) => {
    const send = (status, value) => { res.writeHead(status, { ...headers, 'content-type': 'application/json' }); res.end(JSON.stringify({ error: value })) }
    try {
      if (req.headers.host !== external.host) return send(421, 'invalid_host')
      const path = (req.url ?? '').split('?')[0]
      if (req.url.length > 4096) return send(414, 'request_too_long')
      const origin = req.headers.origin
      if ((origin && origin !== publicOrigin) || (req.method === 'POST' && origin !== publicOrigin)) return send(403, 'invalid_origin')
      if (req.headers['sec-fetch-site'] === 'cross-site' && !callbacks.has(path)) return send(403, 'cross_site')
      if (req.method === 'GET' && (req.url === '/' || req.url === '/console.js')) {
        res.writeHead(200, { ...headers, 'content-type': req.url === '/' ? 'text/html; charset=utf-8' : 'text/javascript; charset=utf-8' })
        return res.end(req.url === '/' ? html : js)
      }
      if (!allowed.has(`${req.method} ${path}`)) return send(404, 'not_found')
      if (!callbacks.has(path) && req.url.includes('?')) return send(400, 'unexpected_query')
      if (callbacks.has(path)) {
        const query = new URL(req.url, publicOrigin).searchParams
        if (['code', 'state', 'error', 'error_code'].some(key => query.getAll(key).length > 1)) return send(400, 'duplicate_parameter')
      }
      if (req.method === 'POST' && !/^application\/json(?:;|$)/i.test(req.headers['content-type'] ?? '')) return send(415, 'json_required')
      const chunks = []
      let size = 0
      for await (const chunk of req) {
        size += chunk.length
        if (size > 16384) return send(413, 'body_too_large')
        chunks.push(chunk)
      }
      const body = Buffer.concat(chunks)
      if (req.method === 'GET' && body.length) return send(400, 'unexpected_body')
      const upstreamHeaders = { accept: 'application/json' }
      if (origin) upstreamHeaders.origin = backendOrigin
      if (req.method === 'POST') upstreamHeaders['content-type'] = 'application/json'
      if (req.headers.authorization) upstreamHeaders.authorization = req.headers.authorization
      const cookie = (req.headers.cookie ?? '').split(';').map(v => v.trim()).filter(v => /^(stylai_session|stylai_tiktok_oauth)=/.test(v)).join('; ')
      if (cookie && path !== aliexpressCallback) upstreamHeaders.cookie = cookie
      const upstream = await fetch(`http://127.0.0.1:${backendPort}${req.url}`, {
        method: req.method, headers: upstreamHeaders, body: req.method === 'POST' ? body : undefined,
        redirect: 'error', signal: AbortSignal.timeout(12000),
      })
      const cookies = upstream.headers.getSetCookie().filter(v => /^(stylai_session|stylai_tiktok_oauth)=/.test(v)).map(v => {
        const scoped = v.replace(/;\s*Domain=[^;]*/gi, '')
        return `${scoped}${/;\s*Secure(?:;|$)/i.test(scoped) ? '' : '; Secure'}${/;\s*HttpOnly(?:;|$)/i.test(scoped) ? '' : '; HttpOnly'}`
      })
      res.writeHead(upstream.status, { ...headers, 'content-type': 'application/json', ...(cookies.length ? { 'set-cookie': cookies } : {}) })
      res.end(Buffer.from(await upstream.arrayBuffer()))
    } catch { if (!res.headersSent) send(502, 'backend_unavailable'); else res.end() }
  })
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve) })
  let closed = false
  const close = async () => {
    if (closed) return
    closed = true
    clearTimeout(timer)
    await new Promise(resolve => { server.closeAllConnections(); server.close(resolve) })
  }
  const timer = setTimeout(() => { void close() }, Math.min(Math.max(lifetimeMs, 1000), 3600000))
  timer.unref()
  return { port: server.address().port, close }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const gateway = await startOAuthGateway({ publicOrigin: process.env.STYLAI_OAUTH_PUBLIC_ORIGIN, backendOrigin: process.env.STYLAI_OAUTH_BACKEND_ORIGIN ?? 'http://localhost:5200' })
  console.log(`OAuth gateway listening on loopback port ${gateway.port}; expires after one hour. No public tunnel is started by this script.`)
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { void gateway.close() })
}
