from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from uuid import uuid4

from app.db.database import get_connection, init_db
from app.models.schemas import CleaningPlan

init_db()


def _serialize_payload(payload: Optional[Any]) -> Optional[str]:
    if payload is None:
        return None
    try:
        return json.dumps(payload, ensure_ascii=True, default=str)
    except TypeError:
        return json.dumps(str(payload), ensure_ascii=True)


def save_plan(
    source: str,
    request_payload: Optional[Any],
    plan: CleaningPlan,
    docx_id: Optional[str] = None,
    metadata: Optional[dict] = None,
    generation_ms: Optional[int] = None,
) -> str:
    plan_id = uuid4().hex
    now = datetime.now(timezone.utc).isoformat()
    payload_json = _serialize_payload(request_payload)
    metadata_json = _serialize_payload(metadata)
    plan_json = plan.model_dump_json()
    with get_connection() as conn:
        conn.execute(
            """
            INSERT INTO generated_plans (id, source, request_payload, plan_json, docx_id, metadata, created_at, generation_ms)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                plan_id,
                source,
                payload_json,
                plan_json,
                docx_id,
                metadata_json,
                now,
                generation_ms,
            ),
        )
        conn.commit()
    return plan_id


def _ensure_file_count_metadata(
    metadata: Optional[dict], request_payload: Optional[Any]
) -> Optional[dict]:
    if not request_payload:
        return metadata
    try:
        payload_obj = (
            request_payload
            if isinstance(request_payload, dict)
            else json.loads(request_payload)
        )
    except Exception:  # pragma: no cover - defensive
        return metadata
    file_ids = payload_obj.get("file_ids") if isinstance(payload_obj, dict) else None
    if not isinstance(file_ids, list):
        return metadata
    file_count = len(file_ids)
    if file_count <= 0:
        return metadata
    merged = dict(metadata or {})
    merged.setdefault("file_count", file_count)
    return merged


def list_plans(limit: int = 20) -> List[Dict[str, Any]]:
    with get_connection() as conn:
        rows = conn.execute(
            """
            SELECT id, source, docx_id, metadata, request_payload, created_at, generation_ms
            FROM generated_plans
            ORDER BY datetime(created_at) DESC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()
    plans: List[Dict[str, Any]] = []
    for row in rows:
        request_payload = (
            json.loads(row["request_payload"]) if row["request_payload"] else None
        )
        metadata = json.loads(row["metadata"]) if row["metadata"] else None
        metadata = _ensure_file_count_metadata(metadata, request_payload)
        plans.append(
            {
                "id": row["id"],
                "source": row["source"],
                "docx_id": row["docx_id"],
                "metadata": metadata,
                "request_payload": request_payload,
                "created_at": row["created_at"],
                "generation_ms": row["generation_ms"],
            }
        )
    return plans


def get_plan(plan_id: str) -> Dict[str, Any]:
    with get_connection() as conn:
        row = conn.execute(
            """
            SELECT id, source, request_payload, plan_json, docx_id, metadata, created_at, generation_ms
            FROM generated_plans
            WHERE id = ?
            """,
            (plan_id,),
        ).fetchone()
    if not row:
        raise KeyError(plan_id)
    request_payload = (
        json.loads(row["request_payload"]) if row["request_payload"] else None
    )
    metadata = json.loads(row["metadata"]) if row["metadata"] else None
    metadata = _ensure_file_count_metadata(metadata, request_payload)
    plan = CleaningPlan.model_validate_json(row["plan_json"])
    return {
        "id": row["id"],
        "source": row["source"],
        "plan": plan,
        "docx_id": row["docx_id"],
        "metadata": metadata,
        "request_payload": request_payload,
        "created_at": row["created_at"],
        "generation_ms": row["generation_ms"],
    }
