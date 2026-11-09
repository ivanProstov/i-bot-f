"""Открытие фьючерсной сделки на демо или реальном счёте Binance.

Демо и реал — разные хосты и разные ключи. Ключи лежат только в keys.json
и наружу не отдаются.
"""

import hashlib
import hmac
import json
import time
from decimal import Decimal, ROUND_DOWN, ROUND_HALF_UP
from pathlib import Path
from urllib.parse import urlencode

import httpx

KEYS_PATH = Path(__file__).parent / "keys.json"

ENVS = {
    "demo": "https://demo-fapi.binance.com",
    "live": "https://fapi.binance.com",
}

_info_cache: dict[str, tuple[float, dict]] = {}


class TradeError(Exception):
    pass


def _load() -> dict:
    if not KEYS_PATH.exists():
        return {"demo": {}, "live": {}}
    try:
        data = json.loads(KEYS_PATH.read_text())
    except Exception:
        return {"demo": {}, "live": {}}
    return {"demo": data.get("demo") or {}, "live": data.get("live") or {}}


def _save(data: dict) -> None:
    KEYS_PATH.write_text(json.dumps(data, indent=2))
    KEYS_PATH.chmod(0o600)


def keys_status() -> dict:
    data = _load()
    return {
        env: bool(data[env].get("api_key") and data[env].get("api_secret"))
        for env in ENVS
    }


async def demo_request(method: str, path: str, params: dict | None = None):
    """Подписанный запрос только к демо-счёту. Реальный счёт отсюда не вызывается."""
    creds = _load()["demo"]
    api_key, secret = creds.get("api_key", ""), creds.get("api_secret", "")
    if not api_key or not secret:
        raise TradeError("Для демо-счёта не заданы ключи. Добавьте их в настройках.")
    headers = {"X-MBX-APIKEY": api_key}
    async with httpx.AsyncClient(base_url=ENVS["demo"], timeout=20, headers=headers) as client:
        return await _call(client, method, path, secret, params or {})


def save_keys(env: str, api_key: str, api_secret: str) -> None:
    if env not in ENVS:
        raise TradeError("Неизвестный счёт")
    api_key, api_secret = api_key.strip(), api_secret.strip()
    data = _load()
    if not api_key and not api_secret:
        data[env] = {}
    elif not api_key or not api_secret:
        raise TradeError("Нужны и ключ, и секрет")
    else:
        data[env] = {"api_key": api_key, "api_secret": api_secret}
    _save(data)


def _sign(secret: str, params: dict) -> dict:
    params = {k: v for k, v in params.items() if v is not None}
    params["timestamp"] = int(time.time() * 1000)
    params["recvWindow"] = 5000
    query = urlencode(params)
    params["signature"] = hmac.new(secret.encode(), query.encode(), hashlib.sha256).hexdigest()
    return params


def _floor(value: Decimal, step: Decimal) -> Decimal:
    if step <= 0:
        return value
    return (value / step).to_integral_value(ROUND_DOWN) * step


def _nearest(value: Decimal, step: Decimal) -> Decimal:
    if step <= 0:
        return value
    return (value / step).quantize(Decimal("1"), rounding=ROUND_HALF_UP) * step


def _fmt(value: Decimal) -> str:
    text = format(value, "f")
    if "." in text:
        text = text.rstrip("0").rstrip(".")
    return text or "0"


async def _call(client: httpx.AsyncClient, method: str, path: str, secret: str, params: dict):
    response = await client.request(method, path, params=_sign(secret, params))
    try:
        data = response.json()
    except Exception:
        data = {"msg": response.text[:300]}
    if response.status_code >= 400 or (isinstance(data, dict) and int(data.get("code", 0) or 0) < 0):
        msg = data.get("msg") if isinstance(data, dict) else str(data)
        raise TradeError(msg or f"Биржа ответила {response.status_code}")
    return data


async def _exchange_info(client: httpx.AsyncClient, env: str) -> dict:
    cached = _info_cache.get(env)
    if cached and time.time() - cached[0] < 3600:
        return cached[1]
    response = await client.get("/fapi/v1/exchangeInfo")
    response.raise_for_status()
    by_symbol = {s["symbol"]: s for s in response.json().get("symbols", [])}
    _info_cache[env] = (time.time(), by_symbol)
    return by_symbol


def _filters(info: dict) -> tuple[Decimal, Decimal, Decimal, Decimal]:
    step = tick = min_qty = min_notional = Decimal("0")
    for item in info.get("filters", []):
        kind = item.get("filterType")
        if kind == "LOT_SIZE":
            step = Decimal(item["stepSize"])
            min_qty = Decimal(item["minQty"])
        elif kind == "PRICE_FILTER":
            tick = Decimal(item["tickSize"])
        elif kind in ("MIN_NOTIONAL", "NOTIONAL"):
            min_notional = Decimal(item.get("notional") or item.get("minNotional") or "0")
    if step <= 0 or tick <= 0:
        raise TradeError("Биржа не отдала шаг цены или количества")
    return step, tick, min_qty, min_notional


async def open_position(
    env: str,
    symbol: str,
    side: str,
    notional_usdt: float,
    leverage: int,
    tp: float,
    sl: float,
) -> dict:
    if env not in ENVS:
        raise TradeError("Счёт должен быть demo или live")
    if side not in ("LONG", "SHORT"):
        raise TradeError("Сторона должна быть LONG или SHORT")
    if notional_usdt <= 0 or notional_usdt > 100_000:
        raise TradeError("Сумма сделки — от 0 до 100 000 USDT")
    if not 1 <= leverage <= 125:
        raise TradeError("Плечо — от 1 до 125")
    if tp <= 0 or sl <= 0:
        raise TradeError("Тейк и стоп должны быть больше нуля")

    creds = _load()[env]
    api_key, secret = creds.get("api_key", ""), creds.get("api_secret", "")
    if not api_key or not secret:
        name = "демо-счёта" if env == "demo" else "реального счёта"
        raise TradeError(f"Для {name} не заданы ключи. Добавьте их в настройках.")

    headers = {"X-MBX-APIKEY": api_key}
    async with httpx.AsyncClient(base_url=ENVS[env], timeout=20, headers=headers) as client:
        price_resp = await client.get("/fapi/v1/ticker/price", params={"symbol": symbol})
        price_resp.raise_for_status()
        payload = price_resp.json()
        raw_price = payload.get("price") if isinstance(payload, dict) else None
        if not raw_price:
            raise TradeError("Биржа не дала цену по этой паре. На демо-счёте контракт может уже не торговаться")
        price = Decimal(raw_price)

        if side == "LONG" and not (Decimal(str(sl)) < price < Decimal(str(tp))):
            raise TradeError("Для лонга стоп должен быть ниже цены, а тейк — выше")
        if side == "SHORT" and not (Decimal(str(tp)) < price < Decimal(str(sl))):
            raise TradeError("Для шорта тейк должен быть ниже цены, а стоп — выше")

        info = (await _exchange_info(client, env)).get(symbol)
        if not info:
            raise TradeError(f"Пара {symbol} не найдена на этом счёте")
        step, tick, min_qty, min_notional = _filters(info)
        qty = _floor(Decimal(str(notional_usdt)) / price, step)
        if qty < min_qty or qty <= 0:
            raise TradeError("Сумма слишком маленькая для этой пары")
        if min_notional and qty * price < min_notional:
            raise TradeError(f"Минимальная сумма сделки на бирже — {min_notional} USDT")

        mode = await _call(client, "GET", "/fapi/v1/positionSide/dual", secret, {})
        hedge = bool(mode.get("dualSidePosition"))
        position_side = side if hedge else None
        entry_side = "BUY" if side == "LONG" else "SELL"
        exit_side = "SELL" if side == "LONG" else "BUY"

        await _call(client, "POST", "/fapi/v1/leverage", secret, {
            "symbol": symbol, "leverage": leverage,
        })
        entry = await _call(client, "POST", "/fapi/v1/order", secret, {
            "symbol": symbol,
            "side": entry_side,
            "type": "MARKET",
            "quantity": _fmt(qty),
            "positionSide": position_side,
        })

        # С 2025-12-09 тейк и стоп принимаются только как условные ордера.
        # Старый /fapi/v1/order их отклоняет, поэтому позиция открывалась без защиты.
        errors: list[str] = []
        tp_id = sl_id = None
        for kind, level in (
            ("TAKE_PROFIT_MARKET", tp),
            ("STOP_MARKET", sl),
        ):
            try:
                order = await _call(client, "POST", "/fapi/v1/algoOrder", secret, {
                    "algoType": "CONDITIONAL",
                    "symbol": symbol,
                    "side": exit_side,
                    "type": kind,
                    "triggerPrice": _fmt(_nearest(Decimal(str(level)), tick)),
                    "closePosition": "true",
                    "workingType": "CONTRACT_PRICE",
                    "positionSide": position_side,
                })
                algo_id = order.get("algoId") or order.get("orderId")
                if kind == "TAKE_PROFIT_MARKET":
                    tp_id = algo_id
                else:
                    sl_id = algo_id
            except TradeError as exc:
                label = "тейк" if kind == "TAKE_PROFIT_MARKET" else "стоп"
                errors.append(f"{label}: {exc}")
        warning = None
        if errors:
            warning = "Позиция открыта, но не встала защита. " + " ".join(errors)

    return {
        "ok": True,
        "env": env,
        "symbol": symbol,
        "side": side,
        "quantity": _fmt(qty),
        "leverage": leverage,
        "order_id": entry.get("orderId"),
        "tp_order_id": tp_id,
        "sl_order_id": sl_id,
        "warning": warning,
    }


async def close_demo_position(symbol: str, side: str, quantity: str) -> None:
    """Закрывает только размер демо-позиции сканера. Реальный счёт не вызывается."""
    if side not in ("LONG", "SHORT"):
        raise TradeError("Сторона должна быть LONG или SHORT")
    creds = _load()["demo"]
    api_key, secret = creds.get("api_key", ""), creds.get("api_secret", "")
    if not api_key or not secret:
        raise TradeError("Для демо-счёта не заданы ключи. Добавьте их в настройках.")
    headers = {"X-MBX-APIKEY": api_key}
    async with httpx.AsyncClient(base_url=ENVS["demo"], timeout=20, headers=headers) as client:
        mode = await _call(client, "GET", "/fapi/v1/positionSide/dual", secret, {})
        hedge = bool(mode.get("dualSidePosition"))
        try:
            await _call(client, "DELETE", "/fapi/v1/algoOpenOrders", secret, {"symbol": symbol})
        except TradeError:
            pass
        info = (await _exchange_info(client, "demo")).get(symbol)
        if not info:
            raise TradeError(f"Пара {symbol} не найдена на демо-счёте")
        step, _, _, _ = _filters(info)
        qty = _floor(Decimal(quantity), step)
        if qty <= 0:
            raise TradeError("На бирже не осталось количества для закрытия")
        order = {
            "symbol": symbol,
            "side": "SELL" if side == "LONG" else "BUY",
            "type": "MARKET",
            "quantity": _fmt(qty),
            "positionSide": side if hedge else None,
        }
        if not hedge:
            order["reduceOnly"] = "true"
        try:
            await _call(client, "POST", "/fapi/v1/order", secret, order)
        except TradeError as exc:
            if hedge or "ReduceOnly" not in str(exc):
                raise
            # Демо иногда отвергает reduceOnly даже без встречных ордеров.
            # Повтор тем же количеством, без флага, просто гасит позицию.
            try:
                await _call(client, "DELETE", "/fapi/v1/allOpenOrders", secret, {"symbol": symbol})
            except TradeError:
                pass
            plain = dict(order)
            plain.pop("reduceOnly", None)
            await _call(client, "POST", "/fapi/v1/order", secret, plain)
