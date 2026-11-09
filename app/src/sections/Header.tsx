import { Activity, LogOut, Pause, Play, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { timeAgo } from '@/lib/api'
import type { Status } from '@/types'

interface Props {
  status: Status | null
  backendDown: boolean
  readOnly: boolean
  onToggle: () => void
  onScanNow: () => void
  onLogout: () => void
}

export default function Header({ status, backendDown, readOnly, onToggle, onScanNow, onLogout }: Props) {
  const running = status?.running ?? false
  const stats = status?.stats

  return (
    <header className="flex flex-col gap-4 border-b border-border pb-5 md:flex-row md:items-center md:justify-between">
      <div>
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/15">
            <Activity className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-bold leading-tight">Futures Signal Bot</h1>
            <p className="text-sm text-muted-foreground">
              Binance USDT-M ·{' '}
              {status?.auto?.enabled
                ? 'автоторговля на демо включена'
                : 'автоторговля выключена, сделки только по кнопке'}
            </p>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="flex items-center gap-2 text-sm">
          <span
            className={`h-2.5 w-2.5 rounded-full ${
              backendDown
                ? 'bg-destructive'
                : running
                  ? 'bg-[hsl(var(--long))] dot-live'
                  : 'bg-muted-foreground'
            }`}
          />
          <span className="text-muted-foreground">
            {backendDown
              ? 'бэкенд недоступен'
              : status?.scanning
                ? 'сканирую рынок…'
                : running
                  ? `мониторинг · ${status?.pairs_count ?? 0} пар`
                  : 'на паузе'}
          </span>
          {status?.last_scan ? (
            <span className="hidden text-xs text-muted-foreground/70 md:inline">
              · скан {timeAgo(status.last_scan)}
            </span>
          ) : null}
        </div>

        {stats ? (
          <div className="flex flex-col items-start gap-0.5 font-mono text-sm md:items-end">
            <div className="flex items-center gap-3">
              <span className="text-muted-foreground">
                активные <span className="text-foreground">{stats.active}</span>
              </span>
              <span className="text-[hsl(var(--long))]">WIN {stats.win}</span>
              <span className="text-[hsl(var(--short))]">LOSS {stats.loss}</span>
            </div>
            {typeof stats.result_usdt === 'number' ? (
              <span className={stats.result_usdt >= 0 ? 'text-[hsl(var(--long))]' : 'text-[hsl(var(--short))]'}>
                ≈ {stats.result_usdt > 0 ? '+' : ''}
                {stats.result_usdt.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDT
                <span className="text-muted-foreground"> · по {stats.stake_usdt} USDT на сигнал, без плеча</span>
              </span>
            ) : null}
          </div>
        ) : null}

        <div className="flex items-center gap-2">
          {readOnly ? (
            <span className="rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground">
              Только просмотр
            </span>
          ) : (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={onScanNow}
                disabled={backendDown || !running || status?.scanning}
                className="cursor-pointer"
              >
                <RefreshCw className={`mr-1.5 h-4 w-4 ${status?.scanning ? 'animate-spin' : ''}`} />
                Сканировать
              </Button>
              <Button
                size="sm"
                variant={running ? 'secondary' : 'default'}
                onClick={onToggle}
                disabled={backendDown}
                className="cursor-pointer"
              >
                {running ? (
                  <>
                    <Pause className="mr-1.5 h-4 w-4" /> Пауза
                  </>
                ) : (
                  <>
                    <Play className="mr-1.5 h-4 w-4" /> Запустить
                  </>
                )}
              </Button>
            </>
          )}
          <Button variant="ghost" size="sm" onClick={onLogout} className="cursor-pointer">
            <LogOut className="mr-1.5 h-4 w-4" /> Выйти
          </Button>
        </div>
      </div>
    </header>
  )
}
