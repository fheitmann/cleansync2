from __future__ import annotations

import asyncio
import hashlib
import inspect
import json
import logging
import mimetypes
import os
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

from google import genai
from google.genai import types

from app.models.schemas import CleaningPlan, FloorPlanExtraction, FloorPlanOptions, Room
from app.services import config_store

DEFAULT_MODEL = "gemini-3-pro-preview"
DEFAULT_KEY_NAME = "gemini"

try:
    MODALITY_TEXT = types.Modality.TEXT
except AttributeError:  # pragma: no cover - fallback if enum missing
    MODALITY_TEXT = "TEXT"

logger = logging.getLogger(__name__)


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
        self._context_cache_ids: Dict[str, str] = {}

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
            self._client = genai.Client(
                api_key=key, http_options={"api_version": "v1alpha"}
            )
            self._cached_key = key
        return self._client

    @staticmethod
    def _cache_key(label: str, payload: str) -> str:
        digest = hashlib.sha1(payload.encode("utf-8")).hexdigest()
        return f"{label}:{digest}"

    async def _ensure_cached_instruction(
        self, label: str, instruction_text: str
    ) -> Optional[str]:
        normalized = instruction_text.strip()
        if not normalized:
            return None
        cache_key = self._cache_key(label, normalized)
        if cache_key in self._context_cache_ids:
            return self._context_cache_ids[cache_key]

        cache_parts = [
            types.Content(
                role="user",
                parts=[types.Part(text=normalized)],
            )
        ]

        def _create() -> Optional[str]:
            try:
                client = self._get_client()
                try:
                    response = client.caches.create(
                        model=self.model_name,
                        contents=cache_parts,
                        config={
                            "display_name": f"cleansync-{label}",
                            "ttl": "86400s",
                        },
                    )
                except TypeError as exc:
                    sig = inspect.signature(client.caches.create)
                    if "contents" in sig.parameters:
                        raise
                    response = client.caches.create(
                        model=self.model_name,
                        config={
                            "display_name": f"cleansync-{label}",
                            "ttl": "86400s",
                            "contents": cache_parts,
                        },
                    )
                return response.name
            except Exception as exc:  # pragma: no cover - network failure
                logger.warning("Failed to create context cache %s: %s", label, exc)
                return None

        cache_name = await asyncio.to_thread(_create)
        if cache_name:
            self._context_cache_ids[cache_key] = cache_name
        return cache_name

    @staticmethod
    def _media_resolution_value(
        value: Optional[Any],
    ) -> Optional[Any]:
        if value is None:
            return None
        part_level_enum = getattr(types, "PartMediaResolutionLevel", None)
        if part_level_enum and isinstance(part_level_enum, type):
            if isinstance(value, part_level_enum):
                return value
        normalized = str(value).strip().lower()
        attr_map = {
            "low": "MEDIA_RESOLUTION_LOW",
            "medium": "MEDIA_RESOLUTION_MEDIUM",
            "high": "MEDIA_RESOLUTION_HIGH",
        }
        target = attr_map.get(normalized)
        if not target:
            return None

        if part_level_enum is not None:
            try:
                return getattr(part_level_enum, target)
            except AttributeError:
                pass
        return target

    def _build_generation_config(
        self,
        *,
        response_mime_type: Optional[str] = None,
        response_json_schema: Optional[Dict[str, Any]] = None,
        cached_content: Optional[str] = None,
    ) -> types.GenerateContentConfig:
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
        if response_mime_type:
            config_data["response_mime_type"] = response_mime_type
        if response_json_schema and "response_json_schema" in config_fields:
            config_data["response_json_schema"] = response_json_schema
        if cached_content:
            config_data["cached_content"] = cached_content
        return types.GenerateContentConfig(**config_data)

    async def _call_model(
        self,
        contents: List[types.Content],
        *,
        response_mime_type: Optional[str] = None,
        response_json_schema: Optional[Dict[str, Any]] = None,
        cached_content: Optional[str] = None,
    ) -> str:
        def _run() -> str:
            client = self._get_client()
            config = self._build_generation_config(
                response_mime_type=response_mime_type,
                response_json_schema=response_json_schema,
                cached_content=cached_content,
            )
            if logger.isEnabledFor(logging.DEBUG):  # pragma: no cover - debug only
                logger.debug(
                    "Calling model %s with config: %s",
                    self.model_name,
                    config.model_dump(exclude_none=True),
                )
            response = client.models.generate_content(
                model=self.model_name,
                contents=contents,
                config=config,
            )
            # Thought signatures are managed by the SDK for these single-turn calls.
            return getattr(response, "text", None) or getattr(
                response, "output_text", ""
            )

        return await asyncio.to_thread(_run)

    @staticmethod
    def _to_bool(value: Any) -> bool:
        if isinstance(value, str):
            return value.strip().lower() in {"1", "true", "x", "yes", "on"}
        return bool(value)

    async def analyze_floorplan(
        self, file_path: Path, options: FloorPlanOptions
    ) -> List[Room]:
        file_bytes = file_path.read_bytes()
        mime_type, _ = mimetypes.guess_type(file_path.name)
        mime = mime_type or "application/octet-stream"
        base_prompt = self._get_prompt_text()
        base_instruction = (
            f"{base_prompt}\n"
            "Du får en plantegning som bilde eller PDF. Ekstraher et strukturert JSON-objekt med nøkkelen 'rooms'. "
            "Hver room skal ha feltene id, name, type, floor, area_m2 (kan være null) og notes (kan være tomt). "
            "Svar kun med JSON."
        )
        cached_instruction = await self._ensure_cached_instruction(
            "floorplan-analysis", base_instruction
        )
        details = [
            f"has_room_names={options.has_room_names}, has_area={options.has_area}, reference_unit={options.reference_unit}."
        ]
        if not options.has_area:
            if options.reference_label and options.reference_width:
                details.append(
                    f"Bruk referansemål: {options.reference_label} med bredde {options.reference_width}{options.reference_unit} for å estimere m²."
                )
            elif options.reference_width:
                details.append(
                    f"Bruk referansemål med bredde {options.reference_width}{options.reference_unit} for å estimere m²."
                )
            elif options.reference_label:
                details.append(
                    f"Bruk referansemål: {options.reference_label} for å estimere m²."
                )
        config_payload = {
            "floorplan_config": {
                "has_room_names": options.has_room_names,
                "has_area": options.has_area,
                "reference_unit": options.reference_unit,
                "reference_label": options.reference_label,
                "reference_width": options.reference_width,
            }
        }
        overrides = config_store.get_gemini_config()
        override_media = self._media_resolution_value(overrides.get("media_resolution"))
        parts: List[types.Part] = []
        if cached_instruction is None:
            parts.append(types.Part(text=base_instruction))
        media_level = None
        if mime.startswith("image/"):
            media_level = self._media_resolution_value("high")
        elif mime == "application/pdf":
            media_level = self._media_resolution_value("medium")
        resolved_media = override_media or media_level
        inline_kwargs: Dict[str, Any] = {}
        if resolved_media is not None:
            inline_kwargs["media_resolution"] = types.PartMediaResolution(
                level=resolved_media
            )
        parts.extend(
            [
                types.Part(text=json.dumps(config_payload, ensure_ascii=True)),
                types.Part(text="\n".join(details)),
                types.Part(
                    inline_data=types.Blob(
                        mime_type=mime,
                        data=file_bytes,
                    ),
                    **inline_kwargs,
                ),
            ]
        )
        content = types.Content(role="user", parts=parts)
        raw_response = await self._call_model(
            [content],
            response_mime_type="application/json",
            response_json_schema=FloorPlanExtraction.model_json_schema(),
            cached_content=cached_instruction,
        )
        extraction = FloorPlanExtraction.model_validate_json(raw_response)
        return extraction.rooms

    async def analyze_template(self, template_path: Path) -> str:
        return template_path.stem.replace("_", " ")

    async def _build_plan_request_parts(
        self, plan_payload: str, template_label: str
    ) -> tuple[List[types.Part], Optional[str]]:
        base_prompt = self._get_prompt_text()
        base_instruction = (
            f"{base_prompt}\n"
            "Du får en liste med rom i JSON-format. Returner et JSON-objekt med nøklene 'entries', "
            "'total_area_m2' og 'template_name'. "
            "Hver entry skal inneholde room_name, area_m2, floor, description, frequency (map med MAN..SON), "
            "og optional notes. Svar kun som JSON."
        )
        cached_instruction = await self._ensure_cached_instruction(
            "plan-generation", base_instruction
        )
        parts: List[types.Part] = []
        if cached_instruction is None:
            parts.append(types.Part(text=base_instruction))
        parts.extend(
            [
                types.Part(text=plan_payload),
                types.Part(text=f"Bruk mal: {template_label}."),
            ]
        )
        return parts, cached_instruction

    async def generate_plan(
        self, rooms: List[Room], template_name: Optional[str] = None
    ) -> CleaningPlan:
        rooms_payload = [room.model_dump() for room in rooms]
        template_label = template_name or "Cleansync Standard"
        plan_payload = json.dumps({"rooms": rooms_payload}, ensure_ascii=True)
        parts, cached_instruction = await self._build_plan_request_parts(
            plan_payload, template_label
        )
        content = types.Content(role="user", parts=parts)
        raw_response = await self._call_model(
            [content],
            response_mime_type="application/json",
            response_json_schema=CleaningPlan.model_json_schema(),
            cached_content=cached_instruction,
        )
        return CleaningPlan.model_validate_json(raw_response)

    async def generate_plan_batch(
        self, room_batches: List[List[Room]], template_name: Optional[str] = None
    ) -> List[CleaningPlan]:
        if not room_batches:
            return []
        template_label = template_name or "Cleansync Standard"
        inlined_requests: List[types.InlinedRequest] = []
        for rooms in room_batches:
            plan_payload = json.dumps(
                {"rooms": [room.model_dump() for room in rooms]}, ensure_ascii=True
            )
            parts, cached_instruction = await self._build_plan_request_parts(
                plan_payload, template_label
            )
            content = types.Content(role="user", parts=parts)
            config = self._build_generation_config(
                response_mime_type="application/json",
                response_json_schema=CleaningPlan.model_json_schema(),
                cached_content=cached_instruction,
            )
            inlined_requests.append(
                types.InlinedRequest(
                    model=self.model_name,
                    contents=[content],
                    config=config,
                )
            )

        def _run_requests() -> types.BatchJob:
            client = self._get_client()
            job = client.batches.create(model=self.model_name, src=inlined_requests)
            while not job.done:
                time.sleep(2)
                job = client.batches.get(name=job.name)
            if job.error:
                raise RuntimeError(job.error.message or "Batch job failed")
            return job

        job = await asyncio.to_thread(_run_requests)
        if not job.dest or not job.dest.inlined_responses:
            raise RuntimeError("Batch job returned no inline responses")
        plans: List[CleaningPlan] = []
        for index, inline in enumerate(job.dest.inlined_responses):
            if inline.error:
                raise RuntimeError(
                    inline.error.message or f"Batch item {index} failed unexpectedly"
                )
            if not inline.response:
                raise RuntimeError(f"Batch item {index} did not return a response")
            response = inline.response
            if response.parsed:
                plans.append(CleaningPlan.model_validate(response.parsed))
            else:
                text_payload = response.text or getattr(response, "output_text", "")
                plans.append(CleaningPlan.model_validate_json(text_payload))
        return plans

    async def convert_to_cleansync(self, raw_text: str) -> CleaningPlan:
        base_prompt = self._get_prompt_text()
        base_instruction = (
            f"{base_prompt}\n"
            "Normaliser teksten til Cleansync-standard og returner JSON med samme format som generate_plan "
            "(entries/total_area_m2/template_name)."
        )
        cached_instruction = await self._ensure_cached_instruction(
            "plan-converter", base_instruction
        )
        parts: List[types.Part] = []
        if cached_instruction is None:
            parts.append(types.Part(text=base_instruction))
        parts.append(types.Part(text=raw_text))
        content = types.Content(role="user", parts=parts)
        raw_response = await self._call_model(
            [content],
            response_mime_type="application/json",
            response_json_schema=CleaningPlan.model_json_schema(),
            cached_content=cached_instruction,
        )
        return CleaningPlan.model_validate_json(raw_response)
