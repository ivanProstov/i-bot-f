import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { api, authToken, clearAuthToken, type AuthRole } from '@/lib/api'
import Login from '@/sections/Login'

interface Session {
  role: AuthRole
  logout: () => void
}

const AuthContext = createContext<Session | null>(null)

export function useAuth(): Session {
  const session = useContext(AuthContext)
  if (!session) throw new Error('Нет сессии локатора')
  return session
}

export default function AuthGate({ children }: { children: ReactNode }) {
  const [role, setRole] = useState<AuthRole | null>(null)
  const [checking, setChecking] = useState(() => Boolean(authToken()))

  useEffect(() => {
    const onUnauthorized = () => {
      setRole(null)
      setChecking(false)
    }
    window.addEventListener('locator-unauthorized', onUnauthorized)
    return () => window.removeEventListener('locator-unauthorized', onUnauthorized)
  }, [])

  useEffect(() => {
    const saved = authToken()
    if (!saved) return
    let cancelled = false
    api.login(saved)
      .then((result) => {
        if (!cancelled) setRole(result.role)
      })
      .catch(() => {
        if (!cancelled) {
          clearAuthToken()
          setRole(null)
        }
      })
      .finally(() => {
        if (!cancelled) setChecking(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const logout = () => {
    clearAuthToken()
    setRole(null)
  }

  if (checking) {
    return (
      <div className="mx-auto flex min-h-dvh max-w-md items-center px-4 text-sm text-muted-foreground">
        Проверяю токен…
      </div>
    )
  }

  if (!role) return <Login onSuccess={setRole} />

  return <AuthContext.Provider value={{ role, logout }}>{children}</AuthContext.Provider>
}
