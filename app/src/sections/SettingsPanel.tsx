import { useEffect, useState } from 'react'
import { Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { api } from '@/lib/api'
import type { Settings } from '@/types'
import ApiKeys from './ApiKeys'

const STYLES = [
  {
    id: 'conservative',
    name: 'Консервативный',
    desc: 'Вход по тренду после отката. Меньше сигналов, выше надёжность. Рекомендуется новичкам.',
  },
  {
    id: 'aggressive',
    name: 'Агрессивный',
    desc: 'Скальпинг на разворотах и пересечениях. Больше сигналов, короче сделки, выше шум.',
  },
  {
    id: 'mixed',
    name: 'Смешанный',
    desc: 'Обе стратегии одновременно — у каждого сигнала указан его стиль.',
  },
] as const

export default function SettingsPanel({
  settings,
  onSaved,
}: {
  settings: Settings
  onSaved: (s: Settings) => void
}) {
  const [draft, setDraft] = useState<Settings>(settings)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const settingsKey = JSON.stringify(settings)
  useEffect(() => {
    setDraft(JSON.parse(settingsKey) as Settings)
  }, [settingsKey])

  const dirty = JSON.stringify(draft) !== JSON.stringify(settings)

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const next = await api.putSettings(draft)
      onSaved(next)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch {
      setError('Не удалось сохранить. Проверьте, что бот запущен.')
    } finally {
      setSaving(false)
    }
  }

  const setStyleCfg = (
    style: 'conservative' | 'aggressive',
    key: 'tp_atr' | 'sl_atr' | 'min_rr',
    v: number,
  ) => setDraft({ ...draft, [style]: { ...draft[style], [key]: v } })

  return (
    <section className="max-w-3xl">
      <h2 className="mb-4 text-lg font-semibold">Настройки</h2>

      <div className="space-y-6">
        <div>
          <Label className="mb-2 block">Стиль торговли</Label>
          <div className="grid gap-3 md:grid-cols-3">
            {STYLES.map((s) => {
              const active = draft.style === s.id
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setDraft({ ...draft, style: s.id })}
                  className={`cursor-pointer rounded-xl border p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                    active
                      ? 'border-primary bg-primary/8'
                      : 'border-border bg-card hover:border-muted-foreground/40'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold">{s.name}</span>
                    {active ? <Check className="h-4 w-4 text-primary" /> : null}
                  </div>
                  <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{s.desc}</p>
                </button>
              )
            })}
          </div>
        </div>

        <div className="grid gap-6 rounded-xl border border-border bg-card p-5 md:grid-cols-2">
          <div>
            <div className="mb-2 flex justify-between">
              <Label>Сколько пар мониторить</Label>
              <span className="font-mono text-sm text-muted-foreground">{draft.top_n}</span>
            </div>
            <Slider
              min={5}
              max={60}
              step={5}
              value={[Math.min(60, Math.max(5, draft.top_n))]}
              onValueChange={([v]) => setDraft({ ...draft, top_n: v })}
            />
            <p className="mt-2 text-xs text-muted-foreground">
              Только самые объёмные USDT-бессрочные, не весь список биржи.
            </p>
          </div>
          <div>
            <div className="mb-2 flex justify-between">
              <Label>Интервал сканирования</Label>
              <span className="font-mono text-sm text-muted-foreground">{draft.scan_interval} с</span>
            </div>
            <Slider
              min={15}
              max={300}
              step={15}
              value={[draft.scan_interval]}
              onValueChange={([v]) => setDraft({ ...draft, scan_interval: v })}
            />
          </div>
          <div>
            <Label className="mb-2 block">Таймфрейм свечей</Label>
            <Select
              value={draft.timeframe}
              onValueChange={(v) => setDraft({ ...draft, timeframe: v })}
            >
              <SelectTrigger className="w-full cursor-pointer">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {['5m', '15m', '1h', '4h'].map((tf) => (
                  <SelectItem key={tf} value={tf} className="cursor-pointer">
                    {tf}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <div className="mb-2 flex justify-between">
              <Label>Максимум активных сигналов</Label>
              <span className="font-mono text-sm text-muted-foreground">{draft.max_active}</span>
            </div>
            <Slider
              min={1}
              max={30}
              value={[draft.max_active]}
              onValueChange={([v]) => setDraft({ ...draft, max_active: v })}
            />
          </div>
          <div className="md:col-span-2">
            <div className="mb-2 flex justify-between">
              <Label>Срок жизни сигнала</Label>
              <span className="font-mono text-sm text-muted-foreground">
                {draft.signal_ttl_hours} ч
              </span>
            </div>
            <Slider
              min={1}
              max={24}
              value={[draft.signal_ttl_hours]}
              onValueChange={([v]) => setDraft({ ...draft, signal_ttl_hours: v })}
            />
            <p className="mt-2 text-xs text-muted-foreground">
              Если цена не дошла ни до тейка, ни до стопа, сигнал закрывается как истёкший.
            </p>
          </div>
        </div>

        {(['conservative', 'aggressive'] as const).map((st) => (
          <div key={st} className="rounded-xl border border-border bg-card p-5">
            <h3 className="mb-4 font-semibold">
              {st === 'conservative' ? 'Консервативный стиль' : 'Агрессивный стиль'}
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                тейк и стоп считаются от ATR (волатильности)
              </span>
            </h3>
            <div className="grid gap-4 md:grid-cols-3">
              {(
                [
                  ['tp_atr', 'Тейк-профит, ×ATR'],
                  ['sl_atr', 'Стоп-лосс, ×ATR'],
                  ['min_rr', 'Мин. R:R'],
                ] as const
              ).map(([key, label]) => (
                <div key={key}>
                  <Label className="mb-1.5 block text-sm text-muted-foreground">{label}</Label>
                  <Input
                    type="number"
                    step="0.1"
                    min="0.1"
                    value={draft[st][key]}
                    onChange={(e) =>
                      setStyleCfg(st, key, parseFloat(e.target.value) || 0)
                    }
                    className="font-mono"
                  />
                </div>
              ))}
            </div>
          </div>
        ))}

        <div className="flex items-center gap-3">
          <Button onClick={save} disabled={!dirty || saving} className="cursor-pointer">
            {saving ? 'Сохраняю…' : saved ? 'Сохранено ✓' : 'Сохранить настройки'}
          </Button>
          <p className={`text-xs ${error ? 'text-destructive' : 'text-muted-foreground'}`}>
            {error ??
              'Настройки применяются к следующим сканированиям, уже выданные сигналы не меняются.'}
          </p>
        </div>
      </div>
      <ApiKeys />
    </section>
  )
}
