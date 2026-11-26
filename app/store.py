"""Question catalog, full-text search, progress tracking, chat threads, and Python cache."""

from __future__ import annotations

import logging
import threading
import time
from typing import Any

from app.config import (
    ALLOWED_STATUSES,
    MAX_CHAT_HISTORY,
    MAX_NOTE_LENGTH,
    needs_generated_python,
)
from app.storage import StorageBackend

logger = logging.getLogger("swe6_study_guide.store")


class StudyGuideStore:
    """Manages question catalog, study progress, Gemini chat threads, and generated Python cache."""

    def __init__(self, backend: StorageBackend) -> None:
        self.backend = backend
        self._lock = threading.Lock()
        self.manifest: dict[str, Any] = {}
        self.index: list[dict[str, Any]] = []
        self.questions_by_id: dict[int, dict[str, Any]] = {}
        self.search_corpus: dict[int, str] = {}
        self.progress: dict[str, Any] = {"questions": {}}
        self._load_dataset()
        self._load_progress()

    def _load_dataset(self) -> None:
        manifest, raw_index, questions_map = self.backend.load_source_bundle()
        self.manifest = manifest
        self.questions_by_id = questions_map

        enriched_index: list[dict[str, Any]] = []
        for entry in raw_index:
            qid = int(entry["id"])
            qdata = self.questions_by_id.get(qid)
            if not qdata:
                continue

            level_signals = qdata.get("level_signals") or []
            levels_present = sorted({int(ls["level"]) for ls in level_signals if "level" in ls})
            main_q = qdata.get("main_question") or {}
            search_parts = [
                str(qid),
                str(entry.get("title", "")),
                str(entry.get("domain", "")),
                " ".join(entry.get("skills") or []),
                " ".join(entry.get("topics") or []),
                str(qdata.get("intro_md", "")),
                str(main_q.get("question_md", "")),
            ]
            for fu in qdata.get("follow_ups") or []:
                search_parts.append(str(fu.get("title", "")))
                search_parts.append(str(fu.get("question_md", "")))
            self.search_corpus[qid] = " ".join(search_parts).lower()

            enriched_index.append(
                {
                    "id": qid,
                    "title": entry.get("title", f"Question {qid}"),
                    "url": entry.get("url", ""),
                    "answer_url": entry.get("answer_url", ""),
                    "domain": entry.get("domain", "General Software Engineering"),
                    "skills": entry.get("skills") or [],
                    "topics": [t for t in (entry.get("topics") or []) if t and t != "(Unknown)"],
                    "ladders": entry.get("ladders") or [],
                    "has_l6_signals": 6 in levels_present,
                    "has_l7_signals": 7 in levels_present,
                    "signal_levels": levels_present,
                    "follow_up_count": len(qdata.get("follow_ups") or []),
                    "has_solution": bool((qdata.get("solution") or {}).get("description_md")),
                }
            )

        self.index = enriched_index
        logger.info("Loaded %d questions", len(self.index))

    def _load_progress(self) -> None:
        data = self.backend.read_json("progress.json")
        if data and isinstance(data.get("questions"), dict):
            self.progress = {"questions": data["questions"]}

    def get_progress_snapshot(self) -> dict[str, Any]:
        with self._lock:
            self._load_progress()
            return dict(self.progress["questions"])

    def get_question(self, qid: int) -> dict[str, Any] | None:
        q = self.questions_by_id.get(qid)
        if not q:
            return None
        main_q = q.get("main_question") or {}
        follow_ups = [
            {
                "title": fu.get("title", ""),
                "question_md": fu.get("question_md", ""),
                "assume_md": fu.get("assume_md", ""),
                "hints_md": fu.get("hints_md", ""),
            }
            for fu in (q.get("follow_ups") or [])
        ]
        sol = q.get("solution") or {}
        code_snippets = [
            {
                "language": cs.get("language", "Text"),
                "code_md": cs.get("code_md", ""),
            }
            for cs in (sol.get("code_snippets") or [])
        ]
        needs_py = needs_generated_python(code_snippets, sol.get("description_md") or "")
        cached_py = self.get_generated_python(qid) if needs_py else None
        level_signals = [
            {
                "level": ls.get("level"),
                "skill_signals": [
                    {
                        "skill_name": ss.get("skill_name", ""),
                        "signals": [s.get("md", "") for s in (ss.get("signals") or []) if s.get("md")],
                    }
                    for ss in (ls.get("skill_signals") or [])
                ],
            }
            for ls in (q.get("level_signals") or [])
        ]
        return {
            "id": q.get("id"),
            "title": q.get("title", ""),
            "url": q.get("url", ""),
            "answer_url": q.get("answer_url", ""),
            "domain": q.get("domain", ""),
            "skills": q.get("skills") or [],
            "topics": [t for t in (q.get("topics") or []) if t and t != "(Unknown)"],
            "ladders": q.get("ladders") or [],
            "related_question_ids": q.get("related_question_ids") or [],
            "intro_md": q.get("intro_md", ""),
            "main_question": {
                "title": main_q.get("title", ""),
                "question_md": main_q.get("question_md", ""),
                "assume_md": main_q.get("assume_md", ""),
                "hints_md": main_q.get("hints_md", ""),
            },
            "follow_ups": follow_ups,
            "solution": {
                "description_md": sol.get("description_md", ""),
                "code_snippets": code_snippets,
                "needs_generated_python": needs_py,
                "generated_python": cached_py,
            },
            "level_signals": level_signals,
            "study_guide": self.get_study_guide(qid),
        }

    def search_ids(self, query: str) -> list[int]:
        tokens = [tok for tok in query.lower().strip().split() if tok]
        if not tokens:
            return [item["id"] for item in self.index]
        return [
            item["id"]
            for item in self.index
            if all(tok in self.search_corpus.get(item["id"], "") for tok in tokens)
        ]

    def update_question_progress(self, qid: int, payload: dict[str, Any]) -> dict[str, Any]:
        if qid not in self.questions_by_id:
            raise KeyError(f"Unknown question id: {qid}")

        with self._lock:
            self._load_progress()
            key = str(qid)
            entry = dict(self.progress["questions"].get(key, {}))

            if "status" in payload:
                status = str(payload["status"])
                if status not in ALLOWED_STATUSES:
                    raise ValueError("Invalid status value")
                entry["status"] = status

            if "confidence" in payload:
                conf = payload["confidence"]
                if not isinstance(conf, int) or isinstance(conf, bool) or not (0 <= conf <= 5):
                    raise ValueError("Confidence must be an integer between 0 and 5")
                entry["confidence"] = conf

            if "bookmarked" in payload:
                bm = payload["bookmarked"]
                if not isinstance(bm, bool):
                    raise ValueError("Bookmarked must be a boolean")
                entry["bookmarked"] = bm

            if "hidden" in payload:
                hid = payload["hidden"]
                if not isinstance(hid, bool):
                    raise ValueError("Hidden must be a boolean")
                entry["hidden"] = hid

            if "notes" in payload:
                notes = payload["notes"]
                if not isinstance(notes, str) or len(notes) > MAX_NOTE_LENGTH:
                    raise ValueError(f"Notes must be a string up to {MAX_NOTE_LENGTH} characters")
                entry["notes"] = notes

            entry["updated_at"] = int(time.time())
            self.progress["questions"][key] = entry
            self.backend.write_json("progress.json", self.progress)
            return entry

    def reset_progress(self) -> None:
        with self._lock:
            self.progress = {"questions": {}}
            self.backend.write_json("progress.json", self.progress)

    def get_chat_thread(self, qid: int) -> list[dict[str, Any]]:
        if qid not in self.questions_by_id:
            raise KeyError(f"Unknown question id: {qid}")
        data = self.backend.read_json(f"chats/{qid}.json")
        if data and isinstance(data.get("messages"), list):
            return data["messages"]
        return []

    def append_chat_turn(
        self, qid: int, user_text: str, model_text: str, coach_mode: str
    ) -> list[dict[str, Any]]:
        with self._lock:
            messages = self.get_chat_thread(qid)
            now = int(time.time())
            messages.append({"role": "user", "text": user_text, "timestamp": now, "mode": coach_mode})
            messages.append({"role": "model", "text": model_text, "timestamp": now, "mode": coach_mode})
            messages = messages[-MAX_CHAT_HISTORY:]
            self.backend.write_json(
                f"chats/{qid}.json",
                {"question_id": qid, "updated_at": now, "messages": messages},
            )
            return messages

    def clear_chat_thread(self, qid: int) -> None:
        if qid not in self.questions_by_id:
            raise KeyError(f"Unknown question id: {qid}")
        with self._lock:
            self.backend.delete_key(f"chats/{qid}.json")

    def get_generated_python(self, qid: int) -> dict[str, Any] | None:
        data = self.backend.read_json(f"generated_python/{qid}.json")
        if data and isinstance(data.get("code_md"), str) and data["code_md"].strip():
            return data
        return None

    def save_generated_python(
        self, qid: int, code_md: str, model: str, source_languages: list[str]
    ) -> dict[str, Any]:
        payload = {
            "question_id": qid,
            "code_md": code_md,
            "model": model,
            "source_languages": source_languages,
            "generated_at": int(time.time()),
            "generated": True,
        }
        with self._lock:
            self.backend.write_json(f"generated_python/{qid}.json", payload)
        return payload

    def get_study_guide(self, qid: int) -> dict[str, Any] | None:
        data = self.backend.read_json(f"study_guides/{qid}.json")
        if data and isinstance(data.get("guide_md"), str) and data["guide_md"].strip():
            return data
        return None

    def save_study_guide(
        self, qid: int, guide_md: str, model: str, edited: bool = False
    ) -> dict[str, Any]:
        now = int(time.time())
        payload: dict[str, Any] = {
            "question_id": qid,
            "guide_md": guide_md,
            "model": model,
            "generated_at": now,
        }
        if edited:
            existing = self.get_study_guide(qid)
            if existing and existing.get("generated_at"):
                payload["generated_at"] = existing["generated_at"]
            if existing and existing.get("model"):
                payload["model"] = existing["model"]
            payload["edited"] = True
            payload["edited_at"] = now
        with self._lock:
            self.backend.write_json(f"study_guides/{qid}.json", payload)
        return payload
