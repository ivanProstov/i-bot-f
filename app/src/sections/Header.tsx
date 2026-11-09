import { LogOut, Pause, Play, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { timeAgo } from '@/lib/api'
import type { Status } from '@/types'
import Swarm from './Swarm'

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
    <header className="border-b border-border pb-6">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
      <div>
        <p className="text-[11px] uppercase tracking-[0.28em] text-muted-foreground">Локатор</p>
        <h1 className="mt-1 text-[1.65rem] font-semibold leading-none">Futures Signal Bot</h1>
        <p className="mt-2 max-w-md text-sm text-muted-foreground">
          Binance USDT-M ·{' '}
          {status?.auto?.enabled
            ? 'автоторговля на демо включена'
            : 'автоторговля выключена, сделки только по кнопке'}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 lg:justify-end">
        <div className="text-sm text-muted-foreground">
          {backendDown
            ? 'бэкенд недоступен'
            : running
              ? `${status?.pairs_count ?? 0} пар в работе`
              : 'сканер на паузе'}
          {status?.last_scan ? (
            <span className="mt-0.5 block font-mono text-[11px] text-muted-foreground/80">
              скан {timeAgo(status.last_scan)}
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
      </div>
      <Swarm
        className="mt-5 h-40"
        running={!backendDown && (status?.running ?? true)}
        scanning={Boolean(status?.scanning)}
        offline={backendDown}
      />
    </header>
  )
}
