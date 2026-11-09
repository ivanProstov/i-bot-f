"""Вход в локатор по двум токенам из окружения.

LOCATOR_TOKEN — полный доступ.
LOCATOR_VIEW_TOKEN — только просмотр: читать можно, менять и торговать нельзя.
Значения берутся из окружения процесса, а если их там нет — из файла .env в корне проекта.
Сами токены в ответы и логи не попадают.
"""

import hmac
import logging
import os
from pathlib import Path

from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

log = logging.getLogger("locator.auth")
ROOT = Path(__file__).resolve().parent.parent
ENV_PATH = ROOT / ".env"


def _load_dotenv() -> None:
    if not ENV_PATH.exists():
        return
    for raw in ENV_PATH.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        if line.startswith("export "):
            line = line[len("export "):].strip()
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key:
            os.environ.setdefault(key, value)


def _match(token: str, expected: str) -> bool:
    if not token or not expected:
        return False
    return hmac.compare_digest(token.encode(), expected.encode())


_load_dotenv()
FULL_TOKEN = os.environ.get("LOCATOR_TOKEN", "").strip()
VIEW_TOKEN = os.environ.get("LOCATOR_VIEW_TOKEN", "").strip()

if FULL_TOKEN and VIEW_TOKEN and _match(FULL_TOKEN, VIEW_TOKEN):
    log.warning("LOCATOR_VIEW_TOKEN совпадает с LOCATOR_TOKEN, режим просмотра недоступен")


def configured() -> bool:
    return bool(FULL_TOKEN or VIEW_TOKEN)


def role_for(token: str) -> str | None:
    token = token.strip()
    if _match(token, FULL_TOKEN):
        return "full"
    if _match(token, VIEW_TOKEN):
        return "view"
    return None


def bearer_token(request: Request) -> str:
    header = request.headers.get("authorization", "")
    if header.lower().startswith("bearer "):
        return header[7:].strip()
    return ""


# Просмотр читает локатор. Всё, что меняет бота или счёт, только у полного токена.
_VIEW_BLOCKED_PREFIXES = ("/api/trade",)


class AuthMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        path = request.url.path
        if not path.startswith("/api/") or path == "/api/auth/login":
            return await call_next(request)
        if request.method == "OPTIONS":
            return await call_next(request)

        if not configured():
            return JSONResponse(
                {"detail": "Токены локатора не заданы: LOCATOR_TOKEN и LOCATOR_VIEW_TOKEN"},
                status_code=503,
            )

        role = role_for(bearer_token(request))
        if role is None:
            return JSONResponse({"detail": "Нужен токен"}, status_code=401)

        if role == "view" and (
            request.method not in ("GET", "HEAD")
            or any(path.startswith(prefix) for prefix in _VIEW_BLOCKED_PREFIXES)
        ):
            return JSONResponse(
                {"detail": "Режим просмотра: менять локатор и открывать сделки нельзя"},
                status_code=403,
            )

        request.state.role = role
        return await call_next(request)
