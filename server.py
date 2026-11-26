#!/usr/bin/env python3
"""CLI entrypoint for the SWE/FDE Interview Study Guide web server."""

from __future__ import annotations

import argparse
import logging
import os
import pathlib
from http.server import ThreadingHTTPServer

from app.auth import AuthManager, RateLimiter, get_session_secret, hash_passcode_scrypt
from app.config import IS_CLOUD_RUN, RATE_LIMIT_MAX_REQUESTS, RATE_LIMIT_WINDOW_SEC
from app.gemini import GeminiCoach
from app.handler import BankEntry, make_handler
from app.storage import GCSStorageBackend, LocalStorageBackend, StorageBackend
from app.store import StudyGuideStore

__all__ = [
    "GCSStorageBackend",
    "LocalStorageBackend",
    "StudyGuideStore",
    "hash_passcode_scrypt",
    "main",
]

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger("swe6_study_guide")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Interview Study Guide Server")
    parser.add_argument(
        "--fde-data-dir",
        default=os.environ.get("FDE_DATA_DIR", str(pathlib.Path.home() / "fde_interview_questions")),
        help="Local fallback directory for FDE bank when GCS is unset",
    )
    parser.add_argument(
        "--swe6-data-dir",
        default=os.environ.get("SWE6_DATA_DIR", str(pathlib.Path.home() / "swe6_study_guide_data")),
        help="Local fallback directory for SWE L6 bank when GCS is unset",
    )
    parser.add_argument(
        "--gcs-bucket",
        default=os.environ.get("GCS_BUCKET", ""),
        help="Default (FDE) GCS bucket name (e.g. fde-study-guide2)",
    )
    parser.add_argument(
        "--swe6-gcs-bucket",
        default=os.environ.get("SWE6_GCS_BUCKET", ""),
        help="Secondary (SWE L6) GCS bucket name (e.g. fde-study-guide)",
    )
    parser.add_argument(
        "--gcp-project",
        default=os.environ.get("GOOGLE_CLOUD_PROJECT", "ninghai-ccai"),
        help="GCP project ID for GCS and Vertex AI",
    )
    parser.add_argument(
        "--gcp-location",
        default=os.environ.get("GOOGLE_CLOUD_LOCATION", "global"),
        help="Vertex AI region (default: global)",
    )
    parser.add_argument(
        "--gemini-model",
        default=os.environ.get("GEMINI_MODEL", "gemini-4-hydrogen"),
        help="Gemini model name (default: gemini-4-hydrogen)",
    )
    parser.add_argument(
        "--host",
        default="0.0.0.0" if IS_CLOUD_RUN else "127.0.0.1",
        help="Host interface to bind (default: 127.0.0.1 locally, 0.0.0.0 on Cloud Run)",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=int(os.environ.get("PORT", "8765")),
        help="Port to listen on (default: 8765 locally, $PORT on Cloud Run)",
    )
    return parser.parse_args()


def _build_bank(
    bank_id: str,
    label: str,
    gcs_bucket: str,
    local_dir: str,
    gcp_project: str,
) -> tuple[BankEntry, StorageBackend]:
    if gcs_bucket:
        backend: StorageBackend = GCSStorageBackend(gcs_bucket, project=gcp_project)
        storage_label = f"gs://{gcs_bucket}/user_data/"
        logger.info("Bank '%s' (%s) -> gs://%s", bank_id, label, gcs_bucket)
    else:
        data_dir = pathlib.Path(local_dir).expanduser().resolve()
        backend = LocalStorageBackend(data_dir)
        storage_label = str(data_dir / ".study_user_data")
        logger.info("Bank '%s' (%s) -> %s", bank_id, label, data_dir)

    store = StudyGuideStore(backend)
    return BankEntry(bank_id=bank_id, label=label, store=store, storage_label=storage_label), backend


def main() -> None:
    args = parse_args()

    banks: dict[str, BankEntry] = {}
    fde_entry, primary_backend = _build_bank(
        bank_id="fde",
        label="FDE Bank",
        gcs_bucket=args.gcs_bucket,
        local_dir=args.fde_data_dir,
        gcp_project=args.gcp_project,
    )
    banks["fde"] = fde_entry

    # Load secondary SWE L6 bank when configured (GCS or local directory exists)
    swe6_local_exists = pathlib.Path(args.swe6_data_dir).expanduser().is_dir()
    if args.swe6_gcs_bucket or (not args.gcs_bucket and swe6_local_exists):
        swe6_entry, _ = _build_bank(
            bank_id="swe6",
            label="SWE L6 Bank",
            gcs_bucket=args.swe6_gcs_bucket,
            local_dir=args.swe6_data_dir,
            gcp_project=args.gcp_project,
        )
        banks["swe6"] = swe6_entry

    coach = GeminiCoach(
        project=args.gcp_project,
        location=args.gcp_location,
        model=args.gemini_model,
        study_guide_model=os.environ.get("STUDY_GUIDE_MODEL", "gemini-4-neon"),
    )
    auth = AuthManager(
        backend=primary_backend,
        passcode_hash=os.environ.get("APP_PASSCODE_HASH", ""),
        session_secret=get_session_secret(),
    )
    rate_limiter = RateLimiter(RATE_LIMIT_MAX_REQUESTS, RATE_LIMIT_WINDOW_SEC)

    handler_cls = make_handler(banks, default_bank_id="fde", coach=coach, auth=auth, rate_limiter=rate_limiter)
    server = ThreadingHTTPServer((args.host, args.port), handler_cls)
    logger.info(
        "Study Guide running at http://%s:%d (banks: %s, default: fde, keypad auth: %s)",
        args.host,
        args.port,
        ", ".join(banks.keys()),
        "enabled" if auth.enabled else "disabled",
    )
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        logger.info("Shutting down server...")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
