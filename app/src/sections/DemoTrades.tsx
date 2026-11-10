import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { api } from '@/lib/api'
import type { DemoBucket, DemoReport, DemoTrade } from '@/types'
import CloseDemoButton from './CloseDemoButton'
import ProfitCloseField from './ProfitCloseField'

const STATUS_LABEL = {
  open: 'Открыта',
  closed: 'Закрыта',
  skipped: 'Не открыта',
  error: 'Ошибка',
} as const

function money(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '—'
  const text = Math.abs(value).toLocaleString('ru-RU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
  if (value > 0) return `+${text}`
  if (value < 0) return `−${text}`
  return '0,00'
}

function tone(value: number | null | undefined): string {
  if (value == null || value === 0) return 'text-muted-foreground'
  return value > 0 ? 'text-[hsl(var(--long))]' : 'text-[hsl(var(--short))]'
}

function msk(ts: number | null): { clock: string; day: string } {
  if (!ts) return { clock: '—', day: '—' }
  const date = new Date(ts * 1000)
  const parts = new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Europe/Minsk',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hourCycle: 'h23',
  }).formatToParts(date)
  const pick = (type: string) => parts.find((part) => part.type === type)?.value ?? ''
  return {
    clock: `${pick('day')}.${pick('month')} ${pick('hour')}:${pick('minute')}`,
    day: pick('weekday').replace('.', ''),
  }
}

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
const PAGE_SIZE = 20

type SortField = 'opened_at' | 'weekday' | 'symbol' | 'gross_pnl' | 'commission' | 'funding' | 'net_pnl'
type SortOrder = 'asc' | 'desc'

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

function BucketGrid({
  title,
  buckets,
  bestKey,
  selectedKey,
  onPick,
  suffix,
}: {
  title: string
  buckets: DemoBucket[]
  bestKey: number | null
  selectedKey: number | null
  onPick: (key: number) => void
  suffix: (bucket: DemoBucket) => string
}) {
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold">{title}</h3>
      <div className="grid grid-cols-4 gap-2 md:grid-cols-7 xl:grid-cols-12">
        {buckets.map((bucket) => {
          const selected = bucket.key === selectedKey
          const best = bucket.key === bestKey && bucket.count > 0 && !selected
          return (
            <button
              key={bucket.key}
              type="button"
              disabled={bucket.count === 0}
              aria-pressed={selected}
              onClick={() => onPick(bucket.key)}
              className={`rounded-lg border px-2 py-2 text-left ${
                selected
                  ? 'border-primary bg-primary/10'
                  : best
                    ? 'border-primary/40 bg-card'
                    : 'border-border bg-card'
              } ${bucket.count ? 'cursor-pointer' : 'cursor-default opacity-60'}`}
            >
              <div className="text-[11px] text-muted-foreground">{suffix(bucket)}</div>
              <div className={`mt-1 font-mono text-sm ${tone(bucket.count ? bucket.net_pnl : null)}`}>
                {bucket.count ? money(bucket.net_pnl) : '—'}
              </div>
              <div className="mt-0.5 text-[11px] text-muted-foreground">
                {bucket.count ? `${bucket.wins} из ${bucket.count}` : 'нет сделок'}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  options: { value: string; label: string }[]
}) {
  return (
    <label className="grid gap-1 text-xs text-muted-foreground">
      {label}
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger size="sm" className="w-40 cursor-pointer bg-card">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  )
}

function SortHead({
  label,
  field,
  sort,
  order,
  align = 'left',
  className = '',
  onSort,
}: {
  label: string
  field: SortField
  sort: SortField
  order: SortOrder
  align?: 'left' | 'right'
  className?: string
  onSort: (field: SortField) => void
}) {
  const active = sort === field
  return (
    <TableHead className={className}>
      <button
        type="button"
        className={`inline-flex cursor-pointer items-center gap-1 hover:text-foreground ${
          align === 'right' ? 'w-full justify-end' : ''
        }`}
        onClick={() => onSort(field)}
      >
        {label}
        <span className="w-3 font-mono text-[10px]">{active ? (order === 'asc' ? '↑' : '↓') : ''}</span>
      </button>
    </TableHead>
  )
}

function ReverseMark({ trade }: { trade: DemoTrade }) {
  if (!trade.reversed) return null
  return (
    <span className="ml-2 rounded-md border border-primary/40 bg-background px-1.5 py-0.5 align-middle font-sans text-[10px] font-semibold uppercase tracking-wide text-primary">
      Реверс
    </span>
  )
}

function resultText(trade: DemoTrade): { text: string; className: string } {
  if (trade.status === 'closed') return { text: money(trade.net_pnl), className: tone(trade.net_pnl) }
  if (trade.status === 'open') {
    return {
      text: trade.unrealized_pnl == null ? 'жду биржу' : `${money(trade.unrealized_pnl)} плавает`,
      className: tone(trade.unrealized_pnl),
    }
  }
  return { text: '—', className: 'text-muted-foreground' }
}

export default function DemoTrades({
  report,
  readOnly = false,
  onChanged,
}: {
  report: DemoReport | null
  readOnly?: boolean
  onChanged?: () => void
}) {
  const [symbol, setSymbol] = useState('')
  const [symbolQuery, setSymbolQuery] = useState('')
  const [side, setSide] = useState('all')
  const [status, setStatus] = useState('all')
  const [reverse, setReverse] = useState('all')
  const [style, setStyle] = useState('all')
  const [result, setResult] = useState('all')
  const [weekday, setWeekday] = useState<number | null>(null)
  const [hour, setHour] = useState<number | null>(null)
  const [sort, setSort] = useState<SortField>('opened_at')
  const [order, setOrder] = useState<SortOrder>('desc')
  const [page, setPage] = useState(1)
  const [rows, setRows] = useState<DemoTrade[]>([])
  const [total, setTotal] = useState(0)
  const [pages, setPages] = useState(0)
  const [pageError, setPageError] = useState<string | null>(null)
  const request = useRef(0)

  useEffect(() => {
    const next = symbol.trim()
    const timer = setTimeout(() => setSymbolQuery(next), 300)
    return () => clearTimeout(timer)
  }, [symbol])

  const filterKey = [
    symbolQuery, side, status, reverse, style, result,
    weekday ?? '', hour ?? '', sort, order,
  ].join('|')
  const [appliedFilter, setAppliedFilter] = useState(filterKey)
  if (appliedFilter !== filterKey) {
    setAppliedFilter(filterKey)
    if (page !== 1) setPage(1)
  }

  useEffect(() => {
    let stop = false
    const load = async () => {
      const ticket = ++request.current
      try {
        const data = await api.demoTradePage({
          page,
          symbol: symbolQuery,
          side: side === 'all' ? '' : side,
          status: status === 'all' ? '' : status,
          reverse: reverse === 'all' ? '' : reverse,
          style: style === 'all' ? '' : style,
          result: result === 'all' ? '' : result,
          weekday,
          hour,
          sort,
          order,
        })
        if (stop || ticket !== request.current) return
        setRows(data.trades)
        setTotal(data.total)
        setPages(data.pages)
        setPageError(null)
        if (data.pages > 0 && data.page !== page) setPage(data.page)
      } catch (error) {
        if (stop || ticket !== request.current) return
        setPageError(error instanceof Error ? error.message : 'Не удалось загрузить страницу')
      }
    }
    load()
    const timer = setInterval(load, 5000)
    return () => {
      stop = true
      clearInterval(timer)
    }
  }, [page, symbolQuery, side, status, reverse, style, result, weekday, hour, sort, order])

  const pickSort = (field: SortField) => {
    if (sort === field) setOrder((current) => (current === 'desc' ? 'asc' : 'desc'))
    else {
      setSort(field)
      setOrder(field === 'symbol' || field === 'weekday' ? 'asc' : 'desc')
    }
  }

  const pickWeekday = (key: number) => setWeekday((current) => (current === key ? null : key))
  const pickHour = (key: number) => setHour((current) => (current === key ? null : key))

  const narrowed = Boolean(
    symbolQuery || side !== 'all' || status !== 'all' || reverse !== 'all'
    || style !== 'all' || result !== 'all' || weekday != null || hour != null,
  )
  const filtered = narrowed || sort !== 'opened_at' || order !== 'desc'

  const reset = () => {
    setSymbol('')
    setSymbolQuery('')
    setSide('all')
    setStatus('all')
    setReverse('all')
    setStyle('all')
    setResult('all')
    setWeekday(null)
    setHour(null)
    setSort('opened_at')
    setOrder('desc')
    setPage(1)
  }

  if (!report) {
    return (
      <section className="rounded-xl border border-dashed border-border py-14 text-center text-muted-foreground">
        Жду ответ бота по демо-сделкам.
      </section>
    )
  }

  const openTrades = report.trades.filter((trade) => trade.status === 'open')
  const bestHour = report.best_hour && report.best_hour.count > 0 ? report.best_hour : null
  const bestDay = report.best_weekday && report.best_weekday.count > 0 ? report.best_weekday : null
  const current = pages === 0 ? 1 : Math.min(page, pages)

  return (
    <section className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Демо-сделки</h2>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Время — минское, по моменту открытия на бирже. В плюс и минус попадают только
          закрытые сделки, и только на суммы из проводок счёта: результат, комиссия и фандинг.
          Сводка сверху — по всем закрытым. Таблица ниже запрашивает одну страницу и слушает фильтры.
        </p>
      </div>

      {report.error ? (
        <p className="rounded-xl border border-primary/40 bg-primary/8 px-4 py-3 text-sm text-muted-foreground">
          {report.error}
        </p>
      ) : null}

      <div className="grid gap-3 md:grid-cols-4">
        <div className="rounded-xl border border-border bg-card px-4 py-3">
          <div className="text-xs text-muted-foreground">Закрыто</div>
          <div className="mt-1 font-mono text-lg">{report.closed}</div>
        </div>
        <div className="rounded-xl border border-border bg-card px-4 py-3">
          <div className="text-xs text-muted-foreground">Сейчас открыто</div>
          <div className="mt-1 font-mono text-lg">{report.open}</div>
        </div>
        <div className="rounded-xl border border-border bg-card px-4 py-3">
          <div className="text-xs text-muted-foreground">Итог биржи</div>
          <div className={`mt-1 font-mono text-lg ${tone(report.net_pnl)}`}>{money(report.net_pnl)} USDT</div>
        </div>
        <div className="rounded-xl border border-border bg-card px-4 py-3">
          <div className="text-xs text-muted-foreground">Комиссия биржи</div>
          <div className={`mt-1 font-mono text-lg ${tone(-report.commission)}`}>
            {money(-report.commission)} USDT
          </div>
        </div>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold">Открыты сканером</h3>
        {openTrades.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
            Сканер сейчас не держит демо-сделок. Открытая им сделка появится здесь и на карточке
            сигнала.
          </p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {openTrades.map((trade) => (
              <article key={trade.id} className="rounded-xl border border-primary/50 bg-primary/10 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-mono font-semibold">
                      {trade.symbol}{' '}
                      <span className={trade.side === 'LONG' ? 'text-[hsl(var(--long))]' : 'text-[hsl(var(--short))]'}>
                        {trade.side}
                      </span>
                      <ReverseMark trade={trade} />
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      Сканер открыл эту сделку на демо{trade.reversed ? ' реверсом' : ''}
                      {trade.margin_usdt != null ? `. Ставка ${money(trade.margin_usdt)} USDT` : ''}
                      {trade.leverage ? `, плечо ${trade.leverage}x` : ''}
                    </div>
                  </div>
                  <div className={`font-mono text-sm font-semibold ${tone(trade.unrealized_pnl)}`}>
                    {trade.unrealized_pnl == null ? 'жду биржу' : `${money(trade.unrealized_pnl)} USDT`}
                  </div>
                </div>
                {trade.settle_note ? <p className="mt-2 text-xs text-foreground">{trade.settle_note}</p> : (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Срок сигнала ещё идёт. Плюс или минус на бирже решит, закрывать ли её после срока.
                  </p>
                )}
                {trade.exit_target != null ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Порог выхода {money(trade.exit_target)} USDT: 1% ставки и комиссия биржи.
                  </p>
                ) : null}
                <ProfitCloseField trade={trade} readOnly={readOnly} onSaved={() => onChanged?.()} />
                {readOnly ? null : (
                  <CloseDemoButton
                    tradeId={trade.id}
                    closing={Boolean(trade.closing)}
                    onClosed={() => onChanged?.()}
                  />
                )}
              </article>
            ))}
          </div>
        )}
      </div>

      {report.closed > 0 ? (
        <p className="text-sm">
          {bestDay ? (
            <>
              Лучший день: <span className="font-semibold">{bestDay.label}</span>,{' '}
              <span className={tone(bestDay.net_pnl)}>{money(bestDay.net_pnl)} USDT</span> за{' '}
              {bestDay.count} сделок ({bestDay.wins} в плюс).{' '}
            </>
          ) : null}
          {bestHour ? (
            <>
              Лучший час: <span className="font-semibold">{bestHour.label}:00–{bestHour.label}:59 Минск</span>,{' '}
              <span className={tone(bestHour.net_pnl)}>{money(bestHour.net_pnl)} USDT</span> за{' '}
              {bestHour.count} сделок ({bestHour.wins} в плюс).
            </>
          ) : null}
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">
          Закрытых демо-сделок ещё нет. Включи автоторговлю в настройках: бот откроет каждый новый
          активный сигнал один раз и допишет сюда результат, когда биржа проведёт закрытие.
        </p>
      )}

      <BucketGrid
        title="День недели, итог в USDT. Нажатие фильтрует таблицу"
        buckets={report.weekdays}
        bestKey={bestDay?.key ?? null}
        selectedKey={weekday}
        onPick={pickWeekday}
        suffix={(bucket) => bucket.label}
      />
      <BucketGrid
        title="Час открытия, Минск. Нажатие фильтрует таблицу"
        buckets={report.hours}
        bestKey={bestHour?.key ?? null}
        selectedKey={hour}
        onPick={pickHour}
        suffix={(bucket) => `${bucket.label}:00`}
      />

      <div className="flex flex-wrap items-end gap-2">
        <label className="grid gap-1 text-xs text-muted-foreground">
          Пара
          <Input
            value={symbol}
            onChange={(event) => setSymbol(event.target.value)}
            placeholder="PEPE, BTC"
            className="h-8 w-40 bg-card"
          />
        </label>
        <FilterSelect
          label="Сторона"
          value={side}
          onChange={setSide}
          options={[
            { value: 'all', label: 'Все' },
            { value: 'LONG', label: 'LONG' },
            { value: 'SHORT', label: 'SHORT' },
          ]}
        />
        <FilterSelect
          label="Реверс"
          value={reverse}
          onChange={setReverse}
          options={[
            { value: 'all', label: 'Все' },
            { value: 'yes', label: 'Только реверс' },
            { value: 'no', label: 'Без реверса' },
          ]}
        />
        <FilterSelect
          label="Статус"
          value={status}
          onChange={setStatus}
          options={[
            { value: 'all', label: 'Все' },
            { value: 'open', label: 'Открыта' },
            { value: 'closed', label: 'Закрыта' },
            { value: 'skipped', label: 'Не открыта' },
            { value: 'error', label: 'Ошибка' },
          ]}
        />
        <FilterSelect
          label="Стиль"
          value={style}
          onChange={setStyle}
          options={[
            { value: 'all', label: 'Все' },
            { value: 'conservative', label: 'Консервативный' },
            { value: 'aggressive', label: 'Агрессивный' },
          ]}
        />
        <FilterSelect
          label="Итог"
          value={result}
          onChange={setResult}
          options={[
            { value: 'all', label: 'Все' },
            { value: 'plus', label: 'Плюс' },
            { value: 'minus', label: 'Минус' },
            { value: 'flat', label: 'Ноль' },
          ]}
        />
        <FilterSelect
          label="День"
          value={weekday == null ? 'all' : String(weekday)}
          onChange={(value) => setWeekday(value === 'all' ? null : Number(value))}
          options={[
            { value: 'all', label: 'Все' },
            ...WEEKDAYS.map((label, index) => ({ value: String(index), label })),
          ]}
        />
        <FilterSelect
          label="Час, Минск"
          value={hour == null ? 'all' : String(hour)}
          onChange={(value) => setHour(value === 'all' ? null : Number(value))}
          options={[
            { value: 'all', label: 'Все' },
            ...Array.from({ length: 24 }, (_, index) => ({
              value: String(index),
              label: `${String(index).padStart(2, '0')}:00`,
            })),
          ]}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="cursor-pointer"
          disabled={!filtered}
          onClick={reset}
        >
          Сбросить
        </Button>
      </div>

      {pageError ? (
        <p className="text-sm text-destructive">{pageError}</p>
      ) : null}

      <div className="overflow-hidden rounded-xl border border-border">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <SortHead label="Открытие, Минск" field="opened_at" sort={sort} order={order} onSort={pickSort} />
              <SortHead label="День" field="weekday" sort={sort} order={order} onSort={pickSort} />
              <SortHead label="Пара" field="symbol" sort={sort} order={order} onSort={pickSort} />
              <SortHead label="Результат" field="gross_pnl" sort={sort} order={order} align="right" className="text-right" onSort={pickSort} />
              <SortHead label="Комиссия" field="commission" sort={sort} order={order} align="right" className="text-right" onSort={pickSort} />
              <SortHead label="Фандинг" field="funding" sort={sort} order={order} align="right" className="hidden text-right md:table-cell" onSort={pickSort} />
              <SortHead label="Итог" field="net_pnl" sort={sort} order={order} align="right" className="text-right" onSort={pickSort} />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                  {pageError ? 'Страница не загрузилась.' : narrowed ? 'По этому фильтру сделок нет.' : 'Сделок пока нет.'}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((trade) => {
                const when = msk(trade.opened_at ?? trade.created_at)
                const rowResult = resultText(trade)
                const note = trade.warning || trade.error || trade.skip_reason || trade.settle_note
                return (
                  <TableRow key={trade.id} className="font-mono text-sm">
                    <TableCell>{when.clock}</TableCell>
                    <TableCell className="uppercase">{when.day}</TableCell>
                    <TableCell>
                      <div className="font-semibold">
                        {trade.symbol}{' '}
                        <span className={trade.side === 'LONG' ? 'text-[hsl(var(--long))]' : 'text-[hsl(var(--short))]'}>
                          {trade.side}
                        </span>
                        <ReverseMark trade={trade} />
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {STATUS_LABEL[trade.status]}
                        {trade.reversed ? ' · реверс' : ''}
                        {trade.entry_price ? ` · вход ${trade.entry_price}` : ''}
                        {trade.leverage ? ` · ${trade.leverage}x` : ''}
                      </div>
                      {note ? <div className="mt-1 max-w-xs text-xs text-muted-foreground">{note}</div> : null}
                    </TableCell>
                    <TableCell className={`text-right ${tone(trade.gross_pnl)}`}>
                      {trade.status === 'closed' ? money(trade.gross_pnl) : '—'}
                    </TableCell>
                    <TableCell className={`text-right ${tone(trade.commission == null && trade.open_commission == null ? null : -((trade.commission ?? trade.open_commission) || 0))}`}>
                      {trade.status === 'closed'
                        ? money(trade.commission == null ? null : -trade.commission)
                        : trade.open_commission
                          ? money(-trade.open_commission)
                          : '—'}
                    </TableCell>
                    <TableCell className={`hidden text-right md:table-cell ${tone(trade.funding)}`}>
                      {trade.status === 'closed' ? money(trade.funding) : '—'}
                    </TableCell>
                    <TableCell className={`text-right ${rowResult.className}`}>{rowResult.text}</TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>

      {total > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            {(current - 1) * PAGE_SIZE + 1}–{Math.min(current * PAGE_SIZE, total)} из {total}
          </p>
          <nav aria-label="Страницы демо-сделок" className="flex items-center gap-1">
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
                <span key={`gap-${index}`} className="px-1 text-muted-foreground">…</span>
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
              disabled={pages === 0 || current >= pages}
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
