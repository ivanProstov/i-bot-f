import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { api } from '@/lib/api'
import type { DemoTrade } from '@/types'

export default function ProfitCloseField({
  trade,
  readOnly = false,
  onSaved,
}: {
  trade: DemoTrade
  readOnly?: boolean
  onSaved: () => void
}) {
  const saved = trade.profit_close_usdt ?? null
  const [text, setText] = useState(saved == null ? '' : String(saved))
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!dirty) setText(saved == null ? '' : String(saved))
  }, [saved, dirty])

  const save = async () => {
    const raw = text.trim().replace(',', '.')
    const usdt = raw === '' ? null : Number(raw)
    if (usdt != null && (!Number.isFinite(usdt) || usdt <= 0)) {
      setError('Нужна сумма плюса больше нуля')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await api.setProfitClose(trade.id, usdt)
      setDirty(false)
      onSaved()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось сохранить порог')
    } finally {
      setBusy(false)
    }
  }

  if (readOnly) {
    return saved == null ? null : (
      <p className="mt-2 text-xs text-muted-foreground">
        Закроет при плюсе от {saved} USDT на бирже. Тейк по цене остаётся.
      </p>
    )
  }

  return (
    <div className="mt-3">
      <label className="text-xs text-muted-foreground" htmlFor={`profit-${trade.id}`}>
        Закрыть при плюсе, USDT
      </label>
      <div className="mt-1 flex items-center gap-2">
        <Input
          id={`profit-${trade.id}`}
          inputMode="decimal"
          value={text}
          placeholder="например 30"
          onChange={(event) => {
            setText(event.target.value)
            setDirty(true)
          }}
          className="h-8 max-w-32 font-mono"
        />
        <Button variant="outline" size="sm" onClick={save} disabled={busy} className="cursor-pointer">
          {busy ? 'Сохраняю…' : saved == null ? 'Поставить' : 'Обновить'}
        </Button>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Плавающий плюс с биржи. Тейк-профит по цене сигнала остаётся.
      </p>
      {error ? <p className="mt-1 text-xs text-destructive">{error}</p> : null}
    </div>
  )
}
