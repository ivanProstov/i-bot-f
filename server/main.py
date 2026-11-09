"""
Бэкенд бота сигналов для Binance Futures.

Что делает:
- мониторит топовые USDT-бессрочные пары Binance Futures (только публичное API, ключи не нужны);
- считает индикаторы (EMA, RSI, ATR, объёмы) по свечам 15m;
- генерирует сигналы LONG/SHORT с точкой входа, тейк-профитом и стоп-лоссом;
- отслеживает судьбу сигнала (WIN / LOSS / активен);
- по отдельной кнопке открывает сделку на демо- или реальном счёте;
- отдаёт всё через REST API для React-интерфейса.

Запуск: uvicorn server.main:app --host 127.0.0.1 --port 8100
(или просто `npm run dev` в корне проекта — он поднимет и бэкенд, и интерфейс).
"""

import asyncio
import json
import time
import uuid
from collections import deque
from pathlib import Path

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from .trade import TradeError, keys_status, open_position, save_keys

BASE = "https://fapi.binance.com"
SETTINGS_PATH = Path(__file__).parent / "settings.json"
HISTORY_PATH = Path(__file__).parent / "history.json"
STAKE_USDT = 100

# ---------------------------------------------------------------- настройки
DEFAULT_SETTINGS = {
    # стиль торговли: conservative | aggressive | mixed
    "style": "conservative",
    # сколько самых объёмных пар мониторить
    "top_n": 25,
    # как часто сканировать рынок, секунд
    "scan_interval": 60,
    # таймфрейм свечей
    "timeframe": "15m",
    # множители ATR для тейка и стопа (консервативный стиль)
    "conservative": {"tp_atr": 2.5, "sl_atr": 1.2, "min_rr": 1.8},
    # множители для агрессивного скальпинга
    "aggressive": {"tp_atr": 1.3, "sl_atr": 0.7, "min_rr": 1.4},
    # максимум одновременно активных сигналов
    "max_active": 12,
    # через сколько часов активный сигнал считается протухшим
    "signal_ttl_hours": 6,
}


def load_settings() -> dict:
    if SETTINGS_PATH.exists():
        try:
            saved = json.loads(SETTINGS_PATH.read_text())
            merged = dict(DEFAULT_SETTINGS)
            merged.update(saved)
            return merged
        except Exception:
            pass
    return dict(DEFAULT_SETTINGS)


def save_settings(s: dict):
    SETTINGS_PATH.write_text(json.dumps(s, indent=2, ensure_ascii=False))


SETTINGS = load_settings()

# ---------------------------------------------------------------- индикаторы

def ema(values: list[float], period: int) -> list[float]:
    """Экспоненциальная скользящая средняя."""
    if len(values) < period:
        return [None] * len(values)  # type: ignore
    k = 2 / (period + 1)
    out: list[float] = [None] * (period - 1)  # type: ignore
    seed = sum(values[:period]) / period
    out.append(seed)
    for v in values[period:]:
        seed = v * k + seed * (1 - k)
        out.append(seed)
    return out


def rsi(closes: list[float], period: int = 14) -> list[float]:
    """Индекс относительной силы."""
    n = len(closes)
    out: list[float] = [None] * n  # type: ignore
    if n <= period:
        return out
    gains, losses = [], []
    for i in range(1, period + 1):
        d = closes[i] - closes[i - 1]
        gains.append(max(d, 0))
        losses.append(max(-d, 0))
    ag = sum(gains) / period
    al = sum(losses) / period
    out[period] = 100 if al == 0 else 100 - 100 / (1 + ag / al)
    for i in range(period + 1, n):
        d = closes[i] - closes[i - 1]
        ag = (ag * (period - 1) + max(d, 0)) / period
        al = (al * (period - 1) + max(-d, 0)) / period
        out[i] = 100 if al == 0 else 100 - 100 / (1 + ag / al)
    return out


def atr(highs, lows, closes, period: int = 14) -> list[float]:
    """Средний истинный диапазон — мера волатильности."""
    n = len(closes)
    out: list[float] = [None] * n  # type: ignore
    if n <= period:
        return out
    trs = []
    for i in range(1, n):
        tr = max(highs[i] - lows[i], abs(highs[i] - closes[i - 1]),
                 abs(lows[i] - closes[i - 1]))
        trs.append(tr)
    a = sum(trs[:period]) / period
    out[period] = a
    for i in range(period, len(trs)):
        a = (a * (period - 1) + trs[i]) / period
        out[i + 1] = a
    return out


def sma(values, period):
    if len(values) < period:
        return None
    return sum(values[-period:]) / period


# ---------------------------------------------------------------- движок сигналов

TF_SECONDS = {"5m": 300, "15m": 900, "1h": 3600, "4h": 14400}


def closed_only(candles: list[dict]) -> list[dict]:
    """Убирает текущую, ещё не закрытую свечу.

    Binance отдаёт её последней. Сравнивать её объём со средним по полным
    свечам бессмысленно: в начале 15 минут объём почти всегда «ниже среднего»,
    и сигналы пропадают сразу после открытия новой свечи.
    """
    step = TF_SECONDS.get(SETTINGS["timeframe"], 900)
    now = time.time()
    return [c for c in candles if c.get("open_time", 0) / 1000 + step <= now]


def evaluate(symbol: str, candles: list[dict], style: str) -> dict | None:
    """
    Анализирует свечи одной пары и возвращает сигнал (или None).
    style: conservative | aggressive
    """
    closes = [c["close"] for c in candles]
    highs = [c["high"] for c in candles]
    lows = [c["low"] for c in candles]
    vols = [c["volume"] for c in candles]
    if len(closes) < 60:
        return None

    e20, e50 = ema(closes, 20), ema(closes, 50)
    r = rsi(closes, 14)
    a = atr(highs, lows, closes, 14)
    if e20[-1] is None or e50[-1] is None or r[-1] is None or a[-1] is None:
        return None

    price = closes[-1]
    atr_v = a[-1]
    vol_avg = sma(vols[:-1], 20) or 1
    vol_ratio = vols[-1] / vol_avg
    cfg = SETTINGS[style]

    long_checks: list[str] = []
    short_checks: list[str] = []

    if style == "conservative":
        # Тренд + откат к EMA20 + здоровый RSI + подтверждение объёмом
        uptrend = e20[-1] > e50[-1] and price > e50[-1]
        downtrend = e20[-1] < e50[-1] and price < e50[-1]
        pullback_long = lows[-1] <= e20[-1] * 1.004 and price > e20[-1]
        pullback_short = highs[-1] >= e20[-1] * 0.996 and price < e20[-1]
        rsi_ok_long = 45 <= r[-1] <= 68
        rsi_ok_short = 32 <= r[-1] <= 55
        not_stretched = abs(price - e20[-1]) / atr_v < 1.5

        if uptrend: long_checks.append("восходящий тренд (EMA20 > EMA50)")
        if pullback_long: long_checks.append("откат к EMA20 и удержание")
        if rsi_ok_long: long_checks.append(f"RSI {r[-1]:.0f} в рабочей зоне")
        if vol_ratio >= 1.2: long_checks.append(f"объём выше среднего x{vol_ratio:.1f}")
        if downtrend: short_checks.append("нисходящий тренд (EMA20 < EMA50)")
        if pullback_short: short_checks.append("отскок к EMA20 и отказ")
        if rsi_ok_short: short_checks.append(f"RSI {r[-1]:.0f} в рабочей зоне")
        if vol_ratio >= 1.2: short_checks.append(f"объём выше среднего x{vol_ratio:.1f}")

        long_ok = uptrend and pullback_long and rsi_ok_long and not_stretched and vol_ratio >= 1.2
        short_ok = downtrend and pullback_short and rsi_ok_short and not_stretched and vol_ratio >= 1.2

    else:  # aggressive / скальпинг
        cross_up = e20[-2] <= e50[-2] and e20[-1] > e50[-1]
        cross_down = e20[-2] >= e50[-2] and e20[-1] < e50[-1]
        bounce_up = r[-2] < 32 and r[-1] > r[-2]
        bounce_down = r[-2] > 68 and r[-1] < r[-2]
        vol_spike = vol_ratio >= 1.5

        if cross_up: long_checks.append("пересечение EMA20 выше EMA50")
        if bounce_up: long_checks.append(f"RSI развернулся вверх из перепроданности ({r[-2]:.0f}→{r[-1]:.0f})")
        if vol_spike: long_checks.append(f"всплеск объёма x{vol_ratio:.1f}")
        if cross_down: short_checks.append("пересечение EMA20 ниже EMA50")
        if bounce_down: short_checks.append(f"RSI развернулся вниз из перекупленности ({r[-2]:.0f}→{r[-1]:.0f})")
        if vol_spike: short_checks.append(f"всплеск объёма x{vol_ratio:.1f}")

        long_ok = (cross_up or bounce_up) and vol_spike
        short_ok = (cross_down or bounce_down) and vol_spike

    side = "LONG" if long_ok else ("SHORT" if short_ok else None)
    if side is None:
        return None

    tp_mult, sl_mult = cfg["tp_atr"], cfg["sl_atr"]
    if side == "LONG":
        tp, sl = price + tp_mult * atr_v, price - sl_mult * atr_v
        checks = long_checks
    else:
        tp, sl = price - tp_mult * atr_v, price + sl_mult * atr_v
        checks = short_checks

    risk = abs(price - sl)
    reward = abs(tp - price)
    rr = reward / risk if risk > 0 else 0
    if rr < cfg["min_rr"]:
        return None

    confidence = min(100, int(40 + 12 * len(checks) + 10 * min(vol_ratio, 3)))
    atr_pct = atr_v / price * 100

    return {
        "id": uuid.uuid4().hex[:10],
        "symbol": symbol,
        "side": side,
        "style": style,
        "entry": round(price, 8),
        "tp": round(tp, 8),
        "sl": round(sl, 8),
        "tp_pct": round(reward / price * 100, 2),
        "sl_pct": round(risk / price * 100, 2),
        "rr": round(rr, 2),
        "atr_pct": round(atr_pct, 2),
        "rsi": round(r[-1], 1),
        "confidence": confidence,
        "reasons": checks,
        "created_at": time.time(),
        "candle_open": candles[-1]["open_time"],
        "status": "active",      # active | win | loss | expired
        "closed_at": None,
        "result_pct": None,
    }


# ---------------------------------------------------------------- сканер

class Scanner:
    def __init__(self):
        self.running = True
        self.last_scan: float | None = None
        self.scanning = False
        self.error: str | None = None
        self.pairs: list[dict] = []           # обзор рынка
        self.signals: deque[dict] = deque(maxlen=1000)
        self._task: asyncio.Task | None = None
        self._client: httpx.AsyncClient | None = None
        self._klines_sem = asyncio.Semaphore(12)
        self._load_history()

    def _load_history(self):
        if not HISTORY_PATH.exists():
            return
        try:
            saved = json.loads(HISTORY_PATH.read_text())
        except (OSError, json.JSONDecodeError):
            return
        for item in reversed(saved.get("signals", [])):
            self.signals.appendleft(item)

    def _save_history(self):
        payload = {"signals": list(self.signals)}
        HISTORY_PATH.write_text(json.dumps(payload, ensure_ascii=False))

    def _close(self, signal: dict, status: str, now: float, last: float | None):
        signal["status"] = status
        signal["closed_at"] = now
        signal["result_pct"] = _result_pct(signal, last)

    async def start(self):
        if self._task is None:
            self._client = httpx.AsyncClient(base_url=BASE, timeout=20,
                                             headers={"User-Agent": "signal-bot/1.0"})
            self._task = asyncio.create_task(self._loop())

    async def stop(self):
        self.running = False
        if self._task:
            self._task.cancel()
            self._task = None
        if self._client:
            await self._client.aclose()
            self._client = None

    async def _loop(self):
        while self.running:
            if self.running:
                try:
                    await self.scan_once()
                except Exception as e:
                    self.error = f"{type(e).__name__}: {e}"
            await asyncio.sleep(max(15, SETTINGS["scan_interval"]))

    async def all_tickers(self) -> list[dict]:
        r = await self._client.get("/fapi/v1/ticker/24hr")
        r.raise_for_status()
        rows = [t for t in r.json()
                if t["symbol"].endswith("USDT") and not t["symbol"].endswith("USDCUSDT")]
        rows.sort(key=lambda t: float(t["quoteVolume"]), reverse=True)
        return rows

    async def perpetual_symbols(self) -> set[str] | None:
        """Торгуемые USDT-бессрочные. None — если справочник биржи не ответил."""
        try:
            r = await self._client.get("/fapi/v1/exchangeInfo")
            r.raise_for_status()
        except Exception:
            return None
        return {
            s["symbol"]
            for s in r.json().get("symbols", [])
            if s.get("contractType") == "PERPETUAL"
            and s.get("quoteAsset") == "USDT"
            and s.get("status") == "TRADING"
        }

    async def klines(self, symbol: str) -> list[dict]:
        params = {"symbol": symbol, "interval": SETTINGS["timeframe"], "limit": 160}
        async with self._klines_sem:
            r = await self._client.get("/fapi/v1/klines", params=params)
            if r.status_code == 429:
                await asyncio.sleep(float(r.headers.get("Retry-After", "1")))
                r = await self._client.get("/fapi/v1/klines", params=params)
            r.raise_for_status()
        return [{"open_time": int(k[0]), "open": float(k[1]), "high": float(k[2]),
                 "low": float(k[3]), "close": float(k[4]), "volume": float(k[5])}
                for k in r.json()]

    def _track_outcomes(self, price_map: dict[str, dict], candles_map: dict[str, list[dict]]):
        """Проверяет TP/SL только по цене после входа.

        highPrice/lowPrice тикера — экстремумы за 24 часа. У узкого тейка они
        почти всегда уже пробиты, и сигнал закрывался на следующем скане.
        """
        now = time.time()
        for s in self.signals:
            if s["status"] != "active":
                continue
            if now - s["created_at"] > SETTINGS["signal_ttl_hours"] * 3600:
                quote = price_map.get(s["symbol"])
                last = float(quote["lastPrice"]) if quote else None
                self._close(s, "expired", now, last)
                continue
            p = price_map.get(s["symbol"])
            if not p:
                continue
            last = float(p["lastPrice"])
            hi = max(float(s.get("path_high", s["entry"])), last)
            lo = min(float(s.get("path_low", s["entry"])), last)
            for c in candles_map.get(s["symbol"], []):
                if c["open_time"] / 1000 >= s["created_at"]:
                    hi = max(hi, c["high"])
                    lo = min(lo, c["low"])
            s["path_high"] = hi
            s["path_low"] = lo
            if s["side"] == "LONG":
                hit_tp, hit_sl = hi >= s["tp"], lo <= s["sl"]
            else:
                hit_tp, hit_sl = lo <= s["tp"], hi >= s["sl"]
            # оба уровня в одном интервале: порядок неизвестен, засчитываем стоп
            if hit_sl and hit_tp:
                self._close(s, "loss", now, last)
            elif hit_tp:
                self._close(s, "win", now, last)
            elif hit_sl:
                self._close(s, "loss", now, last)

    async def scan_once(self):
        self.scanning = True
        self.error = None
        try:
            tickers = await self.all_tickers()
            allowed = await self.perpetual_symbols()
            if allowed:
                tickers = [t for t in tickers if t["symbol"] in allowed]
            watched = tickers[: max(5, min(60, int(SETTINGS["top_n"])))]
            price_map = {t["symbol"]: t for t in tickers}
            self.pairs = [{
                "symbol": t["symbol"],
                "price": float(t["lastPrice"]),
                "change_pct": float(t["priceChangePercent"]),
                "volume_m": round(float(t["quoteVolume"]) / 1e6, 1),
            } for t in watched]

            styles = (["conservative", "aggressive"] if SETTINGS["style"] == "mixed"
                      else [SETTINGS["style"]])

            async def one(symbol):
                try:
                    candles = await self.klines(symbol)
                except Exception:
                    return symbol, None, None
                sig = None
                closed = closed_only(candles)
                for st in styles:
                    sig = evaluate(symbol, closed, st)
                    if sig:
                        break
                return symbol, candles, sig

            fetched = await asyncio.gather(*[one(t["symbol"]) for t in watched])
            candles_map = {symbol: candles for symbol, candles, _ in fetched if candles}
            self._track_outcomes(price_map, candles_map)

            active_keys = {(s["symbol"], s["side"]) for s in self.signals
                           if s["status"] == "active"}
            # одну и ту же закрытую свечу не выдаём повторно, даже если сигнал уже закрыт
            issued = {(s["symbol"], s["side"], s.get("candle_open")) for s in self.signals}
            active_count = sum(1 for s in self.signals if s["status"] == "active")
            for _, _, sig in fetched:
                if not sig:
                    continue
                if (sig["symbol"], sig["side"]) in active_keys:
                    continue
                if (sig["symbol"], sig["side"], sig.get("candle_open")) in issued:
                    continue
                if active_count >= SETTINGS["max_active"]:
                    break
                self.signals.appendleft(sig)
                active_keys.add((sig["symbol"], sig["side"]))
                active_count += 1

            self.last_scan = time.time()
            self._save_history()
        finally:
            self.scanning = False

    async def quote(self, symbol: str) -> tuple[list[dict], float]:
        """Свечи и последняя цена одной пары. Работает и на паузе сканера."""
        own = self._client is None
        client = self._client or httpx.AsyncClient(
            base_url=BASE, timeout=20, headers={"User-Agent": "signal-bot/1.0"})
        try:
            params = {"symbol": symbol, "interval": SETTINGS["timeframe"], "limit": 160}
            async with self._klines_sem:
                r = await client.get("/fapi/v1/klines", params=params)
                if r.status_code == 429:
                    await asyncio.sleep(float(r.headers.get("Retry-After", "1")))
                    r = await client.get("/fapi/v1/klines", params=params)
                r.raise_for_status()
            t = await client.get("/fapi/v1/ticker/price", params={"symbol": symbol})
            t.raise_for_status()
            candles = [{"open_time": int(k[0]), "open": float(k[1]), "high": float(k[2]),
                        "low": float(k[3]), "close": float(k[4]), "volume": float(k[5])}
                       for k in r.json()]
            return candles, float(t.json()["price"])
        finally:
            if own:
                await client.aclose()


def _px(v: float) -> str:
    if v >= 1000:
        return f"{v:.1f}"
    if v >= 1:
        return f"{v:.4f}"
    if v >= 0.01:
        return f"{v:.5f}"
    return f"{v:.8f}"


def _check(verdict: str, title: str, reasons: list[str], price: float,
           rr_now: float | None, now: float, close: str | None = None) -> dict:
    return {
        "verdict": verdict,
        "title": title,
        "reasons": reasons,
        "price": price,
        "rr_now": None if rr_now is None else round(rr_now, 2),
        "checked_at": now,
        "close": close,
    }


def assess_signal(signal: dict, candles: list[dict], last: float) -> dict:
    """Свежая проверка: уровни уже задеты, тезис жив, от текущей цены ещё есть смысл входа."""
    now = time.time()
    hi = max(float(signal.get("path_high", signal["entry"])), last)
    lo = min(float(signal.get("path_low", signal["entry"])), last)
    for candle in candles:
        if candle["open_time"] / 1000 >= signal["created_at"]:
            hi = max(hi, candle["high"])
            lo = min(lo, candle["low"])
    signal["path_high"] = hi
    signal["path_low"] = lo

    side = signal["side"]
    if side == "LONG":
        hit_tp, hit_sl = hi >= signal["tp"], lo <= signal["sl"]
        favorable = (last - signal["entry"]) / signal["entry"] * 100
        reward = signal["tp"] - last
        risk = last - signal["sl"]
    else:
        hit_tp, hit_sl = lo <= signal["tp"], hi >= signal["sl"]
        favorable = (signal["entry"] - last) / signal["entry"] * 100
        reward = last - signal["tp"]
        risk = signal["sl"] - last

    if hit_sl and hit_tp:
        return _check(
            "closed", "Стоп уже задет — открывать не стоит",
            ["И тейк, и стоп задеты в одном промежутке. Это считается стопом."],
            last, None, now, close="loss")
    if hit_tp:
        return _check(
            "closed", "Тейк уже достигнут — открывать поздно",
            ["Цель сигнала уже была достигнута по цене после входа."],
            last, None, now, close="win")
    if hit_sl:
        return _check(
            "closed", "Стоп уже сработал — открывать не стоит",
            ["Стоп сигнала уже был задет по цене после входа."],
            last, None, now, close="loss")
    if now - signal["created_at"] > SETTINGS["signal_ttl_hours"] * 3600:
        return _check(
            "closed", "Время сигнала вышло — открывать по нему не стоит",
            [f"Активным он остаётся {SETTINGS['signal_ttl_hours']} ч, этот срок прошёл."],
            last, None, now, close="expired")

    closed = closed_only(candles)
    if len(closed) < 60:
        return _check(
            "skip", "Сейчас лучше не открывать",
            ["Не хватило закрытых свечей, чтобы пересчитать условия."],
            last, None, now)

    closes = [c["close"] for c in closed]
    highs = [c["high"] for c in closed]
    lows = [c["low"] for c in closed]
    e20, e50 = ema(closes, 20), ema(closes, 50)
    r = rsi(closes, 14)
    a = atr(highs, lows, closes, 14)
    if e20[-1] is None or e50[-1] is None or r[-1] is None or a[-1] is None:
        return _check(
            "skip", "Сейчас лучше не открывать",
            ["Индикаторы по последним свечам не посчитались."],
            last, None, now)

    price = closes[-1]
    style = signal.get("style", "conservative")
    cfg = SETTINGS.get(style) or SETTINGS["conservative"]
    if side == "LONG":
        trend_ok = e20[-1] > e50[-1] and price > e50[-1]
        hold_ok = price > e20[-1]
    else:
        trend_ok = e20[-1] < e50[-1] and price < e50[-1]
        hold_ok = price < e20[-1]

    reasons: list[str] = []
    ok = True
    if favorable >= 0.05:
        reasons.append(f"От входа цена уже прошла {favorable:.2f}% в сторону сделки.")
    elif favorable <= -0.05:
        reasons.append(f"Цена на {abs(favorable):.2f}% хуже точки входа сигнала.")
    else:
        reasons.append("Цена почти у точки входа сигнала.")

    if style == "conservative":
        if trend_ok:
            reasons.append("Тренд на закрытых свечах всё ещё в сторону сигнала.")
        else:
            ok = False
            reasons.append("Тренд на закрытых свечах разошёлся со стороной сигнала.")
        if hold_ok:
            reasons.append("Цена держится с нужной стороны EMA20.")
        else:
            ok = False
            reasons.append("Цена ушла за EMA20, условие отката уже не держится.")
        if abs(price - e20[-1]) / a[-1] >= 1.5:
            ok = False
            reasons.append("Цена слишком далеко от EMA20.")
    else:
        texts = signal.get("reasons") or []
        crossed = any("пересечение" in item for item in texts)
        bounced = any("RSI развернулся" in item for item in texts)
        if crossed or not bounced:
            if trend_ok:
                reasons.append("EMA20 всё ещё с нужной стороны EMA50.")
            else:
                ok = False
                reasons.append("EMA20 вернулась обратно через EMA50.")
        if bounced or not crossed:
            if side == "LONG" and r[-1] < 32:
                ok = False
                reasons.append(f"RSI снова {r[-1]:.0f}, ниже 32.")
            elif side == "SHORT" and r[-1] > 68:
                ok = False
                reasons.append(f"RSI снова {r[-1]:.0f}, выше 68.")
            else:
                reasons.append(f"RSI {r[-1]:.0f} остаётся вне крайней зоны.")

    rr_now = None
    if reward <= 0 or risk <= 0:
        ok = False
        reasons.append("От текущей цены тейк или стоп уже с другой стороны.")
    else:
        rr_now = reward / risk
        reasons.append(
            f"От цены {_px(last)} до тейка {reward / last * 100:.2f}%, "
            f"до стопа {risk / last * 100:.2f}%.")
        if rr_now < cfg["min_rr"]:
            ok = False
            reasons.append(f"R:R 1:{rr_now:.2f} ниже порога 1:{cfg['min_rr']}.")
        else:
            reasons.append(f"R:R 1:{rr_now:.2f} проходит порог 1:{cfg['min_rr']}.")

    title = "Можно открывать" if ok else "Сейчас лучше не открывать"
    return _check("open" if ok else "skip", title, reasons, last, rr_now, now)


scanner = Scanner()

# ---------------------------------------------------------------- API
app = FastAPI(title="Binance Futures Signal Bot")
app.add_middleware(CORSMiddleware, allow_origins=["*"],
                   allow_methods=["*"], allow_headers=["*"])


@app.on_event("startup")
async def _startup():
    await scanner.start()


@app.on_event("shutdown")
async def _shutdown():
    scanner._save_history()
    await scanner.stop()


def _result_pct(signal: dict, last: float | None = None):
    if signal["status"] == "win":
        return round(float(signal["tp_pct"]), 2)
    if signal["status"] == "loss":
        return round(-float(signal["sl_pct"]), 2)
    if signal["status"] == "expired" and last and signal.get("entry"):
        move = (last - signal["entry"]) / signal["entry"] * 100
        if signal["side"] == "SHORT":
            move = -move
        return round(move, 2)
    return signal.get("result_pct")


@app.get("/api/status")
def status():
    active = sum(1 for s in scanner.signals if s["status"] == "active")
    finished = [s for s in scanner.signals if s["status"] in ("win", "loss")]
    wins = sum(1 for s in finished if s["status"] == "win")
    losses = sum(1 for s in finished if s["status"] == "loss")
    result_pct = round(sum(_result_pct(s) or 0 for s in finished), 2)
    return {
        "running": scanner.running,
        "scanning": scanner.scanning,
        "last_scan": scanner.last_scan,
        "error": scanner.error,
        "pairs_count": len(scanner.pairs),
        "stats": {
            "active": active,
            "win": wins,
            "loss": losses,
            "result_pct": result_pct,
            "result_usdt": round(result_pct / 100 * STAKE_USDT, 2),
            "stake_usdt": STAKE_USDT,
        },
        "settings": SETTINGS,
    }


@app.get("/api/signals")
def signals():
    return {"signals": list(scanner.signals)}


@app.post("/api/signals/{signal_id}/refresh")
async def refresh_signal(signal_id: str):
    signal = next((s for s in scanner.signals if s["id"] == signal_id), None)
    if signal is None:
        raise HTTPException(404, "Сигнал не найден")
    if signal["status"] != "active":
        return signal
    try:
        candles, last = await scanner.quote(signal["symbol"])
    except httpx.HTTPError as exc:
        raise HTTPException(502, f"Биржа не ответила: {exc}") from exc
    if signal["status"] != "active":
        return signal
    check = assess_signal(signal, candles, last)
    close_as = check.pop("close", None)
    if close_as:
        scanner._close(signal, close_as, time.time(), last)
    signal["check"] = check
    scanner._save_history()
    return signal


@app.get("/api/pairs")
def pairs():
    return {"pairs": scanner.pairs}


@app.get("/api/settings")
def get_settings():
    return SETTINGS


class SettingsPatch(BaseModel):
    style: str | None = None
    top_n: int | None = None
    scan_interval: int | None = None
    timeframe: str | None = None
    max_active: int | None = None
    signal_ttl_hours: int | None = None
    conservative: dict | None = None
    aggressive: dict | None = None


@app.put("/api/settings")
def put_settings(patch: SettingsPatch):
    data = patch.model_dump(exclude_none=True)
    if "style" in data and data["style"] not in ("conservative", "aggressive", "mixed"):
        data.pop("style")
    if "timeframe" in data and data["timeframe"] not in ("5m", "15m", "1h", "4h"):
        data.pop("timeframe")
    if "top_n" in data:
        data["top_n"] = max(5, min(60, int(data["top_n"])))
    if "scan_interval" in data:
        data["scan_interval"] = max(15, min(600, int(data["scan_interval"])))
    for key in ("conservative", "aggressive"):
        if key in data:
            merged = dict(SETTINGS[key])
            merged.update({k: float(v) for k, v in data[key].items()
                           if k in ("tp_atr", "sl_atr", "min_rr")})
            data[key] = merged
    SETTINGS.update(data)
    save_settings(SETTINGS)
    return SETTINGS


@app.post("/api/scanner/start")
async def scanner_start():
    scanner.running = True
    await scanner.start()
    return {"running": True}


@app.post("/api/scanner/stop")
async def scanner_stop():
    await scanner.stop()
    return {"running": False}


@app.post("/api/scanner/scan-now")
async def scan_now():
    if scanner.scanning:
        return {"ok": False, "reason": "already scanning"}
    asyncio.create_task(scanner.scan_once())
    return {"ok": True}


class KeysIn(BaseModel):
    env: str
    api_key: str = ""
    api_secret: str = ""


class OpenIn(BaseModel):
    env: str
    symbol: str
    side: str
    notional_usdt: float
    leverage: int = 5
    tp: float
    sl: float


@app.get("/api/trade/keys")
def trade_keys():
    return keys_status()


@app.put("/api/trade/keys")
def trade_keys_put(body: KeysIn):
    try:
        save_keys(body.env, body.api_key, body.api_secret)
    except TradeError as exc:
        raise HTTPException(400, str(exc)) from exc
    return keys_status()


@app.post("/api/trade/open")
async def trade_open(body: OpenIn):
    symbol = body.symbol.strip().upper()
    if not symbol.endswith("USDT") or not symbol.isalnum():
        raise HTTPException(400, "Нужна USDT-пара")
    try:
        return await open_position(
            body.env, symbol, body.side.upper(),
            body.notional_usdt, body.leverage, body.tp, body.sl,
        )
    except TradeError as exc:
        raise HTTPException(400, str(exc)) from exc
    except httpx.HTTPError as exc:
        raise HTTPException(502, f"Нет связи с биржей: {exc}") from exc
