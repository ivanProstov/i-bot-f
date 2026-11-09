import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import Header from '@/sections/Header'
import Signals from '@/sections/Signals'
import Market from '@/sections/Market'
import SettingsPanel from '@/sections/SettingsPanel'
import DemoTrades from '@/sections/DemoTrades'
import Swarm from '@/sections/Swarm'
import { api, AuthError } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import type { DemoReport, PairRow, RestingPair, Signal, Status } from '@/types'

export default function Home() {
  const { role, logout } = useAuth()
  const readOnly = role === 'view'
  const [status, setStatus] = useState<Status | null>(null)
  const [signals, setSignals] = useState<Signal[]>([])
  const [resting, setResting] = useState<RestingPair[]>([])
  const [pairs, setPairs] = useState<PairRow[]>([])
  const [demo, setDemo] = useState<DemoReport | null>(null)
  const [backendDown, setBackendDown] = useState(false)
  const [tab, setTab] = useState('signals')

  const refresh = useCallback(async () => {
    try {
      const [st, sg, pr, deals] = await Promise.all([
        api.status(),
        api.signals(),
        api.pairs(),
        api.demoTrades(),
      ])
      setStatus(st)
      setSignals(sg.signals)
      setResting(sg.resting ?? [])
      setPairs(pr.pairs)
      setDemo(deals)
      setBackendDown(false)
    } catch (error) {
      if (error instanceof AuthError) return
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
    <div className="relative z-0 mx-auto min-h-dvh max-w-7xl px-4 py-6 md:px-8">
      <Swarm
        variant="field"
        running={!backendDown && (status?.running ?? true)}
        scanning={Boolean(status?.scanning)}
        offline={backendDown}
      />
      <Header
        status={status}
        backendDown={backendDown}
        readOnly={readOnly}
        onToggle={toggle}
        onScanNow={scanNow}
        onLogout={logout}
      />

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
          <TabsTrigger value="demo" className="cursor-pointer">Демо-сделки</TabsTrigger>
          {readOnly ? null : (
            <TabsTrigger value="settings" className="cursor-pointer">Настройки</TabsTrigger>
          )}
        </TabsList>
        <TabsContent value="signals" className="mt-6">
          <Signals
            signals={signals}
            resting={resting}
            demoTrades={demo?.trades ?? []}
            onUpdated={refresh}
            readOnly={readOnly}
          />
        </TabsContent>
        <TabsContent value="market" className="mt-6">
          <Market pairs={pairs} />
        </TabsContent>
        <TabsContent value="demo" className="mt-6">
          <DemoTrades report={demo} readOnly={readOnly} onChanged={refresh} />
        </TabsContent>
        {readOnly ? null : (
          <TabsContent value="settings" className="mt-6">
            {status ? (
              <SettingsPanel
                settings={status.settings}
                onSaved={(s) => setStatus({ ...status, settings: s })}
              />
            ) : null}
          </TabsContent>
        )}
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
