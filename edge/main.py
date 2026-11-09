"""Отдельный сканер правил направления.

Проверяет простые правила на истории Binance Futures и оставляет те,
что остаются в плюсе на более позднем куске истории после комиссии.
Запуск из корня проекта:
  server/.venv/bin/python -m uvicorn edge.main:app --host 127.0.0.1 --port 8300
"""

import asyncio
import calendar
import statistics
import time
from pathlib import Path

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

BASE = "https://fapi.binance.com"
TF_MS = {"15m": 900_000, "1h": 3_600_000, "4h": 14_400_000}
HORIZONS = {"15m": [1, 4, 16], "1h": [1, 4, 12], "4h": [1, 3, 6]}
DAY_BARS = {"15m": 96, "1h": 24, "4h": 6}
FEE = 0.001
DAY_MS = 86_400_000
BASKET = [
    "BTCUSDT", "ETHUSDT", "BNBUSDT", "XRPUSDT", "DOGEUSDT", "ADAUSDT", "LINKUSDT",
    "AVAXUSDT", "LTCUSDT", "BCHUSDT", "TRXUSDT", "DOTUSDT", "ATOMUSDT", "UNIUSDT",
]
STATIC = Path(__file__).parent / "static"

app = FastAPI(title="Edge scanner")
app.mount("/static", StaticFiles(directory=STATIC), name="static")


class ScanIn(BaseModel):
    timeframe: str = "15m"
    days: int = Field(60, ge=14, le=120)
    top_n: int = Field(30, ge=5, le=50)


class BacktestIn(BaseModel):
    capital: float = Field(1000, gt=0, le=10_000_000)
    days: int = Field(800, ge=60, le=1200)
    agree: int = Field(11, ge=8, le=14)


class MaIn(BaseModel):
    capital: float = Field(1000, gt=0, le=10_000_000)
    timeframe: str = "1h"
    days: int = Field(120, ge=20, le=400)
    steep: float = Field(0.5, ge=0.2, le=5)


class CrossIn(BaseModel):
    start: str
    end: str


def _label(count: int, timeframe: str) -> str:
    minutes = count * {"15m": 15, "1h": 60, "4h": 240}[timeframe]
    if minutes < 60:
        return f"{minutes} мин"
    if minutes % 1440 == 0:
        return f"{minutes // 1440} д"
    if minutes % 60 == 0:
        return f"{minutes // 60} ч"
    return f"{minutes / 60:.1f} ч"


async def _get(client: httpx.AsyncClient, url: str, params: dict):
    response = None
    for attempt in range(3):
        response = await client.get(url, params=params)
        if response.status_code not in (418, 429):
            response.raise_for_status()
            return response
        await asyncio.sleep(1 + attempt)
    response.raise_for_status()
    return response


async def _symbols(client: httpx.AsyncClient, top_n: int) -> list[str]:
    info, tickers = await asyncio.gather(
        _get(client, "/fapi/v1/exchangeInfo", {}),
        _get(client, "/fapi/v1/ticker/24hr", {}),
    )
    allowed = {
        item["symbol"]
        for item in info.json().get("symbols", [])
        if item.get("contractType") == "PERPETUAL"
        and item.get("quoteAsset") == "USDT"
        and item.get("status") == "TRADING"
    }
    rows = [row for row in tickers.json() if row["symbol"] in allowed]
    rows.sort(key=lambda row: float(row["quoteVolume"]), reverse=True)
    return [row["symbol"] for row in rows[:top_n]]


async def _klines(client: httpx.AsyncClient, symbol: str, timeframe: str, start_ms: int, end_ms: int):
    step = TF_MS[timeframe]
    cursor = start_ms
    candles = []
    while cursor < end_ms:
        response = await _get(client, "/fapi/v1/klines", {
            "symbol": symbol,
            "interval": timeframe,
            "startTime": cursor,
            "endTime": end_ms,
            "limit": 1500,
        })
        rows = response.json()
        if not rows:
            break
        for row in rows:
            candles.append({
                "t": int(row[0]),
                "o": float(row[1]),
                "h": float(row[2]),
                "l": float(row[3]),
                "c": float(row[4]),
                "v": float(row[7]),
            })
        nxt = int(rows[-1][0]) + step
        if nxt <= cursor:
            break
        cursor = nxt
        if len(rows) < 1500:
            break
    now_ms = time.time() * 1000
    return [candle for candle in candles if candle["t"] + step <= now_ms]


def _body(candle: dict) -> float:
    return (candle["c"] - candle["o"]) / candle["o"] if candle["o"] else 0.0


def _signals(candles: list[dict], btc: dict[int, float], rule: str, day_bars: int) -> list[int]:
    out = [0] * len(candles)
    for i in range(30, len(candles)):
        out[i] = _rule(candles, btc, i, rule, day_bars)
    return out


def _rule(candles: list[dict], btc: dict[int, float], i: int, rule: str, day_bars: int) -> int:
    if rule == "long":
        return 1
    if rule == "hour":
        past = (candles[i]["c"] - candles[i - 4]["c"]) / candles[i - 4]["c"]
        if abs(past) < 0.002:
            return 0
        return 1 if past > 0 else -1
    if rule == "four_hours":
        past = (candles[i]["c"] - candles[i - 16]["c"]) / candles[i - 16]["c"]
        if abs(past) < 0.005:
            return 0
        return 1 if past > 0 else -1
    if rule == "fade_bar":
        move = _body(candles[i])
        if abs(move) < 0.004:
            return 0
        return -1 if move > 0 else 1
    if rule == "ma":
        window = candles[i - 19:i + 1]
        average = sum(item["c"] for item in window) / 20
        return 1 if candles[i]["c"] > average else -1
    if rule == "break":
        prior = candles[i - 20:i]
        if candles[i]["c"] > max(item["h"] for item in prior):
            return 1
        if candles[i]["c"] < min(item["l"] for item in prior):
            return -1
        return 0
    if rule == "btc":
        move = btc.get(candles[i]["t"])
        if move is None or abs(move) < 0.0015:
            return 0
        return 1 if move > 0 else -1
    if rule == "three_fade":
        bodies = [_body(candles[j]) for j in range(i - 2, i + 1)]
        if all(item > 0 for item in bodies):
            return -1
        if all(item < 0 for item in bodies):
            return 1
        return 0
    if rule == "three_follow":
        bodies = [_body(candles[j]) for j in range(i - 2, i + 1)]
        if all(item > 0 for item in bodies):
            return 1
        if all(item < 0 for item in bodies):
            return -1
        return 0
    if rule == "volume_follow":
        base = statistics.median(item["v"] for item in candles[i - 20:i] if item["v"] > 0)
        move = _body(candles[i])
        if not base or candles[i]["v"] < base * 2 or abs(move) < 0.002:
            return 0
        return 1 if move > 0 else -1
    if rule == "volume_fade":
        followed = _rule(candles, btc, i, "volume_follow", day_bars)
        return -followed
    day = candles[i - day_bars + 1:i + 1] if i + 1 >= day_bars else []
    if rule in {"edge_follow", "edge_fade"} and len(day) == day_bars:
        high = max(item["h"] for item in day)
        low = min(item["l"] for item in day)
        if high <= low:
            return 0
        pos = (candles[i]["c"] - low) / (high - low)
        if pos >= 0.85:
            return 1 if rule == "edge_follow" else -1
        if pos <= 0.15:
            return -1 if rule == "edge_follow" else 1
    return 0


def _trades(candles: list[dict], signals: list[int], horizon: int) -> list[dict]:
    trades = []
    i = 0
    last = len(candles) - horizon
    while i < last:
        side = signals[i]
        if side == 0:
            i += 1
            continue
        entry = candles[i]["c"]
        exit_price = candles[i + horizon]["c"]
        if entry <= 0:
            i += horizon
            continue
        result = (exit_price - entry) / entry * side - FEE
        trades.append({"t": candles[i]["t"], "ret": result})
        i += horizon
    return trades


def _pack(trades: list[dict]) -> dict:
    if not trades:
        return {"n": 0, "hit": None, "avg": None, "median": None, "sum": None}
    returns = [trade["ret"] for trade in trades]
    return {
        "n": len(returns),
        "hit": round(100 * sum(item > 0 for item in returns) / len(returns), 1),
        "avg": round(sum(returns) / len(returns) * 100, 3),
        "median": round(statistics.median(returns) * 100, 3),
        "sum": round(sum(returns) * 100, 1),
    }


def _mark(rows: list[dict]) -> None:
    baseline = {row["horizon"]: row for row in rows if row["id"] == "long"}
    for row in rows:
        base = baseline[row["horizon"]]
        train, test = row["train"], row["test"]
        row["holds"] = bool(
            row["id"] != "long"
            and train["n"] >= 100
            and test["n"] >= 80
            and train["avg"] is not None
            and test["avg"] is not None
            and train["avg"] > 0
            and test["avg"] > 0
            and train["avg"] > base["train"]["avg"]
            and test["avg"] > base["test"]["avg"]
        )


def _summary(rows: list[dict], timeframe: str, pairs: int) -> str:
    held = [row for row in rows if row["holds"]]
    if held:
        best = max(held, key=lambda row: row["test"]["avg"])
        test = best["test"]
        per_pair = test["sum"] / pairs
        tail = ""
        if test["median"] is not None and test["median"] < 0:
            tail = " Типичная сделка при этом убыточна: плюс держат редкие большие ходы."
        return (
            f"Правило «{best['name']}», удержание {_label(best['horizon'], timeframe)}, "
            f"на обеих частях истории обыгрывает простой лонг и остаётся в плюсе. "
            f"На позднем периоде сделок {test['n']}, средняя {test['avg']:+.3f}% после комиссии, "
            f"типичная {test['median']:+.3f}%, на одну пару {per_pair:+.1f}%."
            + tail
        )
    longs = [row for row in rows if row["id"] == "long" and row["test"]["avg"] and row["test"]["avg"] > 0 and row["train"]["avg"] and row["train"]["avg"] > 0]
    if longs:
        best = max(longs, key=lambda row: row["test"]["avg"])
        test = best["test"]
        return (
            f"Правила, которое на обеих частях истории обыгрывает простой лонг, нет. "
            f"Сам рынок рос: «всегда вверх» с удержанием {_label(best['horizon'], timeframe)} "
            f"на позднем периоде в среднем {test['avg']:+.3f}%, но типичная сделка {test['median']:+.3f}%. "
            f"Плюс делают редкие сильные роста, больше половины входов убыточны."
        )
    return "На обеих частях истории ни одно правило не осталось в плюсе после комиссии 0.10%."


def _rules(timeframe: str) -> list[tuple[str, str]]:
    return [
        ("long", "Всегда вверх"),
        ("hour", f"Последние {_label(4, timeframe)} продолжаются"),
        ("four_hours", f"Последние {_label(16, timeframe)} продолжаются"),
        ("fade_bar", "Последняя свеча откатывается"),
        ("ma", "В сторону средней из 20 свечей"),
        ("break", "Пробой максимума или минимума 20 свечей"),
        ("btc", "В сторону только что закрытого BTC"),
        ("three_fade", "После трёх свечей подряд — разворот"),
        ("three_follow", "После трёх свечей подряд — продолжение"),
        ("volume_follow", "Громкая свеча продолжается"),
        ("volume_fade", "Громкая свеча откатывается"),
        ("edge_follow", "Край последних суток продолжается"),
        ("edge_fade", "Край последних суток откатывается"),
    ]


@app.get("/")
def index():
    return FileResponse(STATIC / "index.html")


@app.post("/api/scan")
async def scan(body: ScanIn):
    if body.timeframe not in TF_MS:
        raise HTTPException(400, "Таймфрейм: 15m, 1h или 4h")
    end_ms = int(time.time() * 1000)
    start_ms = end_ms - body.days * 86_400_000
    cut = start_ms + int(0.7 * (end_ms - start_ms))
    sem = asyncio.Semaphore(6)
    async with httpx.AsyncClient(base_url=BASE, timeout=40, headers={"User-Agent": "edge-scanner/1.0"}) as client:
        try:
            symbols = await _symbols(client, body.top_n)
            btc_candles = await _klines(client, "BTCUSDT", body.timeframe, start_ms, end_ms)
        except httpx.HTTPError as exc:
            raise HTTPException(502, f"Биржа не ответила: {exc}") from exc
        btc = {
            candle["t"]: (candle["c"] - candle["o"]) / candle["o"]
            for candle in btc_candles
            if candle["o"]
        }

        async def one(symbol: str):
            async with sem:
                try:
                    return await _klines(client, symbol, body.timeframe, start_ms, end_ms)
                except httpx.HTTPError:
                    return []

        series = await asyncio.gather(*[one(symbol) for symbol in symbols])

    rows = []
    day_bars = DAY_BARS[body.timeframe]
    for key, name in _rules(body.timeframe):
        for horizon in HORIZONS[body.timeframe]:
            train, test = [], []
            for candles in series:
                if len(candles) < horizon + 40:
                    continue
                trades = _trades(candles, _signals(candles, btc, key, day_bars), horizon)
                train.extend(trade for trade in trades if trade["t"] < cut)
                test.extend(trade for trade in trades if trade["t"] >= cut)
            train_pack, test_pack = _pack(train), _pack(test)
            rows.append({
                "id": key,
                "name": name,
                "horizon": horizon,
                "train": train_pack,
                "test": test_pack,
                "holds": False,
            })
    _mark(rows)
    rows.sort(key=lambda row: (row["holds"], row["test"]["avg"] or -999), reverse=True)
    return {
        "pairs": len(symbols),
        "days": body.days,
        "timeframe": body.timeframe,
        "fee_pct": FEE * 100,
        "labels": {str(item): _label(item, body.timeframe) for item in HORIZONS[body.timeframe]},
        "summary": _summary(rows, body.timeframe, len(symbols)),
        "rules": rows,
    }


async def _daily(client: httpx.AsyncClient, symbol: str, start_ms: int, end_ms: int):
    cursor, candles = start_ms, []
    while cursor < end_ms:
        response = await _get(client, "/fapi/v1/klines", {
            "symbol": symbol,
            "interval": "1d",
            "startTime": cursor,
            "endTime": end_ms,
            "limit": 1500,
        })
        rows = response.json()
        if not rows:
            break
        for row in rows:
            candles.append({"t": int(row[0]), "c": float(row[4])})
        nxt = int(rows[-1][0]) + DAY_MS
        if nxt <= cursor or len(rows) < 1500:
            break
        cursor = nxt
    now_ms = time.time() * 1000
    return [candle for candle in candles if candle["t"] + DAY_MS <= now_ms]


async def _funding(client: httpx.AsyncClient, symbol: str, start_ms: int, end_ms: int):
    cursor, points = start_ms, []
    while cursor < end_ms:
        response = await _get(client, "/fapi/v1/fundingRate", {
            "symbol": symbol,
            "startTime": cursor,
            "endTime": end_ms,
            "limit": 1000,
        })
        rows = response.json()
        if not isinstance(rows, list) or not rows:
            break
        points.extend((int(row["fundingTime"]), float(row["fundingRate"])) for row in rows)
        nxt = int(rows[-1]["fundingTime"]) + 1
        if nxt <= cursor or len(rows) < 1000:
            break
        cursor = nxt
    by_day: dict[int, float] = {}
    for stamp, rate in points:
        day = stamp - stamp % DAY_MS
        by_day[day] = by_day.get(day, 0.0) + rate
    return by_day


@app.post("/api/backtest")
async def backtest(body: BacktestIn):
    end_ms = int(time.time() * 1000)
    start_ms = end_ms - body.days * DAY_MS
    sem = asyncio.Semaphore(5)
    async with httpx.AsyncClient(base_url=BASE, timeout=40, headers={"User-Agent": "edge-scanner/1.0"}) as client:
        async def one(symbol: str):
            async with sem:
                try:
                    candles = await _daily(client, symbol, start_ms, end_ms)
                    funding = await _funding(client, symbol, start_ms, end_ms)
                except httpx.HTTPError:
                    return symbol, [], {}
            return symbol, candles, funding

        loaded = await asyncio.gather(*[one(symbol) for symbol in BASKET])

    books = {}
    for symbol, candles, funding in loaded:
        if len(candles) < 40:
            continue
        books[symbol] = {
            "t": [candle["t"] for candle in candles],
            "c": [candle["c"] for candle in candles],
            "f": funding,
            "pos": {candle["t"]: index for index, candle in enumerate(candles)},
        }
    if "BTCUSDT" not in books:
        raise HTTPException(502, "Биржа не отдала дневные свечи BTC")

    clock = books["BTCUSDT"]["t"]
    equity = body.capital
    peak = equity
    worst = 0.0
    weeks = []
    longs = shorts = skipped = 0
    index = 30
    while index + 7 < len(clock):
        stamp = clock[index]
        rows = []
        for book in books.values():
            place = book["pos"].get(stamp)
            if place is None or place < 30 or place + 7 >= len(book["c"]):
                continue
            past = book["c"][place] / book["c"][place - 30] - 1
            future = book["c"][place + 7] / book["c"][place] - 1
            paid = sum(book["f"].get(book["t"][place + step], 0.0) for step in range(7))
            rows.append((past, future, paid))
        ups = sum(past > 0 for past, _, _ in rows)
        downs = len(rows) - ups
        if len(rows) >= body.agree and ups >= body.agree:
            side, name = 1, "лонг"
        elif len(rows) >= body.agree and downs >= body.agree:
            side, name = -1, "шорт"
        else:
            side, name = 0, "мимо"
        if side == 0:
            change = 0.0
            skipped += 1
        else:
            results = [future * side - paid * side - FEE for _, future, paid in rows]
            change = sum(results) / len(results)
            if side > 0:
                longs += 1
            else:
                shorts += 1
        equity *= 1 + change
        peak = max(peak, equity)
        worst = min(worst, equity / peak - 1)
        weeks.append({
            "date": time.strftime("%Y-%m-%d", time.gmtime(stamp / 1000)),
            "side": name,
            "agree": ups,
            "coins": len(rows),
            "change": round(change * 100, 2),
            "equity": round(equity, 2),
        })
        index += 7

    profit = equity - body.capital
    return {
        "capital": round(body.capital, 2),
        "equity": round(equity, 2),
        "profit": round(profit, 2),
        "profit_pct": round(profit / body.capital * 100, 2),
        "drawdown_pct": round(worst * 100, 2),
        "longs": longs,
        "shorts": shorts,
        "skipped": skipped,
        "agree": body.agree,
        "coins": BASKET,
        "weeks": weeks,
    }


MA_LIMITS = {"15m": 60, "1h": 180, "4h": 400}
MA_SLOPE = 8
MA_HOLD = 16
MA_PARALLEL = 0.55


def _sma(closes: list[float], length: int):
    out = [None] * len(closes)
    if len(closes) < length:
        return out
    acc = sum(closes[:length])
    out[length - 1] = acc / length
    for index in range(length, len(closes)):
        acc += closes[index] - closes[index - length]
        out[index] = acc / length
    return out


def _ma_change(series, index: int):
    previous = series[index - MA_SLOPE]
    if not previous:
        return None
    return (series[index] - previous) / previous


def _ma_signals(candles: list[dict], steep: float):
    closes = [candle["c"] for candle in candles]
    fast = _sma(closes, 7)
    mid = _sma(closes, 25)
    slow = _sma(closes, 99)
    found = []
    busy_until = -1
    last = len(closes) - MA_HOLD - 1
    for index in range(99 + MA_SLOPE, last):
        if index < busy_until:
            continue
        fast_slope = _ma_change(fast, index)
        mid_slope = _ma_change(mid, index)
        if fast_slope is None or mid_slope is None or slow[index] is None:
            continue
        if fast_slope > -steep or mid_slope > -steep:
            continue
        same = min(abs(fast_slope), abs(mid_slope)) / max(abs(fast_slope), abs(mid_slope))
        if same < MA_PARALLEL:
            continue
        if slow[index] <= fast[index] or slow[index] <= mid[index]:
            continue
        gap = slow[index] - max(fast[index], mid[index])
        gap_before = slow[index - MA_SLOPE] - max(fast[index - MA_SLOPE], mid[index - MA_SLOPE])
        if gap <= 0 or gap >= gap_before:
            continue
        exit_index = index + MA_HOLD
        result = (closes[index] - closes[exit_index]) / closes[index] - FEE
        found.append({
            "t": candles[index]["t"],
            "exit": candles[exit_index]["t"],
            "ret": result,
        })
        busy_until = exit_index
    return found


def _ma_account(trades: list[dict], capital: float, symbols: list[str]):
    sleeves = {symbol: capital / len(symbols) for symbol in symbols}
    peak = capital
    worst = 0.0
    points = []
    for trade in sorted(trades, key=lambda item: item["exit"]):
        sleeves[trade["symbol"]] *= 1 + trade["ret"]
        equity = sum(sleeves.values())
        peak = max(peak, equity)
        worst = min(worst, equity / peak - 1)
        points.append({
            "date": time.strftime("%Y-%m-%d %H:%M", time.gmtime(trade["t"] / 1000)),
            "symbol": trade["symbol"].replace("USDT", ""),
            "period": trade["period"],
            "change": round(trade["ret"] * 100, 2),
            "equity": round(equity, 2),
        })
    equity = sum(sleeves.values()) if symbols else capital
    return equity, worst, points


def _ma_stats(trades: list[dict]):
    if not trades:
        return {"n": 0, "hit": None, "avg": None, "median": None}
    values = sorted(trade["ret"] for trade in trades)
    return {
        "n": len(values),
        "hit": round(sum(value > 0 for value in values) / len(values) * 100, 1),
        "avg": round(sum(values) / len(values) * 100, 2),
        "median": round(values[len(values) // 2] * 100, 2),
    }


@app.post("/api/ma-backtest")
async def ma_backtest(body: MaIn):
    if body.timeframe not in MA_LIMITS:
        raise HTTPException(400, "Таймфрейм: 15 минут, 1 час или 4 часа")
    days = min(body.days, MA_LIMITS[body.timeframe])
    end_ms = int(time.time() * 1000)
    start_ms = end_ms - days * DAY_MS
    cut = start_ms + int(0.7 * (end_ms - start_ms))
    steep = body.steep / 100
    sem = asyncio.Semaphore(5)
    async with httpx.AsyncClient(base_url=BASE, timeout=40, headers={"User-Agent": "edge-scanner/1.0"}) as client:
        async def one(symbol: str):
            async with sem:
                try:
                    candles = await _klines(client, symbol, body.timeframe, start_ms, end_ms)
                except httpx.HTTPError:
                    return symbol, []
            return symbol, candles

        loaded = await asyncio.gather(*[one(symbol) for symbol in BASKET])

    books = [(symbol, candles) for symbol, candles in loaded if len(candles) >= 200]
    if len(books) < 8:
        raise HTTPException(502, "Биржа отдала слишком мало истории")
    trades = []
    for symbol, candles in books:
        for trade in _ma_signals(candles, steep):
            trade["symbol"] = symbol
            trade["period"] = "позже" if trade["t"] >= cut else "раньше"
            trades.append(trade)
    symbols = [symbol for symbol, _ in books]
    early = [trade for trade in trades if trade["period"] == "раньше"]
    late = [trade for trade in trades if trade["period"] == "позже"]
    equity, worst, points = _ma_account(trades, body.capital, symbols)
    late_equity, late_worst, _ = _ma_account(late, body.capital, symbols)
    late_stats = _ma_stats(late)
    if late_stats["n"] < 8:
        verdict = "На последней трети истории таких входов мало, по ним ещё нельзя понять, повторяется ли ход."
    elif late_stats["avg"] > 0 and late_stats["median"] > 0:
        verdict = "На последней трети истории шорт в эту точку остался в плюсе после комиссии."
    else:
        verdict = "На последней трети истории шорт в эту точку после комиссии не в плюсе. К моменту сигнала падение уже в основном позади."
    profit = equity - body.capital
    late_profit = late_equity - body.capital
    return {
        "capital": round(body.capital, 2),
        "days": days,
        "timeframe": body.timeframe,
        "equity": round(equity, 2),
        "profit": round(profit, 2),
        "profit_pct": round(profit / body.capital * 100, 2),
        "drawdown_pct": round(worst * 100, 2),
        "late_equity": round(late_equity, 2),
        "late_profit": round(late_profit, 2),
        "late_profit_pct": round(late_profit / body.capital * 100, 2),
        "late_drawdown_pct": round(late_worst * 100, 2),
        "early": _ma_stats(early),
        "late": late_stats,
        "verdict": verdict,
        "trades": points,
    }


def _utc_day(value: str) -> int:
    try:
        year, month, day = (int(part) for part in value.split("-"))
        return calendar.timegm((year, month, day, 0, 0, 0, 0, 0, 0)) * 1000
    except (TypeError, ValueError):
        raise HTTPException(400, "Дата в формате ГГГГ-ММ-ДД") from None


def _clock(stamp_ms: int, shift_hours: int = 0) -> str:
    return time.strftime("%Y-%m-%d %H:%M", time.gmtime(stamp_ms / 1000 + shift_hours * 3600))


def _price(value: float) -> float:
    if value >= 1000:
        return round(value, 2)
    if value >= 1:
        return round(value, 4)
    if value >= 0.01:
        return round(value, 6)
    return round(value, 8)


def _body_pct(candle: dict) -> float:
    if not candle["o"]:
        return 0.0
    return (candle["c"] - candle["o"]) / candle["o"] * 100


def _large_before(candles: list[dict], index: int):
    prior = candles[index - 6:index]
    bodies = [_body_pct(candle) for candle in prior]
    if sum(value <= -2 for value in bodies) < 1 and sum(value <= -1.5 for value in bodies) < 2:
        return None
    place = min(range(len(prior)), key=lambda item: bodies[item])
    return prior[place], bodies[place]


def _yellow_led(fast, mid, index: int, bars: int = 6) -> bool:
    for back in range(1, bars + 1):
        if fast[index - back] is None or mid[index - back] is None:
            return False
        if fast[index - back] <= mid[index - back]:
            return False
    return True


def _crosses(symbol: str, candles: list[dict], start_ms: int, end_ms: int):
    closes = [candle["c"] for candle in candles]
    fast = _sma(closes, 7)
    mid = _sma(closes, 25)
    slow = _sma(closes, 99)
    found = []
    for index in range(99, len(candles)):
        if fast[index] is None or fast[index - 1] is None or slow[index] is None:
            continue
        if not (fast[index - 1] > mid[index - 1] and fast[index] <= mid[index]):
            continue
        if not _yellow_led(fast, mid, index):
            continue
        if slow[index] >= fast[index] or slow[index] >= mid[index]:
            continue
        candle = candles[index]
        if candle["t"] < start_ms or candle["t"] >= end_ms:
            continue
        burst = _large_before(candles, index)
        if burst is None:
            continue
        big, big_body = burst
        row = {
            "symbol": symbol,
            "pair": symbol.replace("USDT", ""),
            "time_msk": _clock(candle["t"], 3),
            "time_utc": _clock(candle["t"]),
            "open": _price(candle["o"]),
            "high": _price(candle["h"]),
            "low": _price(candle["l"]),
            "close": _price(candle["c"]),
            "big_time_msk": _clock(big["t"], 3),
            "big_body": round(big_body, 2),
        }
        for hours in (8, 24):
            ahead = index + hours
            if ahead >= len(candles):
                row[f"move_{hours}"] = None
                row[f"short_{hours}"] = None
                continue
            move = candles[ahead]["c"] / candle["c"] - 1
            row[f"move_{hours}"] = round(move * 100, 2)
            row[f"short_{hours}"] = round((-move - FEE) * 100, 2)
        found.append(row)
    return found


def _cross_pack(rows: list[dict], key: str):
    values = [row[key] for row in rows if row.get(key) is not None]
    if not values:
        return {"n": 0, "down": None, "avg": None, "median": None}
    ordered = sorted(values)
    return {
        "n": len(values),
        "down": round(sum(value < 0 for value in values) / len(values) * 100, 1),
        "avg": round(sum(values) / len(values), 2),
        "median": round(ordered[len(ordered) // 2], 2),
    }


@app.post("/api/ma-cross")
async def ma_cross(body: CrossIn):
    start_ms = _utc_day(body.start)
    end_ms = _utc_day(body.end) + DAY_MS
    if end_ms <= start_ms:
        raise HTTPException(400, "Конец промежутка раньше начала")
    if end_ms - start_ms > 180 * DAY_MS:
        raise HTTPException(400, "Промежуток не длиннее 180 дней")
    now_ms = int(time.time() * 1000)
    sem = asyncio.Semaphore(5)
    async with httpx.AsyncClient(base_url=BASE, timeout=40, headers={"User-Agent": "edge-scanner/1.0"}) as client:
        async def one(symbol: str):
            async with sem:
                try:
                    candles = await _klines(client, symbol, "1h", start_ms - 40 * DAY_MS, min(end_ms, now_ms))
                except httpx.HTTPError:
                    return symbol, []
            return symbol, candles

        loaded = await asyncio.gather(*[one(symbol) for symbol in BASKET])

    rows = []
    for symbol, candles in loaded:
        if len(candles) < 30:
            continue
        rows.extend(_crosses(symbol, candles, start_ms, end_ms))
    rows.sort(key=lambda row: row["time_utc"])
    move_8 = _cross_pack(rows, "move_8")
    move_24 = _cross_pack(rows, "move_24")
    short_8 = _cross_pack(rows, "short_8")
    short_24 = _cross_pack(rows, "short_24")
    middle = rows[len(rows) // 2]["time_utc"] if rows else ""
    fresh = _cross_pack([row for row in rows if row["time_utc"] >= middle], "move_8")
    if move_8["n"] < 8:
        verdict = "За этот промежуток таких свечей мало. По ним ещё нельзя судить, идёт ли цена вниз."
    elif (move_8["avg"] or 0) < 0 and (move_8["median"] or 0) < 0 and (fresh["avg"] or 0) < 0 and (short_8["median"] or 0) > 0:
        verdict = "После большой красной свечи и пересечения сверху цена на этом промежутке продолжала вниз. Типичный шорт после комиссии в плюсе."
    elif (move_8["avg"] or 0) >= 0:
        verdict = "Большая свеча перед пересечением не значит, что цена пойдёт дальше вниз. Через 8 часов цена чаще выше."
    else:
        verdict = "На части промежутка цена ещё снижалась, но на свежих пересечениях ход вниз не держится."
    return {
        "count": len(rows),
        "from": body.start,
        "to": body.end,
        "move_8": move_8,
        "move_24": move_24,
        "short_8": short_8,
        "short_24": short_24,
        "verdict": verdict,
        "rows": rows,
    }
