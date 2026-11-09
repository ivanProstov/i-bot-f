import { useState, type FormEvent } from 'react'
import { Activity } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { api, setAuthToken, type AuthRole } from '@/lib/api'

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
    <div className="mx-auto flex min-h-dvh max-w-md items-center px-4 py-10">
      <form onSubmit={submit} className="w-full rounded-xl border border-border bg-card p-6">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/15">
            <Activity className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-bold leading-tight">Вход в локатор</h1>
            <p className="text-sm text-muted-foreground">Токен из окружения бота</p>
          </div>
        </div>
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
