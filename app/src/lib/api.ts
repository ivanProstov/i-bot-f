import type { DemoReport, DemoTrade, DemoTradePage, PairRow, RestingPair, Settings, Signal, SignalHistory, Status } from '@/types'

const TOKEN_KEY = 'locator-token'

export type AuthRole = 'full' | 'view'

export class AuthError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AuthError'
  }
}

export function authToken(): string {
  return localStorage.getItem(TOKEN_KEY) ?? ''
}

export function setAuthToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token)
}

export function clearAuthToken() {
  localStorage.removeItem(TOKEN_KEY)
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers)
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  const token = authToken()
  if (token) headers.set('Authorization', `Bearer ${token}`)
  const r = await fetch(path, { ...init, headers })
  if (!r.ok) {
    let detail = `${r.status} ${r.statusText}`
    try {
      const body = await r.json()
      if (typeof body?.detail === 'string') detail = body.detail
    } catch {
      /* ответ без json */
    }
    if (r.status === 401 && path !== '/api/auth/login') {
      clearAuthToken()
      window.dispatchEvent(new Event('locator-unauthorized'))
      throw new AuthError(detail)
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
  login: (token: string) =>
    req<{ role: AuthRole }>('/api/auth/login', { method: 'POST', body: JSON.stringify({ token }) }),
  status: () => req<Status>('/api/status'),
  signals: () => req<{ signals: Signal[]; resting: RestingPair[] }>('/api/signals'),
  signalHistory: (page: number) =>
    req<SignalHistory>(`/api/signals/history?page=${page}&page_size=12`),
  refreshSignal: (id: string) => req<Signal>(`/api/signals/${id}/refresh`, { method: 'POST' }),
  setSignalDisabled: (id: string, disabled: boolean) =>
    req<Signal>(`/api/signals/${id}/disabled`, {
      method: 'PUT',
      body: JSON.stringify({ disabled }),
    }),
  pairs: () => req<{ pairs: PairRow[] }>('/api/pairs'),
  demoTrades: () => req<DemoReport>('/api/demo-trades'),
  demoTradePage: (query: {
    page: number
    symbol?: string
    side?: string
    status?: string
    reverse?: string
    style?: string
    result?: string
    weekday?: number | null
    hour?: number | null
    sort?: string
    order?: string
  }) => {
    const params = new URLSearchParams()
    params.set('page', String(query.page))
    params.set('page_size', '20')
    if (query.symbol) params.set('symbol', query.symbol)
    if (query.side) params.set('side', query.side)
    if (query.status) params.set('status', query.status)
    if (query.reverse) params.set('reverse', query.reverse)
    if (query.style) params.set('style', query.style)
    if (query.result) params.set('result', query.result)
    if (query.weekday != null) params.set('weekday', String(query.weekday))
    if (query.hour != null) params.set('hour', String(query.hour))
    params.set('sort', query.sort || 'opened_at')
    params.set('order', query.order || 'desc')
    return req<DemoTradePage>(`/api/demo-trades/page?${params}`)
  },
  closeDemoTrade: (id: string) =>
    req<DemoTrade>(`/api/demo-trades/${id}/close`, { method: 'POST' }),
  setProfitClose: (id: string, usdt: number | null) =>
    req<DemoTrade>(`/api/demo-trades/${id}/profit-close`, {
      method: 'PUT',
      body: JSON.stringify({ usdt }),
    }),
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
