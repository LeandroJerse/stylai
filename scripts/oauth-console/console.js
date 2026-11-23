(() => {
  let accessToken = null
  const element = id => document.getElementById(id)
  const status = message => { element('status').textContent = message }
  async function request(path, body) {
    const response = await fetch(path, { method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin',
      headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
    if (!response.ok) throw new Error('Não foi possível concluir. Confira sua conta ou a configuração da integração.')
    return response.status === 204 ? null : response.json()
  }
  async function update() {
    const result = await request('/v1/integrations/tiktok/management')
    if (!result.canManage) { accessToken = null; throw new Error('Esta conta não está configurada como operador da integração.') }
    element('login').hidden = true
    element('controls').hidden = false
    element('connect').disabled = !result.oauthReady
    element('connection').textContent = result.connected ? 'Criador conectado.' : 'Criador não conectado.'
    status(result.oauthReady ? 'Pronto para iniciar a autorização.' : 'A configuração segura do backend ainda está pendente.')
  }
  element('login').addEventListener('submit', async event => {
    event.preventDefault()
    const form = new FormData(event.target)
    try {
      const result = await request('/v1/auth/sign-in', { email: form.get('email'), password: form.get('password') })
      accessToken = result.accessToken
      await update()
    } catch (error) { status(error.message) } finally { event.target.elements.password.value = '' }
  })
  element('connect').onclick = async () => {
    element('connect').disabled = true
    try {
      const result = await request('/v1/integrations/tiktok/connect', {})
      const url = new URL(result.authorizationUrl)
      if (url.origin !== 'https://shop.tiktok.com' || url.pathname !== '/alliance/creator/auth' || url.username || url.password) throw new Error('Destino de autorização inválido.')
      location.assign(url.href)
    } catch (error) { status(error.message); element('connect').disabled = false }
  }
  element('disconnect').onclick = async () => { try { await request('/v1/integrations/tiktok/disconnect', {}); await update(); status('Desconexão local concluída. A revogação no TikTok deve ser verificada separadamente.') } catch (error) { status(error.message) } }
  element('logout').onclick = async () => { try { await request('/v1/auth/sign-out', {}); accessToken = null; location.reload() } catch (error) { status(error.message) } }
  request('/v1/auth/refresh', {}).then(result => { accessToken = result.accessToken; return update() }).catch(() => status('Entre com sua conta do aplicativo StylAI.'))
})()
