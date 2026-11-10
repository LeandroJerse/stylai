/**
 * Client-side form checks. They only spare a round trip: the API validates again and its
 * field messages (ApiError.fields) win when they disagree.
 */

export const PASSWORD_MIN = 8
export const PASSWORD_MAX = 128
export const NAME_MAX = 80

/** Pragmatic email check: something@domain.tld, no spaces. */
export function emailError(raw: string): string | null {
  const v = raw.trim()
  if (!v) return "Informe seu e-mail."
  if (v.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) return "Use um e-mail válido, como nome@exemplo.com."
  return null
}

export interface PasswordCheck {
  id: "length" | "letter" | "number"
  label: string
  ok: boolean
}

export function passwordChecks(v: string): PasswordCheck[] {
  return [
    { id: "length", label: `${PASSWORD_MIN} caracteres ou mais`, ok: v.length >= PASSWORD_MIN },
    { id: "letter", label: "Uma letra", ok: /\p{L}/u.test(v) },
    { id: "number", label: "Um número", ok: /\d/.test(v) },
  ]
}

/** For new passwords (sign-up, reset, change). Sign-in only checks that it is not empty. */
export function newPasswordError(v: string): string | null {
  if (!v) return "Crie uma senha."
  if (v.length > PASSWORD_MAX) return `Use no máximo ${PASSWORD_MAX} caracteres.`
  const missing = passwordChecks(v).filter((c) => !c.ok)
  return missing.length ? `A senha precisa de: ${missing.map((c) => c.label.toLowerCase()).join(", ")}.` : null
}

export function nameError(raw: string): string | null {
  const v = raw.trim()
  if (!v) return "Informe como quer ser chamada ou chamado."
  if (v.length > NAME_MAX) return `Use no máximo ${NAME_MAX} caracteres.`
  return null
}
