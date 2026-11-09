import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import Header from '@/sections/Header'
import Signals from '@/sections/Signals'
import Market from '@/sections/Market'
import SettingsPanel from '@/sections/SettingsPanel'
import { api } from '@/lib/api'
import type { PairRow, Signal, Status } from '@/types'

export default function Home() {
  const [status, setStatus] = useState<Status | null>(null)
  const [signals, setSignals] = useState<Signal[]>([])
  const [pairs, setPairs] = useState<PairRow[]>([])
  const [backendDown, setBackendDown] = useState(false)
  const [tab, setTab] = useState('signals')

  const refresh = useCallback(async () => {
    try {
      const [st, sg, pr] = await Promise.all([api.status(), api.signals(), api.pairs()])
      setStatus(st)
      setSignals(sg.signals)
      setPairs(pr.pairs)
      setBackendDown(false)
    } catch {
      setBackendDown(true)
    }
  }, [])

  useEffect(() => {
    refresh()
    const t = setInterval(refresh, 5000)
    return () => clearInterval(t)
  }, [refresh])

  const toggle = async () => {
    if (!status) return
    if (status.running) await api.stop()
    else await api.start()
    await refresh()
  }

  const scanNow = async () => {
    await api.scanNow()
    setTimeout(refresh, 4000)
  }

  return (
    <div className="mx-auto min-h-dvh max-w-7xl px-4 py-6 md:px-8">
      <Header status={status} backendDown={backendDown} onToggle={toggle} onScanNow={scanNow} />

      {backendDown ? (
        <div className="mt-4 flex items-start gap-3 rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <div>
            <p className="font-semibold">Нет связи с бэкендом бота</p>
            <p className="mt-0.5 text-muted-foreground">
              Запусти проект командой <code className="font-mono text-xs">npm run dev</code> из
              корневой папки проекта — она поднимает и Python-сканер, и интерфейс.
            </p>
          </div>
        </div>
      ) : null}

      {status?.error ? (
        <div className="mt-4 flex items-start gap-3 rounded-xl border border-primary/40 bg-primary/8 p-4 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <p className="text-muted-foreground">
            Ошибка последнего сканирования: <span className="font-mono">{status.error}</span>
          </p>
        </div>
      ) : null}

      <Tabs value={tab} onValueChange={setTab} className="mt-6">
        <TabsList>
          <TabsTrigger value="signals" className="cursor-pointer">Сигналы</TabsTrigger>
          <TabsTrigger value="market" className="cursor-pointer">Рынок</TabsTrigger>
          <TabsTrigger value="settings" className="cursor-pointer">Настройки</TabsTrigger>
        </TabsList>
        <TabsContent value="signals" className="mt-6">
          <Signals signals={signals} onUpdated={refresh} />
        </TabsContent>
        <TabsContent value="market" className="mt-6">
          <Market pairs={pairs} />
        </TabsContent>
        <TabsContent value="settings" className="mt-6">
          {status ? (
            <SettingsPanel
              settings={status.settings}
              onSaved={(s) => setStatus({ ...status, settings: s })}
            />
          ) : null}
        </TabsContent>
      </Tabs>

      <footer className="mt-10 border-t border-border pt-5 text-xs leading-relaxed text-muted-foreground">
        <p>
          Бот даёт только сигналы и не торгует за тебя — решение о сделке всегда твоё. Сигнал — это
          не гарантия прибыли: всегда ставь стоп-лосс, не рискуй в одной сделке больше 1–2%
          депозита, а с плечом 10x помни, что движение цены против тебя на ~10% без стопа сотрёт
          маржу позиции.
        </p>
      </footer>
    </div>
  )
}
