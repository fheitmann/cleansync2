from __future__ import annotations

from pathlib import Path
from typing import Iterable
from uuid import uuid4

from fastapi import UploadFile

STORAGE_ROOT = Path("storage")
UPLOAD_DIR = STORAGE_ROOT / "uploads"
TEMPLATE_DIR = STORAGE_ROOT / "templates"
DOCX_DIR = STORAGE_ROOT / "docx"
EXTERNAL_DIR = STORAGE_ROOT / "external"


def ensure_dirs() -> None:
    for folder in (UPLOAD_DIR, TEMPLATE_DIR, DOCX_DIR, EXTERNAL_DIR):
        folder.mkdir(parents=True, exist_ok=True)


def _build_file_id(category: str, suffix: str) -> str:
    file_id = f"{category}/{uuid4().hex}{suffix}"
    return file_id


def save_upload_file(upload: UploadFile, category: str = "uploads") -> str:
    ensure_dirs()
    suffix = Path(upload.filename or "").suffix or ""
    file_id = _build_file_id(category, suffix)
    target_path = STORAGE_ROOT / file_id
    target_path.parent.mkdir(parents=True, exist_ok=True)

    with target_path.open("wb") as out:
        while True:
            chunk = upload.file.read(1024 * 1024)
            if not chunk:
                break
            out.write(chunk)
    return file_id


def save_bytes(data: bytes, suffix: str = ".docx", category: str = "docx") -> str:
    ensure_dirs()
    file_id = _build_file_id(category, suffix)
    target_path = STORAGE_ROOT / file_id
    target_path.parent.mkdir(parents=True, exist_ok=True)
    target_path.write_bytes(data)
    return file_id


def get_file_path(file_id: str) -> Path:
    path = STORAGE_ROOT / file_id
    if not path.exists():
        raise FileNotFoundError(f"Unknown file id {file_id}")
    return path


def delete_files(file_ids: Iterable[str]) -> None:
    for file_id in file_ids:
        try:
            path = STORAGE_ROOT / file_id
            if path.exists():
                path.unlink()
        except OSError:
            continue
