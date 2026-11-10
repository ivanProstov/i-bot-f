import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
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

function BucketGrid({
  title,
  buckets,
  bestKey,
  suffix,
}: {
  title: string
  buckets: DemoBucket[]
  bestKey: number | null
  suffix: (bucket: DemoBucket) => string
}) {
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold">{title}</h3>
      <div className="grid grid-cols-4 gap-2 md:grid-cols-7 xl:grid-cols-12">
        {buckets.map((bucket) => {
          const best = bucket.key === bestKey && bucket.count > 0
          return (
            <div
              key={bucket.key}
              className={`rounded-lg border px-2 py-2 ${
                best ? 'border-primary bg-primary/10' : 'border-border bg-card'
              }`}
            >
              <div className="text-[11px] text-muted-foreground">{suffix(bucket)}</div>
              <div className={`mt-1 font-mono text-sm ${tone(bucket.count ? bucket.net_pnl : null)}`}>
                {bucket.count ? money(bucket.net_pnl) : '—'}
              </div>
              <div className="mt-0.5 text-[11px] text-muted-foreground">
                {bucket.count ? `${bucket.wins} из ${bucket.count}` : 'нет сделок'}
              </div>
            </div>
          )
        })}
      </div>
    </div>
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
  if (!report) {
    return (
      <section className="rounded-xl border border-dashed border-border py-14 text-center text-muted-foreground">
        Жду ответ бота по демо-сделкам.
      </section>
    )
  }

  const closedTrades = report.trades.filter((trade) => trade.status === 'closed')
  const openTrades = report.trades.filter((trade) => trade.status === 'open')
  const bestHour = report.best_hour && report.best_hour.count > 0 ? report.best_hour : null
  const bestDay = report.best_weekday && report.best_weekday.count > 0 ? report.best_weekday : null

  return (
    <section className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Демо-сделки</h2>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Время — минское, по моменту открытия на бирже. В плюс и минус попадают только
          закрытые сделки, и только на суммы из проводок счёта: результат, комиссия и фандинг.
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

      {closedTrades.length > 0 ? (
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
        title="День недели, итог в USDT"
        buckets={report.weekdays}
        bestKey={bestDay?.key ?? null}
        suffix={(bucket) => bucket.label}
      />
      <BucketGrid
        title="Час открытия, Минск"
        buckets={report.hours}
        bestKey={bestHour?.key ?? null}
        suffix={(bucket) => `${bucket.label}:00`}
      />

      <div className="overflow-hidden rounded-xl border border-border">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Открытие, Минск</TableHead>
              <TableHead>День</TableHead>
              <TableHead>Пара</TableHead>
              <TableHead className="text-right">Результат</TableHead>
              <TableHead className="text-right">Комиссия</TableHead>
              <TableHead className="hidden text-right md:table-cell">Фандинг</TableHead>
              <TableHead className="text-right">Итог</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {report.trades.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                  Сделок пока нет.
                </TableCell>
              </TableRow>
            ) : (
              report.trades.map((trade) => {
                const when = msk(trade.opened_at ?? trade.created_at)
                const result = resultText(trade)
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
                    <TableCell className={`text-right ${result.className}`}>{result.text}</TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>
    </section>
  )
}
