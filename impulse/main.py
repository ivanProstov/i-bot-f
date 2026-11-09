"""Сканер резких свечей Binance Futures.

Ищет одну свечу с большим ходом цены и считает, куда цена шла после её закрытия.
Запуск из корня проекта:
  server/.venv/bin/python -m uvicorn impulse.main:app --host 127.0.0.1 --port 8200
"""

import asyncio
import statistics
import time
from pathlib import Path

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

BASE = "https://fapi.binance.com"
TF_MS = {"5m": 300_000, "15m": 900_000, "1h": 3_600_000, "4h": 14_400_000}
DAY_BARS = {"5m": 288, "15m": 96, "1h": 24, "4h": 6}
BTC_MIN = {"5m": 0.0005, "15m": 0.001, "1h": 0.002, "4h": 0.004}
STATIC = Path(__file__).parent / "static"

app = FastAPI(title="Impulse scanner")
app.mount("/static", StaticFiles(directory=STATIC), name="static")


class ScanIn(BaseModel):
    timeframe: str = "15m"
    threshold_pct: float = Field(3.0, ge=0.5, le=30)
    days: int = Field(14, ge=1, le=90)
    top_n: int = Field(40, ge=5, le=80)
    horizons: list[int] = Field(default_factory=lambda: [1, 4, 16, 96])


def _pct(value: float) -> float:
    return round(value * 100, 2)


def _median(values: list[float]) -> float:
    return statistics.median(values) if values else 0.0


def _horizon_label(count: int, timeframe: str) -> str:
    minutes = count * {"5m": 5, "15m": 15, "1h": 60, "4h": 240}[timeframe]
    if minutes < 60:
        return f"{minutes} мин"
    if minutes % 1440 == 0:
        return f"{minutes // 1440} д"
    if minutes % 60 == 0:
        return f"{minutes // 60} ч"
    return f"{minutes / 60:.1f} ч"


async def _tickers(client: httpx.AsyncClient, top_n: int) -> list[str]:
    info, tickers = await asyncio.gather(
        client.get("/fapi/v1/exchangeInfo"),
        client.get("/fapi/v1/ticker/24hr"),
    )
    info.raise_for_status()
    tickers.raise_for_status()
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
                "tb": float(row[10]),
            })
        nxt = int(rows[-1][0]) + step
        if nxt <= cursor:
            break
        cursor = nxt
        if len(rows) < 1500:
            break
    now_ms = time.time() * 1000
    return [candle for candle in candles if candle["t"] + step <= now_ms]


async def _open_interest(client: httpx.AsyncClient, symbol: str, timeframe: str, start_ms: int, end_ms: int):
    step = TF_MS[timeframe]
    cursor = start_ms
    points = {}
    # The endpoint returns at most 500 points and keeps the newest ones in the window.
    span = step * 499
    while cursor <= end_ms:
        chunk_end = min(end_ms + step, cursor + span)
        response = await _get(client, "/futures/data/openInterestHist", {
            "symbol": symbol,
            "period": timeframe,
            "startTime": cursor,
            "endTime": chunk_end,
            "limit": 500,
        })
        rows = response.json()
        if isinstance(rows, list):
            for row in rows:
                points[int(row["timestamp"])] = float(row["sumOpenInterest"])
        nxt = chunk_end + step
        if nxt <= cursor:
            break
        cursor = nxt
    return points


def _events(symbol: str, candles: list[dict], threshold: float, horizons: list[int], timeframe: str) -> list[dict]:
    found = []
    look = DAY_BARS[timeframe]
    for index in range(1, len(candles) - 1):
        opened, closed = candles[index]["o"], candles[index]["c"]
        if opened <= 0 or closed <= 0:
            continue
        move = (closed - opened) / opened
        if abs(move) < threshold:
            continue
        previous = candles[index - 1]
        prev_move = (previous["c"] - previous["o"]) / previous["o"] if previous["o"] else 0
        same_way = abs(prev_move) >= threshold and (prev_move > 0) == (move > 0)
        if same_way:
            continue
        direction = "up" if move > 0 else "down"
        spike_volume = candles[index]["v"]
        prior = [item["v"] for item in candles[max(0, index - 20):index] if item["v"] > 0]
        usual = statistics.median(prior) if len(prior) >= 8 else 0
        volume_x = spike_volume / usual if usual else None
        next_volume = candles[index + 1]["v"]
        taker_buy = candles[index]["tb"] / spike_volume if spike_volume else None
        oi_now = candles[index].get("oi")
        oi_next = candles[index + 1].get("oi")
        oi_change = (oi_next - oi_now) / oi_now if oi_now and oi_next is not None else None
        day = candles[max(0, index - look + 1):index + 1]
        if len(day) >= look // 2:
            high = max(item["h"] for item in day)
            low = min(item["l"] for item in day)
            range_pos = (closed - low) / (high - low) if high > low else None
        else:
            range_pos = None
        after = {}
        for horizon in horizons:
            end = index + horizon
            if end >= len(candles):
                continue
            window = candles[index + 1:end + 1]
            future = (candles[end]["c"] - closed) / closed
            if direction == "up":
                favorable = (max(item["h"] for item in window) - closed) / closed
                adverse = (closed - min(item["l"] for item in window)) / closed
                continued = future > 0
            else:
                favorable = (closed - min(item["l"] for item in window)) / closed
                adverse = (max(item["h"] for item in window) - closed) / closed
                continued = future < 0
            after[str(horizon)] = {
                "fwd": future,
                "mfe": favorable,
                "mae": adverse,
                "continued": continued,
                "vol_x": window[-1]["v"] / spike_volume if spike_volume else None,
            }
        found.append({
            "symbol": symbol,
            "time": candles[index]["t"],
            "direction": direction,
            "move": move,
            "close": closed,
            "volume": spike_volume,
            "volume_x": volume_x,
            "next_volume_x": next_volume / spike_volume if spike_volume else None,
            "taker_buy": taker_buy,
            "oi_change": oi_change,
            "btc_move": candles[index].get("btc"),
            "range_pos": range_pos,
            "after": after,
        })
    return found


def _bucket(events: list[dict], horizons: list[int]) -> dict:
    horizons_out = {}
    for horizon in horizons:
        key = str(horizon)
        sample = [event["after"][key] for event in events if key in event["after"]]
        if not sample:
            continue
        forwards = [item["fwd"] for item in sample]
        volume_ratios = [item["vol_x"] for item in sample if item.get("vol_x") is not None]
        horizons_out[key] = {
            "n": len(sample),
            "mean": _pct(sum(forwards) / len(forwards)),
            "median": _pct(_median(forwards)),
            "continuation_pct": round(100 * sum(item["continued"] for item in sample) / len(sample), 1),
            "mean_mfe": _pct(sum(item["mfe"] for item in sample) / len(sample)),
            "mean_mae": _pct(sum(item["mae"] for item in sample) / len(sample)),
            "median_mae": _pct(_median([item["mae"] for item in sample])),
            "median_vol_x": round(_median(volume_ratios), 2) if volume_ratios else None,
        }
    moves = [abs(event["move"]) for event in events]
    spike_ratios = [event["volume_x"] for event in events if event.get("volume_x")]
    next_ratios = [event["next_volume_x"] for event in events if event.get("next_volume_x") is not None]
    volumes = [event["volume"] for event in events if event.get("volume")]

    def median_pct(key: str):
        values = [event[key] for event in events if event.get(key) is not None]
        return _pct(_median(values)) if values else None

    return {
        "count": len(events),
        "avg_move": _pct(sum(moves) / len(moves)) if moves else 0,
        "median_volume": round(_median(volumes)) if volumes else 0,
        "median_volume_x": round(_median(spike_ratios), 2) if spike_ratios else None,
        "median_next_volume_x": round(_median(next_ratios), 2) if next_ratios else None,
        "median_taker_buy": median_pct("taker_buy"),
        "median_oi": median_pct("oi_change"),
        "median_btc": median_pct("btc_move"),
        "median_range": median_pct("range_pos"),
        "horizons": horizons_out,
    }


def _way(horizon: dict) -> str:
    rate = horizon["continuation_pct"]
    if rate >= 55:
        return "чаще продолжала движение"
    if rate <= 45:
        return "чаще разворачивалась"
    if horizon["median"] >= 1:
        return "в типичном случае росла"
    if horizon["median"] <= -1:
        return "в типичном случае падала"
    return "шла без явного перевеса"


def _candle_phrase(bucket: dict, horizon: int, timeframe: str) -> str:
    item = bucket["horizons"].get(str(horizon))
    if not item or item["n"] < 5:
        return ""
    return (
        f"через {_horizon_label(horizon, timeframe)} {_way(item)}, "
        f"продолжение {item['continuation_pct']}%, типичное закрытие {_signed(item['median'])}"
    )


def _summary(up: dict, down: dict, horizons: list[int], timeframe: str) -> str:
    parts = []
    first = []
    for title, bucket in (("резкого роста", up), ("резкого падения", down)):
        bits = [text for step in (1, 3) if (text := _candle_phrase(bucket, step, timeframe))]
        if not bits:
            parts.append(f"После {title} примеров мало.")
            continue
        parts.append(f"После {title}: " + "; ".join(bits) + ".")
        item = bucket["horizons"].get("1")
        if item:
            first.append(item)
    text = " ".join(parts)
    if first:
        against = max(item["median_mae"] for item in first)
        reward = max(abs(item["median"]) for item in first)
        text += (
            f" Для плеча 20x типичная прибыль закрытия следующей свечи — около {reward * 20:.0f}% маржи, "
            f"а типичный ход против неё — около {against * 20:.0f}% маржи. "
            f"Перевеса, на котором держится большое плечо, в этих свечах нет."
        )
    return text


def _volume_split(events: list[dict], horizons: list[int]) -> dict:
    step = 1 if 1 in horizons else horizons[0]
    high = [event for event in events if event.get("volume_x") is not None and event["volume_x"] >= 2]
    low = [event for event in events if event.get("volume_x") is not None and event["volume_x"] < 2]

    def brief(group: list[dict]) -> dict:
        bucket = _bucket(group, [step])
        horizon = bucket["horizons"].get(str(step))
        return {
            "count": bucket["count"],
            "median_volume_x": bucket["median_volume_x"],
            "continuation_pct": horizon["continuation_pct"] if horizon else None,
            "median": horizon["median"] if horizon else None,
        }

    return {"high": brief(high), "low": brief(low)}


def _group_brief(events: list[dict], step: int) -> dict:
    if len(events) < 5:
        return {"count": len(events), "continuation_pct": None, "median": None}
    horizon = _bucket(events, [step])["horizons"].get(str(step)) or {}
    return {
        "count": len(events),
        "continuation_pct": horizon.get("continuation_pct"),
        "median": horizon.get("median"),
    }


def _context(events: list[dict], direction: str, horizons: list[int], timeframe: str) -> list[dict]:
    step = 1 if 1 in horizons else horizons[0]
    later = 3 if 3 in horizons else None
    btc_min = BTC_MIN[timeframe]
    sign = 1 if direction == "up" else -1

    def has(event: dict, key: str) -> bool:
        return event.get(key) is not None

    specs = [
        ("ОИ вырос", lambda event: has(event, "oi_change") and event["oi_change"] > 0),
        ("ОИ упал", lambda event: has(event, "oi_change") and event["oi_change"] < 0),
        ("Тейкеры в сторону импульса", lambda event: has(event, "taker_buy") and (event["taker_buy"] >= 0.55 if sign > 0 else event["taker_buy"] <= 0.45)),
        ("Тейкеры не в сторону импульса", lambda event: has(event, "taker_buy") and (event["taker_buy"] < 0.55 if sign > 0 else event["taker_buy"] > 0.45)),
        ("BTC в ту же сторону", lambda event: has(event, "btc_move") and event["btc_move"] * sign >= btc_min),
        ("BTC не подтвердил", lambda event: has(event, "btc_move") and event["btc_move"] * sign < btc_min),
        ("У края дневного диапазона", lambda event: has(event, "range_pos") and (event["range_pos"] >= 0.8 if sign > 0 else event["range_pos"] <= 0.2)),
        ("Середина дневного диапазона", lambda event: has(event, "range_pos") and 0.3 <= event["range_pos"] <= 0.7),
    ]
    rows = []
    for label, pred in specs:
        group = [event for event in events if pred(event)]
        row = {"label": label, **_group_brief(group, step)}
        if later:
            follow = _group_brief(group, later)
            row["later_continuation_pct"] = follow["continuation_pct"]
            row["later_median"] = follow["median"]
        rows.append(row)
    return rows


def _signed(value: float) -> str:
    return f"{value:+.2f}%"


@app.get("/")
def index():
    return FileResponse(STATIC / "index.html")


@app.post("/api/scan")
async def scan(body: ScanIn):
    if body.timeframe not in TF_MS:
        raise HTTPException(400, "Таймфрейм: 5m, 15m, 1h или 4h")
    horizons = sorted({item for item in body.horizons if 1 <= item <= 500})
    if not horizons:
        raise HTTPException(400, "Нужен хотя бы один горизонт")
    end_ms = int(time.time() * 1000)
    start_ms = end_ms - body.days * 86_400_000
    threshold = body.threshold_pct / 100
    sem = asyncio.Semaphore(8)

    async with httpx.AsyncClient(base_url=BASE, timeout=30, headers={"User-Agent": "impulse-scanner/1.0"}) as client:
        try:
            symbols = await _tickers(client, body.top_n)
        except httpx.HTTPError as exc:
            raise HTTPException(502, f"Биржа не отдала список пар: {exc}") from exc

        try:
            btc_candles = await _klines(client, "BTCUSDT", body.timeframe, start_ms, end_ms)
        except httpx.HTTPError as exc:
            raise HTTPException(502, f"Биржа не отдала свечи BTC: {exc}") from exc
        btc_move = {
            candle["t"]: (candle["c"] - candle["o"]) / candle["o"]
            for candle in btc_candles
            if candle["o"]
        }

        async def one(symbol: str):
            async with sem:
                try:
                    candles = await _klines(client, symbol, body.timeframe, start_ms, end_ms)
                except httpx.HTTPError:
                    return []
                try:
                    oi = await _open_interest(client, symbol, body.timeframe, start_ms, end_ms)
                except httpx.HTTPError:
                    oi = {}
            for candle in candles:
                candle["oi"] = oi.get(candle["t"])
                candle["btc"] = btc_move.get(candle["t"])
            return _events(symbol, candles, threshold, horizons, body.timeframe)

        grouped = await asyncio.gather(*[one(symbol) for symbol in symbols])

    events = [event for batch in grouped for event in batch]
    ups = [event for event in events if event["direction"] == "up"]
    downs = [event for event in events if event["direction"] == "down"]
    up = _bucket(ups, horizons)
    down = _bucket(downs, horizons)
    up["by_volume"] = _volume_split(ups, horizons)
    down["by_volume"] = _volume_split(downs, horizons)
    up["context"] = _context(ups, "up", horizons, body.timeframe)
    down["context"] = _context(downs, "down", horizons, body.timeframe)
    largest = sorted(events, key=lambda event: abs(event["move"]), reverse=True)[:40]
    return {
        "scanned_pairs": len(symbols),
        "threshold_pct": body.threshold_pct,
        "timeframe": body.timeframe,
        "days": body.days,
        "horizon_labels": {str(item): _horizon_label(item, body.timeframe) for item in horizons},
        "summary": _summary(up, down, horizons, body.timeframe),
        "up": up,
        "down": down,
        "events": [
            {
                "symbol": event["symbol"],
                "time": event["time"],
                "direction": event["direction"],
                "move": _pct(event["move"]),
                "volume": round(event["volume"]),
                "volume_x": round(event["volume_x"], 2) if event.get("volume_x") else None,
                "taker_buy": _pct(event["taker_buy"]) if event.get("taker_buy") is not None else None,
                "oi_change": _pct(event["oi_change"]) if event.get("oi_change") is not None else None,
                "btc_move": _pct(event["btc_move"]) if event.get("btc_move") is not None else None,
                "range_pos": round(event["range_pos"] * 100) if event.get("range_pos") is not None else None,
                "after": {
                    key: {
                        "fwd": _pct(item["fwd"]),
                        "continued": item["continued"],
                    }
                    for key, item in event["after"].items()
                },
            }
            for event in largest
        ],
    }
