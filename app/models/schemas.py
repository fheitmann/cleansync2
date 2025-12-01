from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field

ALL_DAYS = ["MAN", "TIRS", "ONS", "TORS", "FRE", "LØR", "SØN"]


class Room(BaseModel):
    id: str
    name: str
    type: str = Field(description="High level room type e.g. office, corridor, wc")
    floor: Optional[str] = None
    area_m2: Optional[float] = None
    notes: Optional[str] = None


class CleaningPlanEntry(BaseModel):
    room_name: str
    area_m2: Optional[float]
    floor: Optional[str]
    description: str
    frequency: Dict[str, bool] = Field(
        default_factory=dict,
        description="Mapping of weekday (MAN..SON) to whether cleaning should run",
    )
    notes: Optional[str] = None


class CleaningPlan(BaseModel):
    entries: List[CleaningPlanEntry]
    total_area_m2: float
    template_name: Optional[str] = None


class FloorPlanExtraction(BaseModel):
    rooms: List[Room]


class FloorPlanOptions(BaseModel):
    has_room_names: bool = True
    has_area: bool = True
    reference_label: Optional[str] = None
    reference_width: Optional[float] = None
    reference_unit: str = "m"


class TemplateMetadata(BaseModel):
    template_id: str
    filename: str


class GeneratePlanRequest(BaseModel):
    file_ids: List[str]
    template_id: Optional[str] = None
    options: FloorPlanOptions


class GeneratePlanResponse(BaseModel):
    plan: CleaningPlan
    docx_url: str


class PlanJobStatus(str, Enum):
    pending = "pending"
    running = "running"
    success = "success"
    failed = "failed"


class PlanJob(BaseModel):
    id: str
    status: PlanJobStatus = PlanJobStatus.pending
    docx_url: Optional[str] = None
    message: Optional[str] = None
    detail: Optional[Dict[str, Optional[Any]]] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class GeneratePlanJobResponse(BaseModel):
    job: PlanJob


class GeneratePlanStatusResponse(BaseModel):
    job: PlanJob
    plan: Optional[CleaningPlan] = None
    docx_url: Optional[str] = None


class ConvertPlanResponse(BaseModel):
    plan: CleaningPlan


class UploadResponse(BaseModel):
    file_ids: List[str]


class BatchJobStatus(str, Enum):
    pending = "pending"
    running = "running"
    success = "success"
    failed = "failed"


class BatchJob(BaseModel):
    id: str
    status: BatchJobStatus = BatchJobStatus.pending
    total_files: int = 0
    processed_files: int = 0
    message: Optional[str] = None


class BatchRunRequest(BaseModel):
    file_ids: List[str]
    options: FloorPlanOptions
    use_batch_api: bool = False


class BatchStatusResponse(BaseModel):
    job: BatchJob


class BatchResultsResponse(BaseModel):
    job: BatchJob
    plans: List[CleaningPlan]


class APIKeySummary(BaseModel):
    name: str
    label: str
    configured: bool
    last_four: Optional[str] = None
    updated_at: Optional[datetime] = None


class APIKeyListResponse(BaseModel):
    api_keys: List[APIKeySummary]


class APIKeyUpdateRequest(BaseModel):
    name: str
    value: str
    label: Optional[str] = None


class APIKeyUpdateResponse(BaseModel):
    key: APIKeySummary


class APIKeyDeleteResponse(BaseModel):
    name: str
    deleted: bool = True


class SystemPromptResponse(BaseModel):
    prompt: str
    updated_at: Optional[datetime] = None
    is_overridden: bool = False


class SystemPromptUpdateRequest(BaseModel):
    prompt: Optional[str] = None
    use_default: bool = False


class GeminiConfig(BaseModel):
    temperature: Optional[float] = None
    top_p: Optional[float] = None
    media_resolution: Optional[str] = None


class GeminiConfigResponse(BaseModel):
    config: GeminiConfig


class GeminiConfigUpdateRequest(BaseModel):
    temperature: Optional[float] = None
    top_p: Optional[float] = None
    media_resolution: Optional[str] = None


class StoredPlanSummary(BaseModel):
    id: str
    source: str
    created_at: datetime
    docx_url: Optional[str] = None
    metadata: Optional[dict] = None
    generation_seconds: Optional[float] = None


class StoredPlanListResponse(BaseModel):
    plans: List[StoredPlanSummary]


class StoredPlanDetailResponse(BaseModel):
    summary: StoredPlanSummary
    plan: CleaningPlan
