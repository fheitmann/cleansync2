from __future__ import annotations

import asyncio
import json
import mimetypes
import os
from pathlib import Path
from typing import Any, Dict, List, Optional

from google import genai
from google.genai import types
from pydantic import ValidationError

from app.models.schemas import (
    ALL_DAYS,
    CleaningPlan,
    CleaningPlanEntry,
    FloorPlanOptions,
    Room,
)
from app.services import config_store

DEFAULT_MODEL = "gemini-3-pro-preview"
DEFAULT_KEY_NAME = "gemini"
DAY_ALIASES = {
    "MONDAY": "MAN",
    "MON": "MAN",
    "TUESDAY": "TIRS",
    "TUE": "TIRS",
    "WEDNESDAY": "ONS",
    "WED": "ONS",
    "THURSDAY": "TORS",
    "THU": "TORS",
    "FRIDAY": "FRE",
    "FRI": "FRE",
    "SATURDAY": "LØR",
    "SAT": "LØR",
    "SUNDAY": "SØN",
    "SUN": "SØN",
}

try:
    MODALITY_TEXT = types.Modality.TEXT
except AttributeError:  # pragma: no cover - fallback if enum missing
    MODALITY_TEXT = "TEXT"

def _extract_json_blob(text: str) -> str:
    snippet = text.strip()
    if "```" in snippet:
        fence_start = snippet.find("```")
        fence_end = snippet.rfind("```")
        if fence_end > fence_start:
            inner = snippet[fence_start + 3 : fence_end]
            if inner.startswith("json"):
                inner = inner[4:]
            snippet = inner.strip()
    return snippet


def _load_json(text: str) -> Dict[str, Any]:
    snippet = _extract_json_blob(text) or "{}"
    try:
        data = json.loads(snippet)
    except json.JSONDecodeError as exc:
        raise RuntimeError("Gemini response was not valid JSON") from exc
    if not isinstance(data, dict):
        return {"entries": data}
    return data


class GeminiClient:
    def __init__(
        self,
        prompt_path: Path | str = "prompt.txt",
        model_name: str = DEFAULT_MODEL,
        key_name: str = DEFAULT_KEY_NAME,
    ) -> None:
        prompt_file = Path(prompt_path)
        self.default_prompt_text = (
            prompt_file.read_text(encoding="utf-8") if prompt_file.exists() else ""
        )
        self.model_name = model_name
        self.key_name = key_name
        self._client: Optional[genai.Client] = None
        self._cached_key: Optional[str] = None
        self._prompt_path = prompt_file

    def _get_prompt_text(self) -> str:
        return config_store.get_system_prompt_text(self.default_prompt_text)

    def _resolve_api_key(self) -> str:
        env_value = os.getenv("GEMINI_API_KEY")
        if env_value:
            return env_value
        stored = config_store.get_api_key_value(self.key_name)
        if stored:
            return stored
        raise RuntimeError(
            "Gemini API key is not configured. Set GEMINI_API_KEY or add one via /admin."
        )

    def _get_client(self) -> genai.Client:
        key = self._resolve_api_key()
        if self._client is None or self._cached_key != key:
            self._client = genai.Client(api_key=key)
            self._cached_key = key
        return self._client

    async def _call_model(
        self,
        parts: List[types.Part],
        *,
        response_mime_type: Optional[str] = None,
        response_json_schema: Optional[Dict[str, Any]] = None,
    ) -> str:
        def _run() -> str:
            client = self._get_client()
            base_config = types.GenerateContentConfig(
                response_modalities=[MODALITY_TEXT],
                temperature=0.3,
                top_p=0.9,
            )
            config_data = base_config.model_dump()
            config_fields = getattr(
                types.GenerateContentConfig,
                "model_fields",
                getattr(types.GenerateContentConfig, "__fields__", {}),
            )
            overrides = config_store.get_gemini_config()
            if overrides.get("temperature") is not None:
                config_data["temperature"] = overrides["temperature"]
            if overrides.get("top_p") is not None:
                config_data["top_p"] = overrides["top_p"]
            media_level = overrides.get("media_resolution")
            if media_level:
                level = str(media_level).strip().lower()
                media_map = {
                    "low": getattr(types.MediaResolution, "MEDIA_RESOLUTION_LOW", None),
                    "medium": getattr(
                        types.MediaResolution, "MEDIA_RESOLUTION_MEDIUM", None
                    ),
                    "high": getattr(
                        types.MediaResolution, "MEDIA_RESOLUTION_HIGH", None
                    ),
                }
                media_enum = media_map.get(level)
                if media_enum is not None:
                    config_data["media_resolution"] = media_enum
            if response_mime_type:
                config_data["response_mime_type"] = response_mime_type
            if response_json_schema and "response_json_schema" in config_fields:
                config_data["response_json_schema"] = response_json_schema
            config = types.GenerateContentConfig(**config_data)
            response = client.models.generate_content(
                model=self.model_name,
                contents=parts,
                config=config,
            )
            return getattr(response, "text", None) or getattr(
                response, "output_text", ""
            )

        return await asyncio.to_thread(_run)

    @staticmethod
    def _to_bool(value: Any) -> bool:
        if isinstance(value, str):
            return value.strip().lower() in {"1", "true", "x", "yes", "on"}
        return bool(value)

    @staticmethod
    def _parse_rooms(payload: Any, fallback_id_prefix: str) -> List[Room]:
        if isinstance(payload, dict):
            rooms_data = payload.get("rooms") or payload.get("entries") or []
        else:
            rooms_data = payload
        rooms: List[Room] = []
        for idx, item in enumerate(rooms_data):
            if not isinstance(item, dict):
                continue
            room_id = (
                item.get("id")
                or item.get("room_id")
                or f"{fallback_id_prefix}-{idx}"
            )
            rooms.append(
                Room(
                    id=str(room_id),
                    name=item.get("name") or item.get("room_name") or f"Rom {idx+1}",
                    type=item.get("type") or item.get("category") or "kontor",
                    floor=item.get("floor") or item.get("level") or "1 ETG",
                    area_m2=item.get("area_m2"),
                    notes=item.get("notes"),
                )
            )
        return rooms

    @staticmethod
    def _build_plan_from_dict(payload: Any, default_template: str) -> CleaningPlan:
        if isinstance(payload, dict):
            entries_data = payload.get("entries") or payload.get("rooms") or []
            total_area = payload.get("total_area_m2")
            template_label = payload.get("template_name") or default_template
        else:
            entries_data = payload
            total_area = None
            template_label = default_template
        entries: List[CleaningPlanEntry] = []
        for entry in entries_data:
            if not isinstance(entry, dict):
                continue
            # Normalize possible keys from older prompts
            room_name = (
                entry.get("room_name")
                or entry.get("name")
                or entry.get("area")
                or "Rom"
            )
            area = entry.get("area_m2") or entry.get("area") or entry.get("square_meters")
            area_value: Optional[float] = None
            if isinstance(area, (int, float)):
                area_value = float(area)
            elif isinstance(area, str):
                cleaned = area.replace(",", ".").split()[0]
                try:
                    area_value = float(cleaned)
                except ValueError:
                    area_value = None
            floor = entry.get("floor") or entry.get("etg")
            description = entry.get("description") or entry.get("descr") or ""
            raw_frequency = entry.get("frequency")
            frequency: Dict[str, bool] = {}
            if isinstance(raw_frequency, dict):
                for key, value in raw_frequency.items():
                    if not isinstance(key, str):
                        continue
                    normalized = DAY_ALIASES.get(key.strip().upper(), key.strip().upper())
                    if normalized in ALL_DAYS:
                        frequency[normalized] = GeminiClient._to_bool(value)
            for key, value in entry.items():
                if not isinstance(key, str):
                    continue
                normalized = DAY_ALIASES.get(key.strip().upper(), key.strip().upper())
                if normalized in ALL_DAYS and normalized not in frequency:
                    frequency[normalized] = GeminiClient._to_bool(value)
            notes = entry.get("notes")
            entries.append(
                CleaningPlanEntry(
                    room_name=str(room_name),
                    area_m2=area_value,
                    floor=floor,
                    description=str(description),
                    frequency=frequency,
                    notes=notes,
                )
            )
        total_area_resolved = total_area or sum(entry.area_m2 or 0 for entry in entries)
        return CleaningPlan(
            entries=entries,
            total_area_m2=total_area_resolved,
            template_name=template_label,
        )

    async def analyze_floorplan(
        self, file_path: Path, options: FloorPlanOptions
    ) -> List[Room]:
        file_bytes = file_path.read_bytes()
        mime_type, _ = mimetypes.guess_type(file_path.name)
        mime = mime_type or "application/octet-stream"
        base_prompt = self._get_prompt_text()
        instruction = (
            f"{base_prompt}\n"
            "Du får en plantegning som bilde/PDF. Ekstraher et strukturert JSON-objekt med nøkkelen 'rooms'. "
            "Hver room skal ha feltene id, name, type, floor, area_m2 (kan være null) og notes (kan være tomt). "
            f"has_room_names={options.has_room_names}, has_area={options.has_area}, reference_unit={options.reference_unit}. "
            "Svar kun med JSON."
        )
        parts = [
            types.Part.from_bytes(data=file_bytes, mime_type=mime),
            types.Part(text=instruction),
        ]
        raw_response = await self._call_model(parts)
        payload = _load_json(raw_response)
        return self._parse_rooms(payload, file_path.stem)

    async def analyze_template(self, template_path: Path) -> str:
        return template_path.stem.replace("_", " ")

    async def generate_plan(
        self, rooms: List[Room], template_name: Optional[str] = None
    ) -> CleaningPlan:
        rooms_payload = [room.model_dump() for room in rooms]
        template_label = template_name or "Cleansync Standard"
        base_prompt = self._get_prompt_text()
        instruction = (
            f"{base_prompt}\n"
            "Du får en liste med rom i JSON-format. Returner et JSON-objekt med nøklene 'entries', "
            "'total_area_m2' og 'template_name'. "
            "Hver entry skal inneholde room_name, area_m2, floor, description, frequency (map med MAN..SON), "
            f"og optional notes. Bruk mal: {template_label}. "
            "Svar kun som JSON."
        )
        content = json.dumps({"rooms": rooms_payload}, ensure_ascii=True)
        parts = [
            types.Part(text=content),
            types.Part(text=instruction),
        ]
        raw_response = await self._call_model(
            parts,
            response_mime_type="application/json",
            response_json_schema=CleaningPlan.model_json_schema(),
        )
        try:
            return CleaningPlan.model_validate_json(raw_response)
        except ValidationError:
            data = _load_json(raw_response)
            return self._build_plan_from_dict(data, template_label)

    async def convert_to_cleansync(self, raw_text: str) -> CleaningPlan:
        base_prompt = self._get_prompt_text()
        instruction = (
            f"{base_prompt}\n"
            "Normaliser teksten til Cleansync-standard og returner JSON med samme format som generate_plan "
            "(entries/total_area_m2/template_name)."
        )
        parts = [
            types.Part(text=raw_text),
            types.Part(text=instruction),
        ]
        raw_response = await self._call_model(
            parts,
            response_mime_type="application/json",
            response_json_schema=CleaningPlan.model_json_schema(),
        )
        try:
            return CleaningPlan.model_validate_json(raw_response)
        except ValidationError:
            data = _load_json(raw_response)
            return self._build_plan_from_dict(data, "Cleansync Standard")
