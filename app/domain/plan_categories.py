from __future__ import annotations

import json
from pathlib import Path
from typing import Dict, List, Optional

_PLAN_CATEGORY_PATH = Path(__file__).resolve().parents[2] / "plan_categories.json"


def _load_categories() -> List[Dict[str, str]]:
    try:
        raw = _PLAN_CATEGORY_PATH.read_text(encoding="utf-8")
    except FileNotFoundError:  # pragma: no cover - configuration error
        return []
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:  # pragma: no cover - configuration error
        raise RuntimeError(f"Invalid plan_categories.json: {exc}") from exc
    filtered: List[Dict[str, str]] = []
    for entry in data:
        if (
            isinstance(entry, dict)
            and entry.get("id")
            and entry.get("no")
            and entry.get("en")
        ):
            filtered.append(entry)
    return filtered


PLAN_CATEGORY_LIST = _load_categories()
PLAN_CATEGORY_LOOKUP: Dict[str, Dict[str, str]] = {
    entry["id"]: entry for entry in PLAN_CATEGORY_LIST
}
PLAN_CATEGORY_IDS = set(PLAN_CATEGORY_LOOKUP)


def get_plan_category(category_id: Optional[str]) -> Optional[Dict[str, str]]:
    if category_id is None:
        return None
    return PLAN_CATEGORY_LOOKUP.get(category_id)
