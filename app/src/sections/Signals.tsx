import { useMemo, useState } from 'react'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import SignalCard from './SignalCard'
import type { Signal } from '@/types'

type Filter = 'active' | 'all' | 'closed'

export default function Signals({
  signals,
  onUpdated,
}: {
  signals: Signal[]
  onUpdated?: () => void
}) {
  const [filter, setFilter] = useState<Filter>('active')

  const filtered = useMemo(() => {
    if (filter === 'active') return signals.filter((s) => s.status === 'active')
    if (filter === 'closed') return signals.filter((s) => s.status !== 'active')
    return signals
  }, [signals, filter])

  return (
    <section>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Сигналы</h2>
        <ToggleGroup
          type="single"
          value={filter}
          onValueChange={(v) => v && setFilter(v as Filter)}
          variant="outline"
          size="sm"
        >
          <ToggleGroupItem value="active" className="cursor-pointer">Активные</ToggleGroupItem>
          <ToggleGroupItem value="closed" className="cursor-pointer">История</ToggleGroupItem>
          <ToggleGroupItem value="all" className="cursor-pointer">Все</ToggleGroupItem>
        </ToggleGroup>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border py-14 text-center">
          <p className="text-muted-foreground">
            {filter === 'active'
              ? 'Активных сигналов пока нет — бот ждёт подходящей ситуации на рынке.'
              : filter === 'closed'
                ? 'Закрытых сигналов пока нет. WIN и LOSS остаются здесь после перезапуска.'
                : 'Здесь появятся сигналы.'}
          </p>
          <p className="mt-1 text-sm text-muted-foreground/70">
            Сигнал появляется только когда совпадают все условия стратегии.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((s) => (
            <SignalCard key={s.id} signal={s} onUpdated={onUpdated} />
          ))}
        </div>
      )}
    </section>
  )
}
