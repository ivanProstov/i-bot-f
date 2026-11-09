import type { DemoReport, PairRow, Settings, Signal, Status } from '@/types'

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
  if (!r.ok) {
    let detail = `${r.status} ${r.statusText}`
    try {
      const body = await r.json()
      if (typeof body?.detail === 'string') detail = body.detail
    } catch {
      /* ответ без json */
    }
    throw new Error(detail)
  }
  return r.json()
}

export type TradeEnv = 'demo' | 'live'

export interface TradeResult {
  ok: boolean
  env: TradeEnv
  symbol: string
  side: 'LONG' | 'SHORT'
  quantity: string
  leverage: number
  order_id: number
  tp_order_id: number | null
  sl_order_id: number | null
  warning: string | null
}

export const api = {
  status: () => req<Status>('/api/status'),
  signals: () => req<{ signals: Signal[] }>('/api/signals'),
  refreshSignal: (id: string) => req<Signal>(`/api/signals/${id}/refresh`, { method: 'POST' }),
  pairs: () => req<{ pairs: PairRow[] }>('/api/pairs'),
  demoTrades: () => req<DemoReport>('/api/demo-trades'),
  getSettings: () => req<Settings>('/api/settings'),
  putSettings: (patch: Partial<Settings>) =>
    req<Settings>('/api/settings', { method: 'PUT', body: JSON.stringify(patch) }),
  start: () => req('/api/scanner/start', { method: 'POST' }),
  stop: () => req('/api/scanner/stop', { method: 'POST' }),
  scanNow: () => req('/api/scanner/scan-now', { method: 'POST' }),
  keyStatus: () => req<{ demo: boolean; live: boolean }>('/api/trade/keys'),
  saveKeys: (env: TradeEnv, api_key: string, api_secret: string) =>
    req<{ demo: boolean; live: boolean }>('/api/trade/keys', {
      method: 'PUT',
      body: JSON.stringify({ env, api_key, api_secret }),
    }),
  openTrade: (body: {
    env: TradeEnv
    symbol: string
    side: 'LONG' | 'SHORT'
    notional_usdt: number
    leverage: number
    tp: number
    sl: number
  }) => req<TradeResult>('/api/trade/open', { method: 'POST', body: JSON.stringify(body) }),
}

/** Форматирует цену с разумным числом знаков после запятой. */
export function fmtPrice(v: number): string {
  if (v >= 1000) return v.toLocaleString('ru-RU', { maximumFractionDigits: 1 })
  if (v >= 1) return v.toLocaleString('ru-RU', { maximumFractionDigits: 4 })
  if (v >= 0.01) return v.toFixed(5)
  return v.toFixed(8)
}

export function timeAgo(ts: number): string {
  const s = Math.max(1, Math.floor(Date.now() / 1000 - ts))
  if (s < 60) return `${s} с назад`
  if (s < 3600) return `${Math.floor(s / 60)} мин назад`
  return `${Math.floor(s / 3600)} ч назад`
}
