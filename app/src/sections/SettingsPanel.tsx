import { useEffect, useState } from 'react'
import { Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
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

function withAuto(settings: Settings): Settings {
  return {
    ...settings,
    auto_trade: settings.auto_trade ?? false,
    auto_wallet_pct: settings.auto_wallet_pct ?? 5,
    auto_leverage: settings.auto_leverage ?? 5,
    auto_min_confidence: settings.auto_min_confidence ?? 0,
    pair_rest_hours: settings.pair_rest_hours ?? 2,
    auto_profit_close_pct: settings.auto_profit_close_pct ?? 30,
    auto_tp_path_pct: settings.auto_tp_path_pct ?? 50,
  }
}

export default function SettingsPanel({
  settings,
  onSaved,
}: {
  settings: Settings
  onSaved: (s: Settings) => void
}) {
  const [draft, setDraft] = useState<Settings>(withAuto(settings))
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const settingsKey = JSON.stringify(settings)
  useEffect(() => {
    setDraft(withAuto(JSON.parse(settingsKey) as Settings))
  }, [settingsKey])

  const dirty = JSON.stringify(draft) !== JSON.stringify(withAuto(settings))

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
        <div className="rounded-xl border border-primary/40 bg-card p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="font-semibold">Автоторговля на демо</h3>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                Только демо-счёт. Реальные ключи эта настройка не использует. Каждый сигнал
                открывается один раз: повторно по нему ордер не ставится. Если по паре уже есть
                позиция, бот её не трогает.
              </p>
            </div>
            <Switch
              checked={draft.auto_trade}
              onCheckedChange={(checked) => setDraft({ ...draft, auto_trade: checked })}
              className="mt-1 cursor-pointer"
              aria-label="Автоторговля на демо"
            />
          </div>
          <div className="mt-5 grid gap-6 md:grid-cols-2">
            <div>
              <div className="mb-2 flex justify-between">
                <Label>Маржа одной сделки</Label>
                <span className="font-mono text-sm text-muted-foreground">
                  {draft.auto_wallet_pct}% кошелька
                </span>
              </div>
              <Slider
                min={1}
                max={50}
                step={1}
                value={[draft.auto_wallet_pct]}
                onValueChange={([value]) => setDraft({ ...draft, auto_wallet_pct: value })}
              />
            </div>
            <div>
              <div className="mb-2 flex justify-between">
                <Label>Плечо</Label>
                <span className="font-mono text-sm text-muted-foreground">{draft.auto_leverage}x</span>
              </div>
              <Slider
                min={1}
                max={50}
                step={1}
                value={[draft.auto_leverage]}
                onValueChange={([value]) => setDraft({ ...draft, auto_leverage: value })}
              />
            </div>
            <div className="md:col-span-2">
              <div className="mb-2 flex justify-between">
                <Label>Уверенность сигнала</Label>
                <span className="font-mono text-sm text-muted-foreground">
                  от {draft.auto_min_confidence}%
                </span>
              </div>
              <Slider
                min={0}
                max={100}
                step={1}
                value={[draft.auto_min_confidence]}
                onValueChange={([value]) => setDraft({ ...draft, auto_min_confidence: value })}
              />
            </div>
            <div>
              <div className="mb-2 flex justify-between">
                <Label>Отдых пары после закрытия</Label>
                <span className="font-mono text-sm text-muted-foreground">
                  {draft.pair_rest_hours} ч
                </span>
              </div>
              <Slider
                min={0}
                max={24}
                step={1}
                value={[draft.pair_rest_hours]}
                onValueChange={([value]) => setDraft({ ...draft, pair_rest_hours: value })}
              />
            </div>
            <div>
              <div className="mb-2 flex justify-between">
                <Label>Тейк автосделки, путь сигнала</Label>
                <span className="font-mono text-sm text-muted-foreground">
                  {draft.auto_tp_path_pct}%
                </span>
              </div>
              <Slider
                min={10}
                max={100}
                step={5}
                value={[draft.auto_tp_path_pct]}
                onValueChange={([value]) => setDraft({ ...draft, auto_tp_path_pct: value })}
              />
            </div>
            <div>
              <div className="mb-2 flex justify-between">
                <Label>Закрыть при плюсе от ставки</Label>
                <span className="font-mono text-sm text-muted-foreground">
                  {draft.auto_profit_close_pct}%
                </span>
              </div>
              <Slider
                min={0}
                max={100}
                step={1}
                value={[draft.auto_profit_close_pct]}
                onValueChange={([value]) => setDraft({ ...draft, auto_profit_close_pct: value })}
              />
            </div>
          </div>
          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
            Маржа — это {draft.auto_wallet_pct}% свободного USDT. Объём позиции = маржа ×{' '}
            {draft.auto_leverage}. Сканер открывает сигнал, когда его уверенность от{' '}
            {draft.auto_min_confidence}% и выше. Тейк на бирже ставится на {draft.auto_tp_path_pct}%
            пути от входа до тейка сигнала: 50 — вдвое ближе, 100 — как на карточке. Стоп не
            сдвигается. После закрытия сделки эта пара отдыхает {draft.pair_rest_hours} ч: новый
            сигнал по ней в автоторговлю не берётся. Ноль часов отключает отдых. Если тейк сигнала
            больше 10% цены, сделка закрывается при плюсе{' '}
            {draft.auto_profit_close_pct}% ставки, не объёма с плечом. Ноль процентов это правило
            выключает. Итог берётся из проводок биржи. Когда срок жизни сигнала выходит, плюс на
            бирже закрывается сразу. Если в этот момент минус, сделка ждёт, пока плюс не станет
            больше 1% маржи плюс комиссия, которую биржа уже списала.
          </p>
        </div>

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
