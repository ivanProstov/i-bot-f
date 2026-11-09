import { useState } from 'react'
import { ArrowDownRight, ArrowUpRight, Check, Clock, ExternalLink, RefreshCw, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Progress } from '@/components/ui/progress'
import { api, fmtPrice, timeAgo, type TradeEnv } from '@/lib/api'
import type { DemoTrade, Signal, SignalCheck } from '@/types'
import TradeDialog from './TradeDialog'
import CloseDemoButton from './CloseDemoButton'
import ProfitCloseField from './ProfitCloseField'

function futuresUrl(host: string, symbol: string): string {
  return `https://${host}/ru/futures/${encodeURIComponent(symbol)}`
}

const STATUS_META = {
  active: { label: 'Активен', cls: 'border-primary/40 text-primary' },
  win: { label: 'Тейк достигнут', cls: 'border-[hsl(var(--long))]/40 text-[hsl(var(--long))]' },
  loss: { label: 'Стоп сработал', cls: 'border-[hsl(var(--short))]/40 text-[hsl(var(--short))]' },
  expired: { label: 'Истёк', cls: 'border-muted-foreground/40 text-muted-foreground' },
} as const

function StatusIcon({ status }: { status: Signal['status'] }) {
  if (status === 'win') return <Check className="h-3.5 w-3.5" />
  if (status === 'loss') return <X className="h-3.5 w-3.5" />
  return <Clock className="h-3.5 w-3.5" />
}

function restClock(ts: number): string {
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Europe/Minsk',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(ts * 1000))
}

function demoMoney(value: number): string {
  const text = Math.abs(value).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  if (value > 0) return `+${text}`
  if (value < 0) return `−${text}`
  return '0,00'
}

export default function SignalCard({
  signal: s,
  demoTrade = null,
  onUpdated,
  readOnly = false,
}: {
  signal: Signal
  demoTrade?: DemoTrade | null
  onUpdated?: () => void
  readOnly?: boolean
}) {
  const isLong = s.side === 'LONG'
  const meta = STATUS_META[s.status]
  const sideColor = isLong ? 'text-[hsl(var(--long))]' : 'text-[hsl(var(--short))]'
  // при плече 10x процент движения цены ≈ x10 на маржу (грубо, без комиссий)
  const roeTp = s.tp_pct * 10
  const roeSl = s.sl_pct * 10
  const [trade, setTrade] = useState<TradeEnv | null>(null)
  const [check, setCheck] = useState<SignalCheck | null>(s.check ?? null)
  const [busy, setBusy] = useState(false)
  const [savingOff, setSavingOff] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const turnedOff = Boolean(s.disabled)
  const resting = s.status === 'active' && s.rest_until != null && s.rest_until * 1000 > Date.now()
  const shown = check && check.checked_at === s.check?.checked_at ? s.check : check ?? s.check ?? null

  const toggleOff = async (next: boolean) => {
    setSavingOff(true)
    setError(null)
    try {
      await api.setSignalDisabled(s.id, next)
      onUpdated?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось выключить сигнал')
    } finally {
      setSavingOff(false)
    }
  }

  const refresh = async () => {
    setBusy(true)
    setError(null)
    try {
      const updated = await api.refreshSignal(s.id)
      setCheck(updated.check ?? null)
      onUpdated?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось проверить сигнал')
    } finally {
      setBusy(false)
    }
  }

  return (
    <article className="rounded-xl border border-border bg-card p-4 transition-colors hover:border-muted-foreground/30">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span
            className={`flex h-9 w-9 items-center justify-center rounded-lg ${
              isLong ? 'bg-[hsl(var(--long))]/12' : 'bg-[hsl(var(--short))]/12'
            }`}
          >
            {isLong ? (
              <ArrowUpRight className={`h-5 w-5 ${sideColor}`} />
            ) : (
              <ArrowDownRight className={`h-5 w-5 ${sideColor}`} />
            )}
          </span>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-mono font-semibold">{s.symbol}</span>
              <span className={`font-mono text-sm font-bold ${sideColor}`}>{s.side}</span>
            </div>
            <div className="text-xs text-muted-foreground">
              {s.style === 'conservative' ? 'консервативный' : 'агрессивный'} ·{' '}
              {timeAgo(s.created_at)}
            </div>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <Badge variant="outline" className={`gap-1 ${turnedOff && s.status === 'active' ? 'border-muted-foreground/40 text-muted-foreground' : meta.cls}`}>
            <StatusIcon status={s.status} />
            {turnedOff && s.status === 'active' ? 'Выключен' : meta.label}
          </Badge>
          {s.status === 'active' ? (
            <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
              <Checkbox
                checked={turnedOff}
                disabled={readOnly || savingOff}
                onCheckedChange={(value) => toggleOff(value === true)}
              />
              Выключить
            </label>
          ) : null}
          {s.result_pct != null && s.status !== 'active' ? (
            <span
              className={`font-mono text-sm font-semibold ${
                s.result_pct >= 0 ? 'text-[hsl(var(--long))]' : 'text-[hsl(var(--short))]'
              }`}
            >
              {s.result_pct > 0 ? '+' : ''}
              {s.result_pct.toFixed(2)}%
            </span>
          ) : null}
        </div>
      </div>

      {turnedOff && s.status === 'active' ? (
        <p className="mt-3 text-xs text-muted-foreground">
          Локатор этот сигнал не берёт в работу: автосделка не откроется.
          {demoTrade?.status === 'open' ? ' Уже открытая демо-сделка остаётся.' : ''}
        </p>
      ) : null}
      {resting && s.rest_until ? (
        <p className="mt-3 text-xs text-muted-foreground">
          Пара отдыхает до {restClock(s.rest_until)} Минск после закрытой сделки. Локатор не откроет
          по ней автосделку.
        </p>
      ) : null}

      {demoTrade?.status === 'open' ? (
        <div className="mt-3 rounded-lg border border-primary/50 bg-primary/10 px-3 py-2 text-xs">
          <div className="font-semibold text-foreground">Сканер открыл эту сделку на демо</div>
          <div className="mt-1 text-muted-foreground">
            {demoTrade.unrealized_pnl == null
              ? 'Жду плавающий результат с биржи.'
              : `Сейчас на бирже ${demoMoney(demoTrade.unrealized_pnl)} USDT.`}
            {demoTrade.margin_usdt ? ` Ставка ${demoMoney(demoTrade.margin_usdt)} USDT` : ''}
            {demoTrade.leverage ? `, плечо ${demoTrade.leverage}x.` : '.'}
          </div>
          {demoTrade.settle_note ? <div className="mt-1 text-foreground">{demoTrade.settle_note}</div> : null}
          <ProfitCloseField trade={demoTrade} readOnly={readOnly} onSaved={() => onUpdated?.()} />
          {readOnly ? null : (
            <CloseDemoButton
              tradeId={demoTrade.id}
              closing={Boolean(demoTrade.closing)}
              onClosed={() => onUpdated?.()}
            />
          )}
        </div>
      ) : demoTrade?.status === 'closed' ? (
        <div className="mt-3 rounded-lg border border-border bg-secondary/60 px-3 py-2 text-xs">
          <div className="font-semibold text-foreground">
            Сканер закрыл демо-сделку
            {demoTrade.net_pnl == null ? '' : `: ${demoMoney(demoTrade.net_pnl)} USDT`}
          </div>
          <div className="mt-1 text-muted-foreground">
            Цифры с биржи
            {demoTrade.gross_pnl == null ? '' : `, результат ${demoMoney(demoTrade.gross_pnl)}`}
            {demoTrade.commission == null ? '' : `, комиссия ${demoMoney(-demoTrade.commission)}`}.
          </div>
        </div>
      ) : null}

      <div className="mt-4 grid grid-cols-3 gap-2 font-mono text-sm">
        <div className="rounded-lg bg-secondary/60 px-3 py-2">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Вход</div>
          <div className="mt-0.5">{fmtPrice(s.entry)}</div>
        </div>
        <div className="rounded-lg bg-[hsl(var(--long))]/8 px-3 py-2">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Тейк</div>
          <div className="mt-0.5 text-[hsl(var(--long))]">
            {fmtPrice(s.tp)} <span className="text-xs">+{s.tp_pct}%</span>
          </div>
        </div>
        <div className="rounded-lg bg-[hsl(var(--short))]/8 px-3 py-2">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Стоп</div>
          <div className="mt-0.5 text-[hsl(var(--short))]">
            {fmtPrice(s.sl)} <span className="text-xs">−{s.sl_pct}%</span>
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="font-mono">R:R 1:{s.rr}</span>
        <span className="font-mono">RSI {s.rsi}</span>
        <span className="font-mono">ATR {s.atr_pct}%</span>
        <span className="font-mono">
          при 10x: <span className="text-[hsl(var(--long))]">+{roeTp.toFixed(0)}%</span>
          {' / '}
          <span className="text-[hsl(var(--short))]">−{roeSl.toFixed(0)}%</span> к марже
        </span>
      </div>

      <div className="mt-3">
        <div className="mb-1 flex justify-between text-xs text-muted-foreground">
          <span>Уверенность</span>
          <span className="font-mono">{s.confidence}%</span>
        </div>
        <Progress value={s.confidence} className="h-1.5" />
      </div>

      {s.reasons.length > 0 ? (
        <ul className="mt-3 space-y-1 border-t border-border pt-3">
          {s.reasons.map((r, i) => (
            <li key={i} className="flex items-start gap-1.5 text-xs text-muted-foreground">
              <Check className="mt-0.5 h-3 w-3 shrink-0 text-[hsl(var(--long))]" />
              {r}
            </li>
          ))}
        </ul>
      ) : null}

      {s.status === 'active' && !readOnly ? (
        <Button
          variant="outline"
          size="sm"
          onClick={refresh}
          disabled={busy}
          className="mt-3 w-full cursor-pointer"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${busy ? 'animate-spin' : ''}`} />
          {busy ? 'Проверяю…' : 'Обновить'}
        </Button>
      ) : null}
      {error ? <p className="mt-2 text-xs text-destructive">{error}</p> : null}
      {shown ? (
        <div
          className={`mt-3 rounded-lg border px-3 py-2 text-xs ${
            shown.verdict === 'open'
              ? 'border-[hsl(var(--long))]/40 bg-[hsl(var(--long))]/8'
              : shown.verdict === 'skip'
                ? 'border-[hsl(var(--short))]/40 bg-[hsl(var(--short))]/8'
                : 'border-border bg-secondary/60'
          }`}
        >
          <div className="font-medium text-foreground">{shown.title}</div>
          <ul className="mt-1 space-y-1 text-muted-foreground">
            {shown.reasons.map((reason, i) => (
              <li key={i}>{reason}</li>
            ))}
          </ul>
          <div className="mt-1 text-muted-foreground">проверено {timeAgo(shown.checked_at)}</div>
        </div>
      ) : null}

      {readOnly ? null : (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setTrade('demo')}
            className="cursor-pointer"
          >
            Открыть демо
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => setTrade('live')}
            className="cursor-pointer"
          >
            Открыть реал
          </Button>
        </div>
      )}
      <div className="mt-2 flex justify-between text-xs text-muted-foreground">
        <a
          href={futuresUrl('demo.binance.com', s.symbol)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 underline-offset-2 hover:underline"
        >
          <ExternalLink className="h-3 w-3" /> график на демо
        </a>
        <a
          href={futuresUrl('www.binance.com', s.symbol)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 underline-offset-2 hover:underline"
        >
          <ExternalLink className="h-3 w-3" /> график на Binance
        </a>
      </div>
      <TradeDialog signal={s} env={trade} onClose={() => setTrade(null)} />
    </article>
  )
}
