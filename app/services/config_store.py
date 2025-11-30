from __future__ import annotations

from datetime import datetime, timezone
import json
from typing import Dict, Optional

from app.db.database import get_connection, init_db

init_db()

PROMPT_SETTING_NAME = "system_prompt"
GEMINI_CONFIG_NAME = "gemini_config"

def _row_to_dict(row) -> dict:
    return {
        "name": row["name"],
        "label": row["label"],
        "value": row["value"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def list_api_keys() -> Dict[str, dict]:
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT name, label, value, created_at, updated_at FROM api_keys ORDER BY name"
        ).fetchall()
    return {row["name"]: _row_to_dict(row) for row in rows}


def set_api_key(name: str, value: str, label: Optional[str] = None) -> dict:
    if not name:
        raise ValueError("API key name cannot be empty")
    normalized = name.strip().lower()
    now = datetime.now(timezone.utc).isoformat()
    if not value:
        raise ValueError("API key value cannot be empty")
    with get_connection() as conn:
        existing = conn.execute(
            "SELECT label FROM api_keys WHERE name = ?", (normalized,)
        ).fetchone()
        effective_label = label or (existing["label"] if existing else normalized)
        conn.execute(
            """
            INSERT INTO api_keys (name, label, value, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(name) DO UPDATE
            SET label=excluded.label,
                value=excluded.value,
                updated_at=excluded.updated_at
            """,
            (normalized, effective_label, value, now, now),
        )
        conn.commit()
        row = conn.execute(
            "SELECT name, label, value, created_at, updated_at FROM api_keys WHERE name = ?",
            (normalized,),
        ).fetchone()
    return _row_to_dict(row)


def delete_api_key(name: str) -> None:
    if not name:
        return
    normalized = name.strip().lower()
    with get_connection() as conn:
        conn.execute("DELETE FROM api_keys WHERE name = ?", (normalized,))
        conn.commit()


def get_api_key_value(name: str) -> Optional[str]:
    if not name:
        return None
    normalized = name.strip().lower()
    with get_connection() as conn:
        row = conn.execute(
            "SELECT value FROM api_keys WHERE name = ?", (normalized,)
        ).fetchone()
    return row["value"] if row else None


def _setting_row_to_dict(row) -> dict:
    return {"name": row["name"], "value": row["value"], "updated_at": row["updated_at"]}


def get_setting(name: str) -> Optional[dict]:
    if not name:
        return None
    with get_connection() as conn:
        row = conn.execute(
            "SELECT name, value, updated_at FROM settings WHERE name = ?", (name,)
        ).fetchone()
    return _setting_row_to_dict(row) if row else None


def set_setting(name: str, value: str) -> dict:
    if not name:
        raise ValueError("Setting name cannot be empty")
    now = datetime.now(timezone.utc).isoformat()
    with get_connection() as conn:
        conn.execute(
            """
            INSERT INTO settings (name, value, updated_at)
            VALUES (?, ?, ?)
            ON CONFLICT(name) DO UPDATE
            SET value=excluded.value,
                updated_at=excluded.updated_at
            """,
            (name, value, now),
        )
        conn.commit()
        row = conn.execute(
            "SELECT name, value, updated_at FROM settings WHERE name = ?", (name,)
        ).fetchone()
    return _setting_row_to_dict(row)


def get_system_prompt_text(default_text: str = "") -> str:
    record = get_setting(PROMPT_SETTING_NAME)
    if record and record.get("value") is not None:
        return record["value"]
    return default_text


def get_system_prompt(default_text: str = "") -> dict:
    record = get_setting(PROMPT_SETTING_NAME)
    if record:
        return record
    return {"name": PROMPT_SETTING_NAME, "value": default_text, "updated_at": None}


def set_system_prompt(value: str) -> dict:
    return set_setting(PROMPT_SETTING_NAME, value)


def delete_setting(name: str) -> None:
    if not name:
        return
    with get_connection() as conn:
        conn.execute("DELETE FROM settings WHERE name = ?", (name,))
        conn.commit()


def reset_system_prompt() -> None:
    delete_setting(PROMPT_SETTING_NAME)


def get_gemini_config() -> dict:
    record = get_setting(GEMINI_CONFIG_NAME)
    if not record or not record.get("value"):
        return {}
    try:
        return json.loads(record["value"])
    except json.JSONDecodeError:
        return {}


def set_gemini_config(config: dict) -> dict:
    if config is None:
        config = {}
    value = json.dumps(config, ensure_ascii=True)
    return set_setting(GEMINI_CONFIG_NAME, value)
