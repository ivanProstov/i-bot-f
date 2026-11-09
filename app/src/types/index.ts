export interface SignalCheck {
  verdict: 'open' | 'skip' | 'closed'
  title: string
  reasons: string[]
  price: number
  rr_now: number | null
  checked_at: number
}

export interface Signal {
  id: string
  symbol: string
  side: 'LONG' | 'SHORT'
  style: 'conservative' | 'aggressive'
  entry: number
  tp: number
  sl: number
  tp_pct: number
  sl_pct: number
  rr: number
  atr_pct: number
  rsi: number
  confidence: number
  reasons: string[]
  created_at: number
  status: 'active' | 'win' | 'loss' | 'expired'
  disabled?: boolean
  rest_until?: number | null
  closed_at: number | null
  result_pct: number | null
  check?: SignalCheck | null
}

export interface SignalHistory {
  signals: Signal[]
  page: number
  page_size: number
  total: number
  pages: number
}

export interface RestingPair {
  symbol: string
  until: number
  closed_at: number
}

export interface PairRow {
  symbol: string
  price: number
  change_pct: number
  volume_m: number
}

export interface StyleCfg {
  tp_atr: number
  sl_atr: number
  min_rr: number
}

export interface Settings {
  style: 'conservative' | 'aggressive' | 'mixed'
  top_n: number
  scan_interval: number
  timeframe: string
  max_active: number
  signal_ttl_hours: number
  conservative: StyleCfg
  aggressive: StyleCfg
  auto_trade: boolean
  auto_wallet_pct: number
  auto_leverage: number
  auto_min_confidence: number
  pair_rest_hours: number
  auto_profit_close_pct: number
}

export interface DemoBucket {
  key: number
  label: string
  count: number
  wins: number
  losses: number
  commission: number
  net_pnl: number
}

export interface DemoTrade {
  id: string
  signal_id: string
  symbol: string
  side: 'LONG' | 'SHORT'
  style: string | null
  leverage: number
  wallet_pct: number
  quantity: string | null
  order_id: number | null
  opened_at: number | null
  entry_price: number | null
  status: 'open' | 'closed' | 'skipped' | 'error'
  error: string | null
  skip_reason: string | null
  warning: string | null
  gross_pnl: number | null
  commission: number | null
  funding: number | null
  net_pnl: number | null
  unrealized_pnl: number | null
  open_commission: number | null
  closed_at: number | null
  created_at: number
  settle_note: string | null
  margin_usdt?: number | null
  signal_created_at?: number | null
  exit_wait?: boolean | null
  exit_target?: number | null
  closing?: boolean | null
  profit_close_usdt?: number | null
}

export interface DemoReport {
  error: string | null
  trades: DemoTrade[]
  hours: DemoBucket[]
  weekdays: DemoBucket[]
  closed: number
  open: number
  net_pnl: number
  commission: number
  funding: number
  gross_pnl: number
  best_hour: DemoBucket | null
  best_weekday: DemoBucket | null
}

export interface Status {
  running: boolean
  scanning: boolean
  last_scan: number | null
  error: string | null
  pairs_count: number
  stats: {
    active: number
    win: number
    loss: number
    result_pct: number
    result_usdt: number
    stake_usdt: number
  }
  settings: Settings
  auto?: {
    enabled: boolean
    error: string | null
    open: number
  }
}
