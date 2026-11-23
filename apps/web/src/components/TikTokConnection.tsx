import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { http } from "../api/client"
import { messageOf } from "../api/errors"

/** Only the server-designated operator sees this control for the shared creator catalog. */
export function TikTokConnection() {
  const status = useQuery({ queryKey: ["tiktok-management"], queryFn: () => http.request<{ canManage: boolean; oauthReady?: boolean; connected?: boolean }>("/integrations/tiktok/management", { auth: "required" }), retry: false })
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState("")
  if (!status.data?.canManage) return null
  async function connect() {
    setBusy(true)
    setMessage("")
    try {
      const result = await http.request<{ authorizationUrl: string }>("/integrations/tiktok/connect", { method: "POST", auth: "required" })
      const url = new URL(result.authorizationUrl)
      if (url.origin !== "https://shop.tiktok.com" || url.pathname !== "/alliance/creator/auth") throw new Error("Link de autorização inválido.")
      window.location.assign(url.toString())
    } catch (error) { setMessage(messageOf(error)) } finally { setBusy(false) }
  }
  async function disconnect() {
    setBusy(true)
    try {
      await http.request("/integrations/tiktok/disconnect", { method: "POST", auth: "required" })
      await status.refetch()
      setMessage("Acesso local desconectado. Para revogar também no TikTok, abra a autorização e selecione remover todo o acesso.")
    } catch (error) { setMessage(messageOf(error)) } finally { setBusy(false) }
  }
  return <section className="sa-cfg-group" aria-label="Integração TikTok Shop">
    <h3 className="sa-subheading">TikTok Shop — conta de criador</h3>
    <p className="sa-caption sa-muted mt-2">{status.data.connected ? "Conta conectada ao catálogo." : "Conta não conectada."} A conexão permite consultar produtos; não autoriza enviar imagens ao provador.</p>
    <div className="flex flex-wrap gap-2 mt-4">
      <button className="sa-btn sa-btn-secondary" disabled={busy || !status.data.oauthReady} onClick={() => void connect()}>Conectar ou revisar autorização</button>
      <button className="sa-btn sa-btn-secondary" disabled={busy} onClick={() => void disconnect()}>Desconectar do aplicativo</button>
    </div>
    {message && <p role="status" className="sa-caption mt-2">{message}</p>}
  </section>
}
