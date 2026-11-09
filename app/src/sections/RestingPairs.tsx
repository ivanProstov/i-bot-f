import type { RestingPair } from '@/types'

function clock(ts: number): string {
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Europe/Minsk',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(ts * 1000))
}

function left(until: number): string {
  const minutes = Math.ceil(Math.max(0, until - Date.now() / 1000) / 60)
  if (minutes <= 1) return 'меньше минуты'
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (hours <= 0) return `${rest} мин`
  if (rest === 0) return `${hours} ч`
  return `${hours} ч ${rest} мин`
}

export default function RestingPairs({ pairs }: { pairs: RestingPair[] }) {
  return (
    <div className="mb-4 rounded-xl border border-border bg-card px-4 py-3">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">Сейчас отдыхают</div>
      {pairs.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">Ни одна пара не отдыхает.</p>
      ) : (
        <ul className="mt-2 flex flex-wrap gap-2">
          {pairs.map((pair) => (
            <li key={pair.symbol} className="rounded-lg bg-secondary/70 px-3 py-1.5 text-sm">
              <span className="font-mono font-semibold">{pair.symbol}</span>
              <span className="ml-2 text-muted-foreground">
                ещё {left(pair.until)}, до {clock(pair.until)} Минск
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
