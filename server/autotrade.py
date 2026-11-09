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
MSK = timezone(timedelta(hours=3))
WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"]
MAX_OPEN_PER_TICK = 3


def _fmt_qty(value: Decimal) -> str:
    text = format(value, "f")
    if "." in text:
        text = text.rstrip("0").rstrip(".")
    return text or "0"


def _num(value) -> float:
    return float(Decimal(str(value)))


def exit_target(margin: Decimal, commission: Decimal) -> Decimal:
    """Плюс, которого ждём после минуса: 1% ставки и комиссия, уже взятая биржей."""
    return margin * Decimal("0.01") + commission


def _msk(ts: float) -> datetime:
    return datetime.fromtimestamp(ts, MSK)


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
        rows = [row for row in closed if _msk(row["opened_at"]).hour == hour]
        hours.append(_bucket(rows, hour, f"{hour:02d}"))
    weekdays = []
    for index, name in enumerate(WEEKDAYS):
        rows = [row for row in closed if _msk(row["opened_at"]).weekday() == index]
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

    def _add(self, row: dict):
        self.trades.insert(0, row)
        self._save()

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
            return self._note(trade, None)
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
            try:
                result = await open_position(
                    "demo", signal["symbol"], signal["side"],
                    float(notional), leverage, float(signal["tp"]), float(signal["sl"]),
                )
            except TradeError as exc:
                self._remember_skip(signal, leverage, pct, str(exc), status="error")
                continue
            except Exception as exc:
                self.error = f"Не открыл демо-сделку: {exc}"
                return
            await self._remember_open(signal, result, leverage, pct, notional)
            opened += 1
        if opened:
            self.error = None

    def _remember_skip(self, signal: dict, leverage: int, pct: Decimal, reason: str, status: str = "skipped"):
        self._add({
            "id": uuid.uuid4().hex[:10],
            "signal_id": signal["id"],
            "symbol": signal["symbol"],
            "side": signal["side"],
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

    async def _remember_open(self, signal: dict, result: dict, leverage: int, pct: Decimal, notional: Decimal):
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
        self._add({
            "id": uuid.uuid4().hex[:10],
            "signal_id": signal["id"],
            "symbol": signal["symbol"],
            "side": signal["side"],
            "style": signal.get("style"),
            "leverage": leverage,
            "wallet_pct": float(pct),
            "notional": round(_num(notional), 4),
            "margin_usdt": round(_num(notional / leverage), 4) if leverage else None,
            "signal_created_at": signal.get("created_at"),
            "exit_wait": False,
            "exit_target": None,
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
            "settle_note": None,
        })

    def report(self) -> dict:
        payload = summarize(self.trades)
        payload["error"] = self.error
        payload["trades"] = self.trades
        return payload


book = AutoBook()
