import { useCallback, useSyncExternalStore } from "react"
import { isOfferExpired } from "./offers"

const noServerExpiry = () => false

/** A rendered sale expires even when its last payload remains in the query cache. */
export function useOfferExpiry(expiresAt: string | null | undefined): boolean {
  const read = useCallback(() => isOfferExpired(expiresAt), [expiresAt])
  const subscribe = useCallback((update: () => void) => {
    if (!expiresAt || read()) return () => undefined
    let timer: number | undefined
    const schedule = () => {
      if (timer !== undefined) window.clearTimeout(timer)
      if (read()) update()
      else timer = window.setTimeout(schedule, Math.min(Date.parse(expiresAt) - Date.now(), 2_147_483_647))
    }
    schedule()
    window.addEventListener("focus", schedule)
    return () => {
      if (timer !== undefined) window.clearTimeout(timer)
      window.removeEventListener("focus", schedule)
    }
  }, [expiresAt, read])
  return useSyncExternalStore(subscribe, read, noServerExpiry)
}
