from __future__ import annotations

import asyncio
from typing import Awaitable, Callable, Dict, List
from uuid import uuid4

from app.models.schemas import BatchJob, BatchJobStatus, CleaningPlan, FloorPlanOptions
from app.services import plan_store

ProcessorFn = Callable[[str, FloorPlanOptions], Awaitable[CleaningPlan]]


class BatchRunner:
    def __init__(self) -> None:
        self.jobs: Dict[str, BatchJob] = {}
        self.results: Dict[str, List[CleaningPlan]] = {}

    async def start_job(
        self, file_ids: List[str], options: FloorPlanOptions, processor: ProcessorFn
    ) -> BatchJob:
        job = BatchJob(id=uuid4().hex, total_files=len(file_ids))
        self.jobs[job.id] = job
        self.results[job.id] = []
        asyncio.create_task(self._run(job.id, file_ids, options, processor))
        return job

    async def _run(
        self,
        job_id: str,
        file_ids: List[str],
        options: FloorPlanOptions,
        processor: ProcessorFn,
    ) -> None:
        job = self.jobs[job_id]
        job.status = BatchJobStatus.running
        for file_id in file_ids:
            if job.status == BatchJobStatus.failed:
                return
            try:
                started = asyncio.get_running_loop().time()
                plan = await processor(file_id, options)
                self.results[job_id].append(plan)
                plan_store.save_plan(
                    source="batch",
                    request_payload={
                        "job_id": job_id,
                        "file_id": file_id,
                        "options": options.model_dump(),
                    },
                    plan=plan,
                    docx_id=None,
                    metadata={"status": job.status},
                    generation_ms=int((asyncio.get_running_loop().time() - started) * 1000),
                )
                job.processed_files += 1
            except Exception as exc:  # pragma: no cover - best effort logging
                job.status = BatchJobStatus.failed
                job.message = str(exc)
                return
        job.status = BatchJobStatus.success

    def get_status(self, job_id: str) -> BatchJob:
        if job_id not in self.jobs:
            raise KeyError(job_id)
        return self.jobs[job_id]

    def get_results(self, job_id: str) -> List[CleaningPlan]:
        if job_id not in self.results:
            raise KeyError(job_id)
        return self.results[job_id]
