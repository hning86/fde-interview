#!/usr/bin/env python3
"""Generate Section 0 (Clear Problem Statement & Examples) with gemini-4-neon and prepend to existing guides."""

from __future__ import annotations

import concurrent.futures
import pathlib
import sys

ROOT_DIR = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT_DIR))

from google.genai import types
from app.gemini import GeminiCoach
from app.storage import GCSStorageBackend, LocalStorageBackend
from app.store import StudyGuideStore


def generate_section_0(coach: GeminiCoach, q: dict) -> str:
    client = coach._get_client()
    system_instruction = coach._build_system_instruction(q, coach_mode="tutor")
    prompt = (
        "Write ONLY Section 0 of the study guide for this interview question, using this exact heading:\n\n"
        "## 0. Clear Problem Statement & Examples\n\n"
        "Requirements:\n"
        "1. Rewrite the problem in clear, precise, easy-to-understand language (removing interview verbosity "
        "or ambiguity while faithfully preserving all core requirements and function/API behavior).\n"
        "2. Provide 2–3 concrete **Input → Expected Output** examples (in clean code/text blocks) "
        "including at least one tricky or edge case, each with a concise 1-line explanation.\n"
        "3. Do NOT include Section 1 or any other sections—stop after the examples.\n"
    )
    resp = client.models.generate_content(
        model="gemini-4-neon",
        contents=prompt,
        config=types.GenerateContentConfig(
            system_instruction=system_instruction,
            temperature=0.25,
            max_output_tokens=8192,
        ),
    )
    text = (resp.text or "").strip()
    if not text.startswith("## 0."):
        text = "## 0. Clear Problem Statement & Examples\n\n" + text
    return text


def main() -> None:
    local_store = StudyGuideStore(LocalStorageBackend(pathlib.Path.home() / "fde_interview_questions"))
    gcs_store = StudyGuideStore(GCSStorageBackend("fde-study-guide2", project="ninghai-ccai"))
    coach = GeminiCoach(project="ninghai-ccai", location="global", model="gemini-4-hydrogen", study_guide_model="gemini-4-neon")

    def process_one(qid: int, title: str) -> str:
        existing = gcs_store.get_study_guide(qid)
        if not existing:
            raise RuntimeError(f"Missing existing guide for #{qid}")
        body = existing["guide_md"]
        # Strip any prior Section 0 if re-run
        marker = "## 1. Problem Breakdown"
        if marker in body:
            body = body[body.index(marker):]
        q = local_store.get_question(qid)
        sec0 = generate_section_0(coach, q)
        merged = f"{sec0}\n\n---\n\n{body}"
        local_store.save_study_guide(qid, merged, "gemini-4-neon")
        gcs_store.save_study_guide(qid, merged, "gemini-4-neon")
        return f"UPDATED #{qid}: {title} (sec0={len(sec0):,} chars, total={len(merged):,} chars)"

    items = [(item["id"], item["title"]) for item in local_store.index]
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        futs = [pool.submit(process_one, qid, title) for qid, title in items]
        for fut in concurrent.futures.as_completed(futs):
            print(" ", fut.result())
    print("ALL_SECTION_0_DONE")


if __name__ == "__main__":
    main()
