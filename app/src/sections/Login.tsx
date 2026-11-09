import { useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { api, setAuthToken, type AuthRole } from '@/lib/api'
import Swarm from './Swarm'

export default function Login({ onSuccess }: { onSuccess: (role: AuthRole) => void }) {
  const [token, setToken] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const value = token.trim()
    if (!value) {
      setError('Вставь токен')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const result = await api.login(value)
      setAuthToken(value)
      onSuccess(result.role)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось войти')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="relative z-0 mx-auto flex min-h-dvh max-w-md items-center px-4 py-10">
      <Swarm variant="field" running scanning={false} offline={false} />
      <form onSubmit={submit} className="w-full rounded-2xl border border-border bg-card p-6">
        <p className="text-[11px] uppercase tracking-[0.28em] text-muted-foreground">Локатор</p>
        <h1 className="mt-1 text-2xl font-semibold leading-tight">Вход</h1>
        <p className="mt-1 text-sm text-muted-foreground">Токен из окружения бота</p>
        <Swarm running scanning={false} offline={false} className="mt-5" />
        <label className="mt-6 block text-sm text-muted-foreground" htmlFor="locator-token">
          Токен
        </label>
        <Input
          id="locator-token"
          type="password"
          autoComplete="current-password"
          value={token}
          onChange={(event) => setToken(event.target.value)}
          className="mt-1.5"
          placeholder="Вставь токен доступа или просмотра"
        />
        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
          Токен доступа открывает настройки и сделки. Токен просмотра показывает локатор,
          но не даёт ничего менять и не открывает сделки.
        </p>
        {error ? <p className="mt-3 text-sm text-destructive">{error}</p> : null}
        <Button type="submit" disabled={busy} className="mt-5 w-full cursor-pointer">
          {busy ? 'Проверяю…' : 'Войти'}
        </Button>
      </form>
    </div>
  )
}
