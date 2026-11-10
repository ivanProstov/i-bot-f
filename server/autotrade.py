"""Автоторговля сигнального бота только на демо-счёте.

Один сигнал открывается один раз. Результат закрытой сделки берётся из
проводок биржи: реализованный результат, комиссия и фандинг. Оценка тейка
из карточки сигнала сюда не подставляется.
"""

import asyncio
import json
import time
import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path

from .trade import TradeError, close_demo_position, demo_request, open_position

TRADES_PATH = Path(__file__).parent / "trades.json"
MINSK = timezone(timedelta(hours=3))
WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"]
MAX_OPEN_PER_TICK = 3
# Далёкий тейк почти не достигается: если ход цены до тейка больше 10%,
# сделку закрываем по плюсу в 30% ставки (маржи), а не номинала с плечом.
WIDE_TP_PCT = 10


def _fmt_qty(value: Decimal) -> str:
    text = format(value, "f")
    if "." in text:
        text = text.rstrip("0").rstrip(".")
    return text or "0"


def _num(value) -> float:
    return float(Decimal(str(value)))


def _price(value: float) -> str:
    return f"{value:.8f}".rstrip("0").rstrip(".")


def exit_target(margin: Decimal, commission: Decimal) -> Decimal:
    """Плюс, которого ждём после минуса: 1% ставки и комиссия, уже взятая биржей."""
    return margin * Decimal("0.01") + commission


def order_plan(signal: dict, settings: dict) -> dict:
    """Сторона и уровни автосделки. В реверсе вход противоположный, тейк и стоп меняются местами."""
    entry = float(signal["entry"])
    signal_tp = float(signal["tp"])
    signal_sl = float(signal["sl"])
    path = settings.get("auto_tp_path_pct")
    path = 50.0 if path is None else float(path)
    reverse = bool(settings.get("auto_reverse"))
    if reverse:
        side = "SHORT" if signal.get("side") == "LONG" else "LONG"
        full_take = signal_sl
        trade_sl = signal_tp
    else:
        side = signal["side"]
        full_take = signal_tp
        trade_sl = signal_sl
    return {
        "side": side,
        "trade_tp": take_on_path(entry, full_take, path),
        "trade_sl": trade_sl,
        "full_take": full_take,
        "reverse": reverse,
    }


def take_on_path(entry: float, tp: float, path_pct: float) -> float:
    """Цена тейка автосделки: доля пути от входа до цели тейка."""
    path = 100.0 if path_pct is None else float(path_pct)
    if path >= 100 or entry <= 0 or tp <= 0:
        return tp
    path = min(100.0, max(10.0, path))
    level = Decimal(str(entry)) + (Decimal(str(tp)) - Decimal(str(entry))) * Decimal(str(path)) / Decimal(100)
    return float(level)


def stake_profit_close(tp_pct: float, margin: Decimal, share_pct: float) -> float | None:
    """Порог плюса в USDT, если тейк сигнала дальше 10% цены. Процент берётся от ставки."""
    if share_pct <= 0 or tp_pct <= WIDE_TP_PCT or margin <= 0:
        return None
    goal = round(_num(margin * Decimal(str(share_pct)) / Decimal(100)), 2)
    return goal if goal > 0 else None


def _minsk(ts: float) -> datetime:
    return datetime.fromtimestamp(ts, MINSK)


def _bucket(rows: list[dict], key: int, label: str) -> dict:
    wins = sum(1 for row in rows if row["net_pnl"] > 0)
    losses = sum(1 for row in rows if row["net_pnl"] < 0)
    return {
        "key": key,
        "label": label,
        "count": len(rows),
        "wins": wins,
        "losses": losses,
        "commission": round(sum(row["commission"] for row in rows), 4),
        "net_pnl": round(sum(row["net_pnl"] for row in rows), 4),
    }


def summarize(trades: list[dict]) -> dict:
    closed = [
        row for row in trades
        if row.get("status") == "closed" and row.get("net_pnl") is not None and row.get("opened_at")
    ]
    hours = []
    for hour in range(24):
        rows = [row for row in closed if _minsk(row["opened_at"]).hour == hour]
        hours.append(_bucket(rows, hour, f"{hour:02d}"))
    weekdays = []
    for index, name in enumerate(WEEKDAYS):
        rows = [row for row in closed if _minsk(row["opened_at"]).weekday() == index]
        weekdays.append(_bucket(rows, index, name))

    def best(buckets: list[dict]) -> dict | None:
        filled = [bucket for bucket in buckets if bucket["count"] > 0]
        if not filled:
            return None
        return max(filled, key=lambda bucket: (bucket["net_pnl"], bucket["wins"]))

    return {
        "closed": len(closed),
        "open": sum(1 for row in trades if row.get("status") == "open"),
        "net_pnl": round(sum(row["net_pnl"] for row in closed), 4),
        "commission": round(sum(row["commission"] for row in closed), 4),
        "funding": round(sum(row.get("funding") or 0 for row in closed), 4),
        "gross_pnl": round(sum(row.get("gross_pnl") or 0 for row in closed), 4),
        "hours": hours,
        "weekdays": weekdays,
        "best_hour": best(hours),
        "best_weekday": best(weekdays),
    }


class AutoBook:
    def __init__(self):
        self.trades: list[dict] = []
        self.error: str | None = None
        self._lock = asyncio.Lock()
        self._load()

    def _load(self):
        if not TRADES_PATH.exists():
            return
        try:
            saved = json.loads(TRADES_PATH.read_text())
        except (OSError, json.JSONDecodeError):
            return
        self.trades = list(saved.get("trades") or [])

    def _save(self):
        TRADES_PATH.write_text(json.dumps({"trades": self.trades}, ensure_ascii=False))

    def _known(self, signal_id: str) -> bool:
        return any(row.get("signal_id") == signal_id for row in self.trades)

    def resting_pairs(self, settings: dict) -> list[dict]:
        """Пары, по которым автоторговля ещё ждёт после закрытой сделки."""
        raw = settings.get("pair_rest_hours")
        hours = 2.0 if raw is None else float(raw)
        if hours <= 0:
            return []
        latest: dict[str, float] = {}
        for row in self.trades:
            if row.get("status") != "closed" or not row.get("symbol"):
                continue
            if not row.get("opened_at") or not row.get("closed_at"):
                continue
            symbol = str(row["symbol"])
            closed = float(row["closed_at"])
            if symbol not in latest or closed > latest[symbol]:
                latest[symbol] = closed
        now = time.time()
        resting = []
        for symbol, closed in latest.items():
            until = closed + hours * 3600
            if now < until:
                resting.append({"symbol": symbol, "until": until, "closed_at": closed})
        resting.sort(key=lambda row: row["until"])
        return resting

    def pair_rest_until(self, symbol: str, settings: dict) -> float | None:
        """До какого момента пара не берётся в автоторговлю после закрытой сделки."""
        for row in self.resting_pairs(settings):
            if row["symbol"] == symbol:
                return row["until"]
        return None

    def _add(self, row: dict):
        self.trades.insert(0, row)
        self._save()

    async def close_manual(self, trade_id: str, settings: dict) -> dict:
        """Закрывает одну открытую демо-сделку сканера. Чужие и реальные позиции не трогает."""
        async with self._lock:
            trade = next((row for row in self.trades if row.get("id") == trade_id), None)
            if trade is None:
                raise KeyError(trade_id)
            if trade.get("status") != "open":
                raise TradeError("Эта демо-сделка уже закрыта")
            now = time.time()
            if trade.get("closing") and now - float(trade.get("close_requested_at") or 0) < 15:
                return trade
            rows = await self._rows(trade["symbol"])
            if rows is None:
                raise TradeError("Демо-биржа не ответила, закрытие не отправлено")
            amount, _ = self._side_state(rows, trade["side"])
            if amount <= 0:
                trade["settle_note"] = "Позиции на бирже уже нет, жду проводку результата"
                self._save()
                return trade
            await close_demo_position(trade["symbol"], trade["side"], _fmt_qty(amount))
            trade["closing"] = True
            trade["close_requested_at"] = now
            trade["settle_note"] = "Закрываю демо-сделку по кнопке"
            self._save()
            await asyncio.sleep(0.6)
            await self._settle(settings)
            return trade

    async def tick(self, signals: list[dict], settings: dict):
        async with self._lock:
            await self._settle(settings)
            if not settings.get("auto_trade"):
                if not any(row.get("status") == "open" for row in self.trades):
                    self.error = None
                return
            await self._open_new(signals, settings)

    async def _rows(self, symbol: str) -> list | None:
        try:
            rows = await demo_request("GET", "/fapi/v2/positionRisk", {"symbol": symbol})
        except Exception:
            return None
        return rows if isinstance(rows, list) else None

    def _side_state(self, rows: list, side: str) -> tuple[Decimal, Decimal]:
        """Размер и плавающий результат именно нашей стороны. Чужую позицию не считает своей."""
        for row in rows:
            position_side = row.get("positionSide") or "BOTH"
            amount = Decimal(row.get("positionAmt") or "0")
            unrealized = Decimal(row.get("unRealizedProfit") or "0")
            if position_side == side:
                return abs(amount), unrealized
            if position_side == "BOTH" and (
                (side == "LONG" and amount >= 0) or (side == "SHORT" and amount <= 0)
            ):
                return abs(amount), unrealized
        return Decimal(0), Decimal(0)

    def _exposure(self, rows: list) -> Decimal:
        return sum((abs(Decimal(row.get("positionAmt") or "0")) for row in rows), Decimal(0))

    def _note(self, trade: dict, text: str | None) -> bool:
        if trade.get("settle_note") == text:
            return False
        trade["settle_note"] = text
        return True

    async def _maybe_exit(self, trade: dict, settings: dict, amount: Decimal, unrealized: Decimal, now: float) -> bool:
        """После срока сигнала плюс закрывается сразу, минус ждёт 1% ставки плюс комиссию."""
        born = float(trade.get("signal_created_at") or trade.get("opened_at") or now)
        ttl = float(settings.get("signal_ttl_hours") or 6) * 3600
        if now - born < ttl:
            return False
        if trade.get("closing") and now - float(trade.get("close_requested_at") or 0) < 20:
            return False
        commission = Decimal(str(trade.get("open_commission") or 0))
        margin = Decimal(str(trade.get("margin_usdt") or 0))
        if margin <= 0 and trade.get("notional") and trade.get("leverage"):
            margin = Decimal(str(trade["notional"])) / Decimal(str(trade["leverage"]))
        target = exit_target(margin, commission)
        trade["exit_target"] = round(_num(target), 4)
        should_close = False
        if not trade.get("exit_wait"):
            if unrealized > 0:
                should_close = True
                note = "Срок сигнала вышел, на бирже плюс — закрываю демо-сделку"
            else:
                trade["exit_wait"] = True
                return self._note(
                    trade,
                    f"Срок сигнала вышел, на бирже минус. Жду плюс больше { _num(target):.2f} USDT: "
                    "1% ставки и комиссия биржи",
                ) or True
        elif unrealized > target:
            should_close = True
            note = f"Плюс на бирже {_num(unrealized):.2f} USDT выше порога {_num(target):.2f} — закрываю"
        else:
            return self._note(
                trade,
                f"Срок сигнала вышел. Сейчас {_num(unrealized):.2f} USDT, жду больше {_num(target):.2f} USDT",
            )
        if not should_close:
            return False
        try:
            await close_demo_position(trade["symbol"], trade["side"], _fmt_qty(amount))
        except TradeError as exc:
            trade["closing"] = False
            return self._note(trade, f"Не смог закрыть демо-сделку: {exc}") or True
        trade["closing"] = True
        trade["close_requested_at"] = now
        return self._note(trade, note) or True

    async def _close_for_profit(self, trade: dict, amount: Decimal, unrealized: Decimal, now: float) -> bool:
        """Закрывает демо-сделку, когда плавающий плюс биржи достиг суммы, заданной вручную."""
        raw = trade.get("profit_close_usdt")
        if not raw:
            return False
        if trade.get("closing") and now - float(trade.get("close_requested_at") or 0) < 20:
            return False
        goal = Decimal(str(raw))
        if unrealized < goal:
            return False
        note = (
            f"Плюс на бирже {_num(unrealized):.2f} USDT достиг {_num(goal):.2f} — закрываю демо-сделку"
        )
        try:
            await close_demo_position(trade["symbol"], trade["side"], _fmt_qty(amount))
        except TradeError as exc:
            trade["closing"] = False
            return self._note(trade, f"Не смог закрыть по плюсу {_num(goal):.2f} USDT: {exc}") or True
        trade["closing"] = True
        trade["close_requested_at"] = now
        return self._note(trade, note) or True

    async def set_profit_close(self, trade_id: str, usdt: float | None, settings: dict) -> dict:
        async with self._lock:
            trade = next((row for row in self.trades if row.get("id") == trade_id), None)
            if trade is None:
                raise KeyError(trade_id)
            if trade.get("status") != "open":
                raise TradeError("Порог плюса можно поставить только открытой демо-сделке")
            if usdt is None or usdt <= 0:
                trade["profit_close_usdt"] = None
                note = str(trade.get("settle_note") or "")
                if note.startswith("Закрою, когда плюс") or note.startswith("Тейк сигнала"):
                    trade["settle_note"] = None
                self._save()
                return trade
            if usdt > 1_000_000:
                raise TradeError("Порог плюса слишком большой")
            goal = round(float(usdt), 2)
            trade["profit_close_usdt"] = goal
            trade["settle_note"] = (
                f"Закрою, когда плюс на бирже будет от {goal:.2f} USDT. Тейк по цене сигнала остаётся."
            )
            self._save()
            rows = await self._rows(trade["symbol"])
            if rows is not None:
                amount, unrealized = self._side_state(rows, trade["side"])
                if amount > 0:
                    trade["unrealized_pnl"] = round(_num(unrealized), 4)
                    if await self._close_for_profit(trade, amount, unrealized, time.time()):
                        self._save()
                        await asyncio.sleep(0.6)
                        await self._settle(settings)
            return trade

    async def watch_profit(self, settings: dict | None = None):
        """Пока у открытой сделки задан плюс в USDT, проверяет биржу чаще сканера."""
        while True:
            await asyncio.sleep(5)
            try:
                async with self._lock:
                    watched = [
                        row for row in self.trades
                        if row.get("status") == "open" and row.get("profit_close_usdt")
                    ]
                    if not watched:
                        continue
                    now = time.time()
                    changed = False
                    closed = False
                    for trade in watched:
                        if now - float(trade.get("opened_at") or trade.get("created_at") or now) < 20:
                            continue
                        rows = await self._rows(trade["symbol"])
                        if rows is None:
                            continue
                        amount, unrealized = self._side_state(rows, trade["side"])
                        if amount <= 0:
                            continue
                        fresh = round(_num(unrealized), 4)
                        if trade.get("unrealized_pnl") != fresh:
                            trade["unrealized_pnl"] = fresh
                            changed = True
                        if await self._close_for_profit(trade, amount, unrealized, now):
                            changed = True
                            closed = True
                    if changed:
                        self._save()
                    if closed:
                        await asyncio.sleep(0.6)
                        await self._settle(settings or {})
            except Exception:
                continue

    async def _settle(self, settings: dict):
        now = time.time()
        changed = False
        for trade in self.trades:
            if trade.get("status") != "open":
                continue
            if now - float(trade.get("opened_at") or trade.get("created_at") or now) < 20:
                continue
            rows = await self._rows(trade["symbol"])
            if rows is None:
                self.error = "Демо-биржа не ответила по открытой позиции, повторю на следующем скане"
                continue
            amount, unrealized = self._side_state(rows, trade["side"])
            if amount > 0:
                fresh = round(_num(unrealized), 4)
                if trade.get("unrealized_pnl") != fresh:
                    trade["unrealized_pnl"] = fresh
                    changed = True
                if await self._close_for_profit(trade, amount, unrealized, now):
                    changed = True
                    continue
                if await self._maybe_exit(trade, settings, amount, unrealized, now):
                    changed = True
                continue
            try:
                income = await demo_request("GET", "/fapi/v1/income", {
                    "symbol": trade["symbol"],
                    "startTime": int(trade["opened_at_ms"]),
                    "endTime": int(now * 1000),
                    "limit": 1000,
                })
            except (TradeError, Exception) as exc:
                self.error = f"Не прочитал проводки биржи: {exc}"
                continue
            if not isinstance(income, list):
                continue
            realized_rows = [row for row in income if row.get("incomeType") == "REALIZED_PNL"]
            if not realized_rows:
                note = "Позиция на бирже уже закрыта, жду проводку результата"
                if trade.get("settle_note") != note:
                    trade["settle_note"] = note
                    changed = True
                continue
            gross = sum(Decimal(row["income"]) for row in realized_rows if row.get("asset") in (None, "USDT"))
            commission_income = sum(
                Decimal(row["income"]) for row in income
                if row.get("incomeType") == "COMMISSION" and row.get("asset") in (None, "USDT")
            )
            funding = sum(
                Decimal(row["income"]) for row in income
                if row.get("incomeType") == "FUNDING_FEE" and row.get("asset") in (None, "USDT")
            )
            commission = -commission_income
            trade.update({
                "status": "closed",
                "gross_pnl": round(_num(gross), 4),
                "commission": round(_num(commission), 4),
                "funding": round(_num(funding), 4),
                "net_pnl": round(_num(gross + commission_income + funding), 4),
                "closed_at": max(int(row.get("time") or 0) for row in realized_rows) / 1000,
                "unrealized_pnl": None,
                "settle_note": None,
                "income": [
                    {
                        "type": row.get("incomeType"),
                        "amount": row.get("income"),
                        "asset": row.get("asset"),
                        "time": row.get("time"),
                    }
                    for row in income
                    if row.get("incomeType") in ("REALIZED_PNL", "COMMISSION", "FUNDING_FEE")
                ],
            })
            self.error = None
            changed = True
        if changed:
            self._save()

    async def _open_new(self, signals: list[dict], settings: dict):
        try:
            balance_rows = await demo_request("GET", "/fapi/v2/balance", {})
        except TradeError as exc:
            self.error = str(exc)
            return
        except Exception as exc:
            self.error = f"Не прочитал демо-кошелёк: {exc}"
            return
        available = Decimal(0)
        if isinstance(balance_rows, list):
            for row in balance_rows:
                if row.get("asset") == "USDT":
                    available = Decimal(row.get("availableBalance") or "0")
                    break
        if available <= 0:
            self.error = "На демо-счёте нет свободного USDT"
            return

        pct = Decimal(str(settings.get("auto_wallet_pct") or 5))
        leverage = int(settings.get("auto_leverage") or 5)
        minimum = int(settings.get("auto_min_confidence") or 0)
        margin = available * pct / Decimal(100)
        notional = margin * leverage
        opened = 0
        for signal in signals:
            if opened >= MAX_OPEN_PER_TICK:
                break
            if signal.get("status") != "active" or self._known(signal["id"]):
                continue
            if signal.get("disabled"):
                continue
            if self.pair_rest_until(signal["symbol"], settings):
                continue
            if int(signal.get("confidence") or 0) < minimum:
                continue
            if any(row.get("symbol") == signal["symbol"] and row.get("status") == "open" for row in self.trades):
                self._remember_skip(signal, leverage, pct, "По этой паре автосделка уже открыта")
                continue
            rows = await self._rows(signal["symbol"])
            if rows is None:
                self.error = "Демо-биржа не ответила перед открытием, повторю на следующем скане"
                return
            if self._exposure(rows) > 0:
                self._remember_skip(
                    signal, leverage, pct,
                    "На демо-счёте по этой паре уже есть позиция, бот её не трогает",
                )
                continue
            plan = order_plan(signal, settings)
            side = plan["side"]
            trade_tp = plan["trade_tp"]
            trade_sl = plan["trade_sl"]
            try:
                result = await open_position(
                    "demo", signal["symbol"], side,
                    float(notional), leverage, trade_tp, trade_sl,
                )
            except TradeError as exc:
                if trade_tp != plan["full_take"] and "тейк" in str(exc).lower():
                    trade_tp = plan["full_take"]
                    try:
                        result = await open_position(
                            "demo", signal["symbol"], side,
                            float(notional), leverage, trade_tp, trade_sl,
                        )
                    except TradeError as again:
                        self._remember_skip(signal, leverage, pct, str(again), status="error", side=side)
                        continue
                else:
                    self._remember_skip(signal, leverage, pct, str(exc), status="error", side=side)
                    continue
            except Exception as exc:
                self.error = f"Не открыл демо-сделку: {exc}"
                return
            await self._remember_open(
                signal, result, leverage, pct, notional, settings, trade_tp, trade_sl, side, plan["reverse"],
            )
            opened += 1
        if opened:
            self.error = None

    def _remember_skip(
        self, signal: dict, leverage: int, pct: Decimal, reason: str,
        status: str = "skipped", side: str | None = None,
    ):
        self._add({
            "id": uuid.uuid4().hex[:10],
            "signal_id": signal["id"],
            "symbol": signal["symbol"],
            "side": side or signal["side"],
            "style": signal.get("style"),
            "leverage": leverage,
            "wallet_pct": float(pct),
            "quantity": None,
            "order_id": None,
            "opened_at": None,
            "opened_at_ms": None,
            "entry_price": None,
            "status": status,
            "error": reason if status == "error" else None,
            "skip_reason": reason if status == "skipped" else None,
            "warning": None,
            "gross_pnl": None,
            "commission": None,
            "funding": None,
            "net_pnl": None,
            "unrealized_pnl": None,
            "open_commission": None,
            "closed_at": None,
            "created_at": time.time(),
            "settle_note": None,
        })

    async def _remember_open(
        self, signal: dict, result: dict, leverage: int, pct: Decimal, notional: Decimal,
        settings: dict, trade_tp: float, trade_sl: float, side: str, reverse: bool,
    ):
        order_id = result.get("order_id")
        fills = []
        if order_id:
            try:
                fills = await demo_request("GET", "/fapi/v1/userTrades", {
                    "symbol": signal["symbol"],
                    "orderId": order_id,
                    "limit": 50,
                })
            except Exception:
                fills = []
        if not isinstance(fills, list):
            fills = []
        qty = Decimal(0)
        quote = Decimal(0)
        commission = Decimal(0)
        opened_ms = None
        for fill in fills:
            part = Decimal(fill.get("qty") or "0")
            qty += part
            quote += Decimal(fill.get("quoteQty") or "0")
            if (fill.get("commissionAsset") or "USDT") == "USDT":
                commission += Decimal(fill.get("commission") or "0")
            stamp = int(fill.get("time") or 0)
            opened_ms = stamp if opened_ms is None else min(opened_ms, stamp)
        now_ms = int(time.time() * 1000)
        opened_ms = opened_ms or now_ms
        margin = (notional / leverage) if leverage else Decimal(0)
        entry = float(signal.get("entry") or 0)
        signal_tp = float(signal.get("tp") or 0)
        signal_sl = float(signal.get("sl") or 0)
        if reverse and entry:
            take_pct = abs(signal_sl - entry) / entry * 100
        else:
            take_pct = float(signal.get("tp_pct") or 0)
        share = settings.get("auto_profit_close_pct")
        share = 30.0 if share is None else float(share)
        goal = stake_profit_close(take_pct, margin, share)
        notes = []
        if reverse:
            notes.append(
                f"Реверс: сигнал {signal.get('side')}, открыт {side}. "
                f"Стоп {_price(trade_sl)} стоит на тейке сигнала. "
                f"Тейк {_price(trade_tp)} идёт к стопу сигнала {_price(signal_sl)}."
            )
        if signal_tp and entry and not reverse and abs(trade_tp - signal_tp) / signal_tp > 0.0000001:
            move = abs(trade_tp - entry) / entry * 100
            span = abs(signal_tp - entry)
            path_used = abs(trade_tp - entry) / span * 100 if span else 100
            notes.append(
                f"Тейк на бирже стоит на {path_used:.0f}% пути сигнала: {_price(trade_tp)} вместо {_price(signal_tp)}. "
                f"Это {move:.2f}% цены. Стоп сигнала остаётся."
            )
        elif reverse and signal_sl and entry and abs(trade_tp - signal_sl) / signal_sl > 0.0000001:
            move = abs(trade_tp - entry) / entry * 100
            span = abs(signal_sl - entry)
            path_used = abs(trade_tp - entry) / span * 100 if span else 100
            notes.append(
                f"Это {path_used:.0f}% пути до стопа сигнала, {_price(trade_tp)} вместо {_price(signal_sl)}. "
                f"Ход цены {move:.2f}%."
            )
        if goal is not None:
            notes.append(
                f"Если плюс на бирже дойдёт до {goal:.2f} USDT, это {share:g}% ставки, закрою раньше."
            )
        note = " ".join(notes) or None
        self._add({
            "id": uuid.uuid4().hex[:10],
            "signal_id": signal["id"],
            "symbol": signal["symbol"],
            "side": side,
            "reversed": reverse,
            "style": signal.get("style"),
            "leverage": leverage,
            "wallet_pct": float(pct),
            "notional": round(_num(notional), 4),
            "margin_usdt": round(_num(margin), 4) if leverage else None,
            "signal_created_at": signal.get("created_at"),
            "exit_wait": False,
            "exit_target": None,
            "profit_close_usdt": goal,
            "closing": False,
            "quantity": result.get("quantity"),
            "order_id": order_id,
            "opened_at": opened_ms / 1000,
            "opened_at_ms": opened_ms,
            "entry_price": round(_num(quote / qty), 8) if qty else None,
            "status": "open",
            "error": None,
            "skip_reason": None,
            "warning": result.get("warning"),
            "gross_pnl": None,
            "commission": None,
            "funding": None,
            "net_pnl": None,
            "unrealized_pnl": None,
            "open_commission": round(_num(commission), 4) if fills else None,
            "closed_at": None,
            "created_at": time.time(),
            "settle_note": note,
        })

    def report(self) -> dict:
        payload = summarize(self.trades)
        payload["error"] = self.error
        payload["trades"] = self.trades
        return payload


book = AutoBook()
