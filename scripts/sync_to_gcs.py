#!/usr/bin/env python3
"""Sync local ~/swe6_study_guide_data to gs://fde-study-guide/source/."""

from __future__ import annotations

import argparse
import gzip
import json
import pathlib
from google.cloud import storage


def build_bundle(data_dir: pathlib.Path) -> tuple[dict, list[dict], dict[str, dict]]:
    manifest = json.loads((data_dir / "manifest.json").read_text(encoding="utf-8"))
    raw_index = json.loads((data_dir / "index.json").read_text(encoding="utf-8"))
    questions: dict[str, dict] = {}
    for entry in raw_index:
        qid = int(entry["id"])
        qpath = data_dir / entry["question_json"]
        if qpath.is_file():
            questions[str(qid)] = json.loads(qpath.read_text(encoding="utf-8"))
    return manifest, raw_index, questions


def main() -> None:
    parser = argparse.ArgumentParser(description="Upload SWE L6 study data bundle to GCS")
    parser.add_argument("--data-dir", default=str(pathlib.Path.home() / "swe6_study_guide_data"))
    parser.add_argument("--bucket", default="fde-study-guide")
    parser.add_argument("--project", default="ninghai-ccai")
    args = parser.parse_args()

    data_dir = pathlib.Path(args.data_dir).expanduser().resolve()
    manifest, raw_index, questions = build_bundle(data_dir)
    bundle = {"manifest": manifest, "index": raw_index, "questions": questions}

    client = storage.Client(project=args.project)
    bucket = client.bucket(args.bucket)

    # Upload gzipped bundle for fast Cloud Run cold starts
    gz_bytes = gzip.compress(json.dumps(bundle, ensure_ascii=False).encode("utf-8"), compresslevel=6)
    blob = bucket.blob("source/bundle.json.gz")
    blob.upload_from_string(gz_bytes, content_type="application/gzip")
    print(f"Uploaded gs://{args.bucket}/source/bundle.json.gz ({len(gz_bytes):,} bytes, {len(questions)} questions)")

    # Also upload manifest.json and index.json for inspection
    bucket.blob("source/manifest.json").upload_from_string(
        json.dumps(manifest, indent=2, ensure_ascii=False),
        content_type="application/json",
    )
    bucket.blob("source/index.json").upload_from_string(
        json.dumps(raw_index, indent=2, ensure_ascii=False),
        content_type="application/json",
    )
    print(f"Uploaded gs://{args.bucket}/source/manifest.json and source/index.json")


if __name__ == "__main__":
    main()
