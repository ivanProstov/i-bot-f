import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { api, fmtPrice, type TradeEnv, type TradeResult } from '@/lib/api'
import type { Signal } from '@/types'

export default function TradeDialog({
  signal,
  env,
  onClose,
}: {
  signal: Signal
  env: TradeEnv | null
  onClose: () => void
}) {
  const live = env === 'live'
  const [notional, setNotional] = useState('20')
  const [leverage, setLeverage] = useState('5')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<TradeResult | null>(null)

  function resetAndClose() {
    setError(null)
    setResult(null)
    setBusy(false)
    onClose()
  }

  async function submit() {
    if (!env) return
    setBusy(true)
    setError(null)
    try {
      const next = await api.openTrade({
        env,
        symbol: signal.symbol,
        side: signal.side,
        notional_usdt: Number(notional),
        leverage: Number(leverage),
        tp: signal.tp,
        sl: signal.sl,
      })
      setResult(next)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось открыть сделку')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={env !== null} onOpenChange={(open) => !open && resetAndClose()}>
      <DialogContent className={live ? 'border-destructive' : undefined}>
        <DialogHeader>
          <DialogTitle>{live ? 'Реальная сделка' : 'Демо-сделка'}</DialogTitle>
          <DialogDescription>
            {live
              ? 'Ордер уйдёт на реальный фьючерсный счёт Binance. Это живые деньги.'
              : 'Ордер уйдёт на демо-счёт demo.binance.com. Реальный баланс не затрагивается.'}
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3 font-mono text-sm">
          <div>
            <div className="text-xs text-muted-foreground">Пара</div>
            {signal.symbol} {signal.side}
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Тип</div>
            рыночный
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Тейк</div>
            {fmtPrice(signal.tp)}
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Стоп</div>
            {fmtPrice(signal.sl)}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="mb-1.5 block">Сумма, USDT</Label>
            <Input
              type="number"
              min="1"
              step="1"
              value={notional}
              onChange={(e) => setNotional(e.target.value)}
              className="font-mono"
            />
          </div>
          <div>
            <Label className="mb-1.5 block">Плечо</Label>
            <Input
              type="number"
              min="1"
              max="125"
              step="1"
              value={leverage}
              onChange={(e) => setLeverage(e.target.value)}
              className="font-mono"
            />
          </div>
        </div>

        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        {result ? (
          <div className="space-y-1 text-sm">
            <p className="text-[hsl(var(--long))]">
              {live ? 'Реальная' : 'Демо'} позиция открыта, объём {result.quantity}.
              {result.order_id ? ` Ордер ${result.order_id}.` : ''}
              {result.tp_order_id && result.sl_order_id
                ? ' Тейк и стоп поставлены.'
                : ''}
            </p>
            {result.warning ? <p className="text-destructive">{result.warning}</p> : null}
          </div>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={resetAndClose} className="cursor-pointer">
            Закрыть
          </Button>
          <Button
            variant={live ? 'destructive' : 'default'}
            onClick={() => void submit()}
            disabled={busy || !!result}
            className="cursor-pointer"
          >
            {busy ? 'Открываю…' : live ? 'Открыть на реальном счёте' : 'Открыть на демо'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
