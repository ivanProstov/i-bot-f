import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { api } from '@/lib/api'
import RestingPairs from './RestingPairs'
import SignalCard from './SignalCard'
import type { DemoTrade, RestingPair, Signal } from '@/types'

type Filter = 'active' | 'closed'

const HISTORY_PAGE = 12

function pageWindow(current: number, count: number): Array<number | 'gap'> {
  if (count <= 7) return Array.from({ length: count }, (_, index) => index + 1)
  const wanted = [1, count, current - 1, current, current + 1].filter(
    (page) => page >= 1 && page <= count,
  )
  const pages = [...new Set(wanted)].sort((a, b) => a - b)
  const window: Array<number | 'gap'> = []
  for (const page of pages) {
    const prev = window[window.length - 1]
    if (typeof prev === 'number' && page - prev > 1) window.push('gap')
    window.push(page)
  }
  return window
}

export default function Signals({
  signals,
  resting = [],
  demoTrades = [],
  onUpdated,
  readOnly = false,
}: {
  signals: Signal[]
  resting?: RestingPair[]
  demoTrades?: DemoTrade[]
  onUpdated?: () => void
  readOnly?: boolean
}) {
  const [filter, setFilter] = useState<Filter>('active')
  const [page, setPage] = useState(1)
  const [history, setHistory] = useState<Signal[]>([])
  const [total, setTotal] = useState(0)
  const [pages, setPages] = useState(0)
  const [historyError, setHistoryError] = useState<string | null>(null)
  const request = useRef(0)

  useEffect(() => {
    if (filter !== 'closed') return
    let stop = false
    const load = async () => {
      const ticket = ++request.current
      try {
        const data = await api.signalHistory(page)
        if (stop || ticket !== request.current) return
        setHistory(data.signals)
        setTotal(data.total)
        setPages(data.pages)
        setHistoryError(null)
        if (data.pages > 0 && data.page !== page) setPage(data.page)
      } catch (error) {
        if (stop || ticket !== request.current) return
        setHistoryError(error instanceof Error ? error.message : 'Не удалось загрузить историю')
      }
    }
    load()
    const timer = setInterval(load, 5000)
    return () => {
      stop = true
      clearInterval(timer)
    }
  }, [filter, page])

  const active = signals.filter((signal) => signal.status === 'active')
  const shown = filter === 'closed' ? history : active
  const current = pages === 0 ? 1 : Math.min(page, pages)

  const choose = (next: Filter) => {
    setFilter(next)
    setPage(1)
  }

  const tradeFor = (signal: Signal) =>
    demoTrades.find((trade) => trade.signal_id === signal.id && trade.status === 'open') ??
    demoTrades.find((trade) => trade.signal_id === signal.id && trade.status === 'closed') ??
    null

  return (
    <section>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Сигналы</h2>
        <ToggleGroup
          type="single"
          value={filter}
          onValueChange={(value) => value && choose(value as Filter)}
          variant="outline"
          size="sm"
        >
          <ToggleGroupItem value="active" className="cursor-pointer">Активные</ToggleGroupItem>
          <ToggleGroupItem value="closed" className="cursor-pointer">История</ToggleGroupItem>
        </ToggleGroup>
      </div>

      <RestingPairs pairs={resting} />

      {shown.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border py-14 text-center">
          <p className="text-muted-foreground">
            {historyError
              ? historyError
              : filter === 'active'
                ? 'Активных сигналов пока нет — бот ждёт подходящей ситуации на рынке.'
                : 'Закрытых сигналов пока нет. WIN и LOSS остаются здесь после перезапуска.'}
          </p>
          {historyError ? null : (
            <p className="mt-1 text-sm text-muted-foreground/70">
              Сигнал появляется только когда совпадают все условия стратегии.
            </p>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {shown.map((signal) => (
            <SignalCard
              key={signal.id}
              signal={signal}
              onUpdated={onUpdated}
              readOnly={readOnly}
              demoTrade={tradeFor(signal)}
            />
          ))}
        </div>
      )}

      {filter === 'closed' && total > 0 ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            {(current - 1) * HISTORY_PAGE + 1}–{Math.min(current * HISTORY_PAGE, total)} из {total}
          </p>
          <nav aria-label="Страницы истории" className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              className="cursor-pointer"
              disabled={current <= 1}
              onClick={() => setPage(current - 1)}
            >
              <ChevronLeft className="h-4 w-4" />
              Назад
            </Button>
            {pageWindow(current, pages).map((item, index) =>
              item === 'gap' ? (
                <span key={`gap-${index}`} className="px-1 text-muted-foreground">
                  …
                </span>
              ) : (
                <Button
                  key={item}
                  variant={item === current ? 'default' : 'outline'}
                  size="sm"
                  className="min-w-9 cursor-pointer"
                  onClick={() => setPage(item)}
                >
                  {item}
                </Button>
              ),
            )}
            <Button
              variant="outline"
              size="sm"
              className="cursor-pointer"
              disabled={current >= pages}
              onClick={() => setPage(current + 1)}
            >
              Дальше
              <ChevronRight className="h-4 w-4" />
            </Button>
          </nav>
        </div>
      ) : null}
    </section>
  )
}
