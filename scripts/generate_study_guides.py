#!/usr/bin/env python3
"""Pre-generate structured study guides for all questions in a bank and save to GCS & local."""

from __future__ import annotations

import argparse
import concurrent.futures
import pathlib
import sys

ROOT_DIR = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT_DIR))

from app.gemini import GeminiCoach
from app.storage import GCSStorageBackend, LocalStorageBackend
from app.store import StudyGuideStore


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate study guides for all questions in a bank")
    parser.add_argument("--data-dir", default=str(pathlib.Path.home() / "fde_interview_questions"))
    parser.add_argument("--bucket", default="fde-study-guide2")
    parser.add_argument("--project", default="ninghai-ccai")
    parser.add_argument("--location", default="global")
    parser.add_argument("--model", default="gemini-4-neon")
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--workers", type=int, default=4)
    args = parser.parse_args()

    local_backend = LocalStorageBackend(pathlib.Path(args.data_dir).expanduser().resolve())
    local_store = StudyGuideStore(local_backend)
    gcs_backend = GCSStorageBackend(args.bucket, project=args.project)
    gcs_store = StudyGuideStore(gcs_backend)
    coach = GeminiCoach(
        project=args.project,
        location=args.location,
        model=args.model,
        study_guide_model=args.model,
    )

    def process_one(qid: int, title: str) -> str:
        existing = gcs_store.get_study_guide(qid)
        if (
            existing
            and not args.force
            and "1. Problem Breakdown" in existing.get("guide_md", "")
            and "7. Follow-up Readiness" in existing.get("guide_md", "")
            and existing.get("guide_md", "").rstrip().endswith((".", "`", ")", "*", "|"))
        ):
            local_store.save_study_guide(qid, existing["guide_md"], existing.get("model", args.model))
            return f"CACHED #{qid}: {title}"
        q = local_store.get_question(qid)
        guide_md = coach.generate_study_guide(q)
        local_store.save_study_guide(qid, guide_md, args.model)
        gcs_store.save_study_guide(qid, guide_md, args.model)
        has7 = "7. Follow-up Readiness" in guide_md
        return f"GENERATED #{qid}: {title} ({len(guide_md):,} chars, has7={has7})"

    items = [(item["id"], item["title"]) for item in local_store.index]
    print(f"Generating study guides for {len(items)} questions using {args.model}...")
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
        futs = [pool.submit(process_one, qid, title) for qid, title in items]
        for fut in concurrent.futures.as_completed(futs):
            print(" ", fut.result())
    print("DONE!")


if __name__ == "__main__":
    main()
