/**
 * Session state. On start it tries to restore the session from the refresh cookie
 * (POST /auth/refresh). Signing in, signing up and Google sign-in all end in the same place:
 * an access token in memory (http.ts) and the user in context.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { api, http } from "../api/client"
import type { Session, User } from "../api/types"

export type AuthStatus = "restoring" | "signed-in" | "signed-out"

interface AuthCtx {
  status: AuthStatus
  user: User | null
  /** Whether the API base URL is configured at all. */
  connected: boolean
  signIn: (email: string, password: string) => Promise<User>
  signUp: (input: { name: string; email: string; password: string }) => Promise<User>
  signInWithGoogle: (idToken: string) => Promise<User>
  signOut: () => Promise<void>
  setUser: (user: User) => void
  /** Set when the session ended on its own (expired refresh), so the shell can say so once. */
  expired: boolean
  clearExpired: () => void
}

const Ctx = createContext<AuthCtx | null>(null)

export function useAuth(): AuthCtx {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error("useAuth outside AuthProvider")
  return ctx
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient()
  const [status, setStatus] = useState<AuthStatus>(http.configured ? "restoring" : "signed-out")
  const [user, setUserState] = useState<User | null>(null)
  const [expired, setExpired] = useState(false)

  const accept = useCallback((session: Session): User => {
    http.setAccessToken(session.accessToken)
    setUserState(session.user)
    setStatus("signed-in")
    setExpired(false)
    return session.user
  }, [])

  const reset = useCallback(() => {
    http.setAccessToken(null)
    setUserState(null)
    setStatus("signed-out")
    // Private data from the previous account must not survive in the cache.
    qc.removeQueries({ predicate: (q) => ["me", "closet", "preferences", "studio"].includes(String(q.queryKey[0])) && q.queryKey[1] !== "config" })
    void qc.invalidateQueries({ queryKey: ["catalog"] })
  }, [qc])

  useEffect(() => {
    if (!http.configured) return
    let alive = true
    api.auth
      .refresh()
      .then((s) => alive && accept(s))
      .catch(() => alive && setStatus("signed-out"))
    const off = http.onSessionExpired(() => {
      reset()
      setExpired(true)
    })
    return () => {
      alive = false
      off()
    }
  }, [accept, reset])

  const value = useMemo<AuthCtx>(
    () => ({
      status,
      user,
      connected: http.configured,
      expired,
      clearExpired: () => setExpired(false),
      signIn: async (email, password) => {
        const u = accept(await api.auth.signIn(email.trim(), password))
        void qc.invalidateQueries()
        return u
      },
      signUp: async (input) => {
        const u = accept(await api.auth.signUp({ ...input, name: input.name.trim(), email: input.email.trim() }))
        void qc.invalidateQueries()
        return u
      },
      signInWithGoogle: async (idToken) => {
        const u = accept(await api.auth.google(idToken))
        void qc.invalidateQueries()
        return u
      },
      signOut: async () => {
        try {
          await api.auth.signOut()
        } finally {
          reset()
        }
      },
      setUser: (u) => setUserState(u),
    }),
    [status, user, expired, accept, reset, qc],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
