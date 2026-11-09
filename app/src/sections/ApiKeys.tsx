import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { api, type TradeEnv } from '@/lib/api'

const ACCOUNTS = [
  {
    env: 'demo' as const,
    title: 'Демо-счёт',
    hint: 'Ключ создаётся на demo.binance.com. На реальные деньги не действует.',
    href: 'https://demo.binance.com/ru/my/settings/api-management',
  },
  {
    env: 'live' as const,
    title: 'Реальный счёт',
    hint: 'Ключ создаётся на binance.com. Им открываются настоящие сделки.',
    href: 'https://www.binance.com/ru/my/settings/api-management',
  },
]

function KeyForm({
  env,
  title,
  hint,
  href,
  saved,
  onSaved,
}: {
  env: TradeEnv
  title: string
  hint: string
  href: string
  saved: boolean
  onSaved: (env: TradeEnv, present: boolean) => void
}) {
  const [apiKey, setApiKey] = useState('')
  const [secret, setSecret] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const live = env === 'live'

  async function save() {
    setBusy(true)
    setFailed(false)
    try {
      const next = await api.saveKeys(env, apiKey, secret)
      onSaved(env, next[env])
      setApiKey('')
      setSecret('')
      setMessage(next[env] ? 'Ключ сохранён на этом компьютере' : 'Ключ удалён')
    } catch (err) {
      setFailed(true)
      setMessage(err instanceof Error ? err.message : 'Не удалось сохранить')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={`rounded-xl border p-5 ${live ? 'border-destructive/50' : 'border-border'}`}>
      <div className="mb-1 flex items-center justify-between gap-3">
        <h3 className="font-semibold">{title}</h3>
        <span className={`text-xs ${saved ? 'text-[hsl(var(--long))]' : 'text-muted-foreground'}`}>
          {saved ? 'ключ задан' : 'ключ не задан'}
        </span>
      </div>
      <p className="mb-3 text-xs text-muted-foreground">
        {hint}{' '}
        <a href={href} target="_blank" rel="noopener noreferrer" className="underline">
          Управление API
        </a>
      </p>
      <div className="grid gap-3">
        <div>
          <Label className="mb-1.5 block text-sm text-muted-foreground">API key</Label>
          <Input
            type="password"
            autoComplete="off"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={saved ? 'сохранён, введите новый чтобы заменить' : ''}
            className="font-mono"
          />
        </div>
        <div>
          <Label className="mb-1.5 block text-sm text-muted-foreground">API secret</Label>
          <Input
            type="password"
            autoComplete="off"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            className="font-mono"
          />
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant={live ? 'destructive' : 'outline'}
            onClick={() => void save()}
            disabled={busy}
            className="cursor-pointer"
          >
            {busy ? 'Сохраняю…' : 'Сохранить ключ'}
          </Button>
          {message ? (
            <p className={`text-xs ${failed ? 'text-destructive' : 'text-muted-foreground'}`}>
              {message}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  )
}

export default function ApiKeys() {
  const [status, setStatus] = useState<{ demo: boolean; live: boolean } | null>(null)

  useEffect(() => {
    api.keyStatus().then(setStatus).catch(() => setStatus({ demo: false, live: false }))
  }, [])

  return (
    <section className="mt-8 max-w-3xl space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Ключи для открытия сделок</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Демо и реал хранятся отдельно. Секрет в интерфейс обратно не показывается.
        </p>
      </div>
      {ACCOUNTS.map((account) => (
        <KeyForm
          key={account.env}
          {...account}
          saved={status?.[account.env] ?? false}
          onSaved={(env, present) => setStatus((prev) => ({ demo: false, live: false, ...prev, [env]: present }))}
        />
      ))}
    </section>
  )
}
