"""Configuration constants, path safety, and language detection helpers."""

from __future__ import annotations

import os
import pathlib
import re
from typing import Any

ROOT_DIR = pathlib.Path(__file__).resolve().parent.parent
STATIC_DIR = ROOT_DIR / "static"

ALLOWED_STATUSES = frozenset({"not_started", "studying", "needs_review", "mastered"})
ALLOWED_COACH_MODES = frozenset({"socratic", "tutor"})

MAX_BODY_BYTES = 64 * 1024  # 64 KB max JSON payload
MAX_NOTE_LENGTH = 20_000
MAX_CHAT_MSG_LENGTH = 6_000
MAX_CHAT_HISTORY = 40

RATE_LIMIT_WINDOW_SEC = 10.0
RATE_LIMIT_MAX_REQUESTS = 120

IS_CLOUD_RUN = bool(os.environ.get("K_SERVICE"))

MAX_FAILED_ATTEMPTS = 3
LOCKOUT_DURATION_SEC = 10 * 60  # 10 minutes
SESSION_TTL_SEC = 24 * 60 * 60  # 24 hours


def ensure_within_dir(base_dir: pathlib.Path, target_path: pathlib.Path) -> pathlib.Path:
    """Resolve target_path and strictly verify it stays inside base_dir."""
    resolved_base = base_dir.resolve()
    resolved_target = target_path.resolve()
    base_prefix = str(resolved_base) + os.sep
    if str(resolved_target) != str(resolved_base) and not str(resolved_target).startswith(base_prefix):
        raise ValueError("Path escapes allowed directory boundary")
    return resolved_target


def is_translatable_source_lang(lang_lower: str) -> bool:
    """Return True if a snippet language label indicates Java, Go, or C++."""
    return (
        "java" in lang_lower
        or "c++" in lang_lower
        or bool(re.search(r"\b(go|golang|cpp)\b", lang_lower))
    )


def needs_generated_python(
    code_snippets: list[dict[str, Any]], description_md: str = ""
) -> bool:
    """Return True if solution has Java/Go/C++ code (in snippets or description) but no Python."""
    langs = [str(cs.get("language", "")).strip().lower() for cs in (code_snippets or [])]
    has_python_snippet = any("python" in lang or re.search(r"\bpy\b", lang) for lang in langs)
    if has_python_snippet:
        return False
    if any(is_translatable_source_lang(lang) for lang in langs):
        return True

    # Fallback: check fenced Java/Go/C++ code embedded directly in solution.description_md
    desc = description_md or ""
    if "```" not in desc:
        return False
    desc_low = desc.lower()
    if re.search(r"\bdef\s+\w+\s*\(|```\s*python\b|#{1,6}\s*python\b", desc_low):
        return False
    return bool(
        re.search(
            r"#{1,6}\s*(c\+\+|cpp|java|go|golang)\b|```\s*(c\+\+|cpp|java|go|golang)\b|#include\s*<|std::|public\s+class\s+\w+|\bfunc\s+\w+\(",
            desc,
            re.IGNORECASE,
        )
    )
