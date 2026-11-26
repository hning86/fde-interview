"""Storage backends for local filesystem and Google Cloud Storage."""

from __future__ import annotations

import gzip
import json
import logging
import os
import pathlib
from typing import Any

from app.config import ensure_within_dir

logger = logging.getLogger("swe6_study_guide.storage")


class StorageBackend:
    """Abstracts local disk vs Google Cloud Storage persistence."""

    def load_source_bundle(self) -> tuple[dict[str, Any], list[dict[str, Any]], dict[int, dict[str, Any]]]:
        raise NotImplementedError

    def read_json(self, relative_key: str) -> dict[str, Any] | None:
        raise NotImplementedError

    def write_json(self, relative_key: str, data: dict[str, Any]) -> None:
        raise NotImplementedError

    def delete_key(self, relative_key: str) -> None:
        raise NotImplementedError


class LocalStorageBackend(StorageBackend):
    """Reads source data from a local directory and persists user data under .study_user_data."""

    def __init__(self, data_dir: pathlib.Path) -> None:
        self.data_dir = data_dir.resolve()
        self.user_dir = ensure_within_dir(self.data_dir, self.data_dir / ".study_user_data")
        self.user_dir.mkdir(parents=True, exist_ok=True)
        legacy = self.data_dir / ".study_progress.json"
        new_prog = self.user_dir / "progress.json"
        if legacy.is_file() and not new_prog.is_file():
            new_prog.write_text(legacy.read_text(encoding="utf-8"), encoding="utf-8")

    def load_source_bundle(self) -> tuple[dict[str, Any], list[dict[str, Any]], dict[int, dict[str, Any]]]:
        manifest_path = ensure_within_dir(self.data_dir, self.data_dir / "manifest.json")
        index_path = ensure_within_dir(self.data_dir, self.data_dir / "index.json")
        manifest = json.loads(manifest_path.read_text(encoding="utf-8")) if manifest_path.is_file() else {}
        raw_index = json.loads(index_path.read_text(encoding="utf-8"))
        questions: dict[int, dict[str, Any]] = {}
        for entry in raw_index:
            qid = int(entry["id"])
            qjson_path = ensure_within_dir(self.data_dir, self.data_dir / entry.get("question_json", ""))
            if qjson_path.is_file():
                questions[qid] = json.loads(qjson_path.read_text(encoding="utf-8"))
        return manifest, raw_index, questions

    def _safe_user_path(self, relative_key: str) -> pathlib.Path:
        cleaned = relative_key.lstrip("/")
        target = ensure_within_dir(self.user_dir, self.user_dir / cleaned)
        target.parent.mkdir(parents=True, exist_ok=True)
        return target

    def read_json(self, relative_key: str) -> dict[str, Any] | None:
        path = self._safe_user_path(relative_key)
        if not path.is_file():
            return None
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            return data if isinstance(data, dict) else None
        except (OSError, json.JSONDecodeError):
            return None

    def write_json(self, relative_key: str, data: dict[str, Any]) -> None:
        path = self._safe_user_path(relative_key)
        tmp = path.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
        os.replace(tmp, path)

    def delete_key(self, relative_key: str) -> None:
        path = self._safe_user_path(relative_key)
        if path.is_file():
            path.unlink()


class GCSStorageBackend(StorageBackend):
    """Reads source bundle from GCS and persists user data under user_data/."""

    def __init__(self, bucket_name: str, project: str | None = None) -> None:
        from google.cloud import storage

        self.bucket_name = bucket_name
        self.client = storage.Client(project=project or None)
        self.bucket = self.client.bucket(bucket_name)

    def load_source_bundle(self) -> tuple[dict[str, Any], list[dict[str, Any]], dict[int, dict[str, Any]]]:
        blob = self.bucket.blob("source/bundle.json.gz")
        if not blob.exists():
            raise FileNotFoundError(f"gs://{self.bucket_name}/source/bundle.json.gz not found")
        raw_bytes = gzip.decompress(blob.download_as_bytes())
        bundle = json.loads(raw_bytes.decode("utf-8"))
        manifest = bundle.get("manifest") or {}
        raw_index = bundle.get("index") or []
        questions = {int(k): v for k, v in (bundle.get("questions") or {}).items()}
        return manifest, raw_index, questions

    def read_json(self, relative_key: str) -> dict[str, Any] | None:
        key = f"user_data/{relative_key.lstrip('/')}"
        blob = self.bucket.blob(key)
        try:
            if not blob.exists():
                return None
            data = json.loads(blob.download_as_text(encoding="utf-8"))
            return data if isinstance(data, dict) else None
        except Exception as exc:
            logger.warning("GCS read failed for %s: %s", key, exc)
            return None

    def write_json(self, relative_key: str, data: dict[str, Any]) -> None:
        key = f"user_data/{relative_key.lstrip('/')}"
        blob = self.bucket.blob(key)
        blob.upload_from_string(
            json.dumps(data, indent=2, ensure_ascii=False),
            content_type="application/json; charset=utf-8",
        )

    def delete_key(self, relative_key: str) -> None:
        key = f"user_data/{relative_key.lstrip('/')}"
        blob = self.bucket.blob(key)
        try:
            blob.delete()
        except Exception:
            pass
