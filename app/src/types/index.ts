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
  closed_at: number | null
  result_pct: number | null
  check?: SignalCheck | null
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
}
