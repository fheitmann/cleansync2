from __future__ import annotations

from datetime import datetime, timezone
import time
from pathlib import Path
from typing import List

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import FileResponse

from app.models.schemas import (
    APIKeyDeleteResponse,
    APIKeyListResponse,
    APIKeySummary,
    APIKeyUpdateRequest,
    APIKeyUpdateResponse,
    BatchResultsResponse,
    BatchRunRequest,
    BatchStatusResponse,
    ConvertPlanResponse,
    GeminiConfig,
    GeminiConfigResponse,
    GeminiConfigUpdateRequest,
    FloorPlanOptions,
    GeneratePlanRequest,
    GeneratePlanResponse,
    Room,
    SystemPromptResponse,
    SystemPromptUpdateRequest,
    StoredPlanDetailResponse,
    StoredPlanListResponse,
    StoredPlanSummary,
    TemplateMetadata,
    UploadResponse,
)
from app.services.batch_runner import BatchRunner
from app.services.docx_generator import plan_to_docx_bytes
from app.services import config_store, plan_store
from app.services.gemini_client import GeminiClient
from app.services.storage import get_file_path, save_bytes, save_upload_file

PROMPT_FILE = Path("prompt.txt")
DEFAULT_PROMPT_TEXT = (
    PROMPT_FILE.read_text(encoding="utf-8") if PROMPT_FILE.exists() else ""
)

router = APIRouter(prefix="/api")

gemini_client = GeminiClient()
batch_runner = BatchRunner()


@router.get("/")
async def root() -> dict:
    return {"message": "CleanSync API"}


@router.post("/upload/floorplans", response_model=UploadResponse)
async def upload_floorplans(files: List[UploadFile] = File(...)) -> UploadResponse:
    if not files:
        raise HTTPException(status_code=400, detail="No files provided")
    file_ids = [save_upload_file(upload, category="uploads") for upload in files]
    return UploadResponse(file_ids=file_ids)


@router.post("/upload/template", response_model=TemplateMetadata)
async def upload_template(file: UploadFile = File(...)) -> TemplateMetadata:
    file_id = save_upload_file(file, category="templates")
    template_path = get_file_path(file_id)
    template_name = await gemini_client.analyze_template(template_path)
    return TemplateMetadata(template_id=file_id, filename=template_name)


@router.post("/upload/external-plan", response_model=UploadResponse)
async def upload_external_plan(files: List[UploadFile] = File(...)) -> UploadResponse:
    file_ids = [save_upload_file(upload, category="external") for upload in files]
    return UploadResponse(file_ids=file_ids)


async def _process_single_file(file_id: str, options: FloorPlanOptions) -> List[Room]:
    file_path = get_file_path(file_id)
    return await gemini_client.analyze_floorplan(file_path, options)


@router.post("/generate-plan", response_model=GeneratePlanResponse)
async def generate_plan(request: GeneratePlanRequest) -> GeneratePlanResponse:
    if not request.file_ids:
        raise HTTPException(status_code=400, detail="file_ids is required")
    started = time.perf_counter()

    rooms = []
    for file_id in request.file_ids:
        rooms.extend(await _process_single_file(file_id, request.options))

    template_name = None
    if request.template_id:
        template_path = get_file_path(request.template_id)
        template_name = await gemini_client.analyze_template(template_path)

    plan = await gemini_client.generate_plan(rooms, template_name=template_name)
    docx_bytes = plan_to_docx_bytes(plan)
    docx_id = save_bytes(docx_bytes, suffix=".docx", category="docx")
    docx_url = f"/download/{docx_id}"
    duration_ms = int((time.perf_counter() - started) * 1000)
    plan_store.save_plan(
        source="generator",
        request_payload=request.model_dump(),
        plan=plan,
        docx_id=docx_id,
        metadata={"template_id": request.template_id},
        generation_ms=duration_ms,
    )
    return GeneratePlanResponse(plan=plan, docx_url=docx_url)


@router.get("/download/{file_id:path}")
async def download_file(file_id: str) -> FileResponse:
    path = get_file_path(file_id)
    return FileResponse(path, filename=path.name)


@router.post("/convert-plan", response_model=ConvertPlanResponse)
async def convert_plan(file: UploadFile = File(...)) -> ConvertPlanResponse:
    started = time.perf_counter()
    raw_bytes = await file.read()
    try:
        text = raw_bytes.decode("utf-8")
    except UnicodeDecodeError:
        text = raw_bytes.decode("latin-1", errors="ignore")
    plan = await gemini_client.convert_to_cleansync(text)
    plan_store.save_plan(
        source="converter",
        request_payload={"filename": file.filename},
        plan=plan,
        docx_id=None,
        generation_ms=int((time.perf_counter() - started) * 1000),
    )
    return ConvertPlanResponse(plan=plan)


@router.post("/batch/run", response_model=BatchStatusResponse)
async def run_batch(request: BatchRunRequest) -> BatchStatusResponse:
    if not request.file_ids:
        raise HTTPException(status_code=400, detail="file_ids is required")

    async def processor(file_id: str, options):
        rooms = await _process_single_file(file_id, options)
        return await gemini_client.generate_plan(rooms)

    async def batch_processor(file_ids: List[str], options: FloorPlanOptions):
        room_batches = []
        for file_id in file_ids:
            room_batches.append(await _process_single_file(file_id, options))
        return await gemini_client.generate_plan_batch(room_batches)

    job = await batch_runner.start_job(
        request.file_ids,
        request.options,
        processor,
        use_batch_api=request.use_batch_api,
        batch_processor=batch_processor if request.use_batch_api else None,
    )
    return BatchStatusResponse(job=job)


@router.get("/batch/status/{job_id}", response_model=BatchStatusResponse)
async def get_batch_status(job_id: str) -> BatchStatusResponse:
    try:
        job = batch_runner.get_status(job_id)
    except KeyError as exc:  # pragma: no cover - simple 404
        raise HTTPException(status_code=404, detail="Job not found") from exc
    return BatchStatusResponse(job=job)


@router.get("/batch/results/{job_id}", response_model=BatchResultsResponse)
async def get_batch_results(job_id: str) -> BatchResultsResponse:
    try:
        job = batch_runner.get_status(job_id)
        plans = batch_runner.get_results(job_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Job not found") from exc
    return BatchResultsResponse(job=job, plans=plans)


def _serialize_api_key(name: str, payload: dict) -> APIKeySummary:
    value = payload.get("value") or ""
    last_four = value[-4:] if len(value) >= 4 else (value if value else None)
    return APIKeySummary(
        name=name,
        label=payload.get("label") or name,
        configured=bool(value),
        last_four=last_four,
        updated_at=payload.get("updated_at"),
    )


@router.get("/admin/api-keys", response_model=APIKeyListResponse)
async def list_api_keys_route() -> APIKeyListResponse:
    all_keys = config_store.list_api_keys()
    summaries = [_serialize_api_key(name, data) for name, data in sorted(all_keys.items())]
    return APIKeyListResponse(api_keys=summaries)


@router.post("/admin/api-keys", response_model=APIKeyUpdateResponse)
async def upsert_api_key(request: APIKeyUpdateRequest) -> APIKeyUpdateResponse:
    normalized = request.name.strip().lower()
    entry = config_store.set_api_key(normalized, request.value, label=request.label)
    summary = _serialize_api_key(normalized, entry)
    return APIKeyUpdateResponse(key=summary)


@router.delete("/admin/api-keys/{name}", response_model=APIKeyDeleteResponse)
async def remove_api_key(name: str) -> APIKeyDeleteResponse:
    normalized = name.strip().lower()
    config_store.delete_api_key(normalized)
    return APIKeyDeleteResponse(name=normalized, deleted=True)


def _prompt_response(record: dict) -> SystemPromptResponse:
    return SystemPromptResponse(
        prompt=record.get("value") or "",
        updated_at=record.get("updated_at"),
        is_overridden=record.get("updated_at") is not None,
    )


@router.get("/admin/system-prompt", response_model=SystemPromptResponse)
async def get_system_prompt() -> SystemPromptResponse:
    record = config_store.get_system_prompt(DEFAULT_PROMPT_TEXT)
    return _prompt_response(record)


@router.post("/admin/system-prompt", response_model=SystemPromptResponse)
async def update_system_prompt(request: SystemPromptUpdateRequest) -> SystemPromptResponse:
    if request.use_default:
        config_store.reset_system_prompt()
        record = config_store.get_system_prompt(DEFAULT_PROMPT_TEXT)
        return _prompt_response(record)
    if request.prompt is None:
        raise HTTPException(status_code=400, detail="prompt is required")
    record = config_store.set_system_prompt(request.prompt)
    return _prompt_response(record)


@router.get("/admin/gemini-config", response_model=GeminiConfigResponse)
async def get_gemini_config_route() -> GeminiConfigResponse:
    raw = config_store.get_gemini_config()
    config = GeminiConfig(**raw)
    return GeminiConfigResponse(config=config)


@router.post("/admin/gemini-config", response_model=GeminiConfigResponse)
async def update_gemini_config_route(request: GeminiConfigUpdateRequest) -> GeminiConfigResponse:
    existing = config_store.get_gemini_config() or {}
    updated = dict(existing)
    for key, value in request.model_dump().items():
        if value is None:
            updated.pop(key, None)
        else:
            updated[key] = value
    config_store.set_gemini_config(updated)
    return GeminiConfigResponse(config=GeminiConfig(**updated))


def _parse_datetime(value: str) -> datetime:
    if not value:
        return datetime.now(timezone.utc)
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        return datetime.now(timezone.utc)


def _plan_summary(record: dict) -> StoredPlanSummary:
    docx_id = record.get("docx_id")
    docx_url = f"/download/{docx_id}" if docx_id else None
    created_at = _parse_datetime(record.get("created_at"))
    generation_ms = record.get("generation_ms")
    generation_seconds = (
        round(generation_ms / 1000, 2) if isinstance(generation_ms, (int, float)) else None
    )
    return StoredPlanSummary(
        id=record.get("id"),
        source=record.get("source"),
        docx_url=docx_url,
        metadata=record.get("metadata"),
        created_at=created_at,
        generation_seconds=generation_seconds,
    )


@router.get("/plans", response_model=StoredPlanListResponse)
async def list_stored_plans(limit: int = 20) -> StoredPlanListResponse:
    records = plan_store.list_plans(limit=limit)
    summaries = [_plan_summary(record) for record in records]
    return StoredPlanListResponse(plans=summaries)


@router.get("/plans/{plan_id}", response_model=StoredPlanDetailResponse)
async def get_stored_plan(plan_id: str) -> StoredPlanDetailResponse:
    try:
        record = plan_store.get_plan(plan_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Plan not found") from exc
    summary = _plan_summary(record)
    return StoredPlanDetailResponse(summary=summary, plan=record["plan"])
