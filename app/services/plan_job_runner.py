from __future__ import annotations

import asyncio
import logging
import time
from datetime import datetime, timezone
from typing import Dict, List, Optional
from uuid import uuid4

from app.models.schemas import (
    CleaningPlan,
    FloorPlanOptions,
    PlanJob,
    PlanJobStatus,
)
from app.services import plan_store
from app.services.docx_generator import plan_to_docx_bytes
from app.services.gemini_client import GeminiClient, GeminiServiceError
from app.services.storage import get_file_path, save_bytes

logger = logging.getLogger(__name__)


class PlanJobRunner:
    def __init__(self, gemini_client: GeminiClient) -> None:
        self._client = gemini_client
        self.jobs: Dict[str, PlanJob] = {}
        self._results: Dict[str, CleaningPlan] = {}

    async def start_job(
        self,
        file_ids: List[str],
        options: FloorPlanOptions,
        template_id: Optional[str],
        request_payload: Dict,
    ) -> PlanJob:
        job = PlanJob(id=uuid4().hex)
        self.jobs[job.id] = job
        asyncio.create_task(
            self._run_job(job.id, file_ids, options, template_id, request_payload)
        )
        return job

    def get_status(self, job_id: str) -> PlanJob:
        if job_id not in self.jobs:
            raise KeyError(job_id)
        return self.jobs[job_id]

    def get_plan(self, job_id: str) -> Optional[CleaningPlan]:
        return self._results.get(job_id)

    def _update_job(
        self,
        job: PlanJob,
        *,
        status: PlanJobStatus,
        docx_url: Optional[str] = None,
        message: Optional[str] = None,
        detail: Optional[Dict] = None,
    ) -> None:
        job.status = status
        if docx_url is not None:
            job.docx_url = docx_url
        job.message = message
        job.detail = detail
        job.updated_at = datetime.now(timezone.utc)

    async def _run_job(
        self,
        job_id: str,
        file_ids: List[str],
        options: FloorPlanOptions,
        template_id: Optional[str],
        request_payload: Dict,
    ) -> None:
        job = self.jobs[job_id]
        self._update_job(job, status=PlanJobStatus.running)
        started = time.perf_counter()

        try:
            rooms = []
            for file_id in file_ids:
                file_path = get_file_path(file_id)
                rooms.extend(await self._client.analyze_floorplan(file_path, options))

            template_name = None
            if template_id:
                template_path = get_file_path(template_id)
                template_name = await self._client.analyze_template(template_path)

            plan = await self._client.generate_plan(
                rooms,
                template_name=template_name,
                plan_category_id=options.plan_category,
            )
            docx_bytes = plan_to_docx_bytes(plan)
            docx_id = save_bytes(docx_bytes, suffix=".docx", category="docx")
            docx_url = f"/download/{docx_id}"
            self._results[job_id] = plan
            self._update_job(job, status=PlanJobStatus.success, docx_url=docx_url)
            metadata = {
                "template_id": template_id,
                "file_count": len(file_ids),
                "plan_category": options.plan_category,
            }
            plan_store.save_plan(
                source="generator",
                request_payload=request_payload,
                plan=plan,
                docx_id=docx_id,
                metadata=metadata,
                generation_ms=int((time.perf_counter() - started) * 1000),
            )
        except GeminiServiceError as exc:
            detail = {
                "message": str(exc),
                "source": "gemini",
                "status_code": exc.status_code,
                "reason": exc.reason,
                "retryable": exc.is_retryable,
            }
            self._update_job(
                job,
                status=PlanJobStatus.failed,
                message=str(exc),
                detail=detail,
            )
        except Exception as exc:  # pragma: no cover - best effort logging
            logger.exception("Unexpected failure running plan job %s", job_id)
            self._update_job(
                job,
                status=PlanJobStatus.failed,
                message="Uventet feil under generering",
                detail={"message": str(exc)},
            )
