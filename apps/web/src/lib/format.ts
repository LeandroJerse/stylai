const moneyFormatters = new Map<string, Intl.NumberFormat>()
const dec1 = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const int = new Intl.NumberFormat("pt-BR")
const dateTime = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
const dateOnly = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", year: "numeric" })

export function formatMoney(amount: number, currency = "BRL"): string {
  let f = moneyFormatters.get(currency)
  if (!f) {
    try {
      f = new Intl.NumberFormat("pt-BR", { style: "currency", currency })
    } catch {
      f = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" })
    }
    moneyFormatters.set(currency, f)
  }
  return f.format(amount)
}

export const formatRating = (value: number): string => dec1.format(value)
export const formatInt = (value: number): string => int.format(value)
export const formatMB = (bytes: number): string => `${(bytes / (1024 * 1024)).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB`
export const plural = (n: number, one: string, many: string): string => `${int.format(n)} ${n === 1 ? one : many}`

/** ISO date-time from the API, shown in the viewer's local time. Invalid values return null. */
export function formatDateTime(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : dateTime.format(d)
}

export function formatDay(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : dateOnly.format(d)
}
