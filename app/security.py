from __future__ import annotations

import base64
import binascii
import os

from fastapi import FastAPI
from starlette.requests import Request
from starlette.responses import Response

DEFAULT_USERNAME = "describe"
DEFAULT_PASSWORD = "it"
REALM = "CleanSync"


def _get_expected_credentials() -> tuple[str, str]:
    username = os.getenv("BASIC_AUTH_USERNAME", DEFAULT_USERNAME)
    password = os.getenv("BASIC_AUTH_PASSWORD", DEFAULT_PASSWORD)
    return username, password


def _is_authorized(auth_header: str | None, username: str, password: str) -> bool:
    if not auth_header or not auth_header.startswith("Basic "):
        return False
    encoded = auth_header.split(" ", 1)[1]
    try:
        decoded = base64.b64decode(encoded).decode("utf-8")
    except (binascii.Error, UnicodeDecodeError):
        return False
    provided_username, _, provided_password = decoded.partition(":")
    return provided_username == username and provided_password == password


def apply_basic_auth(app: FastAPI) -> None:
    username, password = _get_expected_credentials()
    requires_auth = bool(username or password)
    challenge_headers = {"WWW-Authenticate": f'Basic realm="{REALM}"'}

    @app.middleware("http")
    async def _basic_auth_middleware(request: Request, call_next):
        if not requires_auth:
            return await call_next(request)
        if _is_authorized(request.headers.get("Authorization"), username, password):
            return await call_next(request)
        return Response(status_code=401, headers=challenge_headers)
