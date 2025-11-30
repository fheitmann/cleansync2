from __future__ import annotations

import sqlite3
from app.services.storage import STORAGE_ROOT

DB_PATH = STORAGE_ROOT / "cleansync.db"


def _ensure_path() -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)


def get_connection() -> sqlite3.Connection:
    _ensure_path()
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    with get_connection() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS api_keys (
                name TEXT PRIMARY KEY,
                label TEXT,
                value TEXT,
                created_at TEXT,
                updated_at TEXT
            );
            CREATE TABLE IF NOT EXISTS settings (
                name TEXT PRIMARY KEY,
                value TEXT,
                updated_at TEXT
            );
            CREATE TABLE IF NOT EXISTS generated_plans (
                id TEXT PRIMARY KEY,
                source TEXT NOT NULL,
                request_payload TEXT,
                plan_json TEXT NOT NULL,
                docx_id TEXT,
                metadata TEXT,
                created_at TEXT,
                generation_ms INTEGER
            );
            """
        )
        # Backfill generation_ms column if database existed before
        try:
            conn.execute(
                "ALTER TABLE generated_plans ADD COLUMN generation_ms INTEGER",
            )
        except sqlite3.OperationalError:
            pass
        conn.commit()
