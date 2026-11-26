"""Vertex AI / Gemini interview coach and Python code translator."""

from __future__ import annotations

import os
import threading
from typing import Any

from app.config import is_translatable_source_lang


class GeminiCoach:
    """Vertex AI / Gemini study coach grounded in the active interview question."""

    def __init__(
        self,
        project: str,
        location: str,
        model: str,
        study_guide_model: str = "gemini-4-neon",
    ) -> None:
        self.project = project
        self.location = location
        self.model = model
        self.study_guide_model = study_guide_model
        self._client = None
        self._lock = threading.Lock()

    def _get_client(self):
        with self._lock:
            if self._client is None:
                from google import genai

                api_key = os.environ.get("GEMINI_API_KEY", "").strip()
                if api_key:
                    self._client = genai.Client(api_key=api_key)
                else:
                    self._client = genai.Client(
                        vertexai=True,
                        project=self.project,
                        location=self.location,
                    )
            return self._client

    def _build_system_instruction(self, q: dict[str, Any], coach_mode: str) -> str:
        parts = [
            "You are an expert Staff Software Engineer (Google SWE L6) interview coach.",
            "Help the candidate prepare deeply and practically for the interview question below.",
            "Keep answers crisp, structured in Markdown, and calibrated to Google SWE L6 expectations "
            "(scope, ambiguity resolution, architecture trade-offs, scalability, failure modes, edge cases, complexity).",
        ]
        if coach_mode == "socratic":
            parts.append(
                "COACH MODE: SOCRATIC (NO SPOILERS). Do NOT dump the full solution upfront. "
                "Guide the candidate with targeted hints, clarifying prompts, and L6-level follow-up questions "
                "unless they explicitly ask for the answer."
            )
        else:
            parts.append(
                "COACH MODE: DEEP-DIVE TUTOR (FULL CONTEXT). You may directly explain the solution, "
                "compare approaches, critique the candidate's design or code, and explain what differentiates L5 vs L6."
            )

        parts.append("\n--- INTERVIEW QUESTION CONTEXT ---")
        parts.append(f"ID: {q.get('id')} | Title: {q.get('title')}")
        parts.append(f"Domain: {q.get('domain')} | Skills: {', '.join(q.get('skills') or [])}")
        parts.append(f"Topics: {', '.join(q.get('topics') or [])}")
        if q.get("intro_md"):
            parts.append(f"\n[Context]\n{q['intro_md'][:2000]}")
        mq = q.get("main_question") or {}
        if mq.get("question_md"):
            parts.append(f"\n[Main Question]\n{mq['question_md'][:4000]}")
        if mq.get("assume_md"):
            parts.append(f"\n[Assumptions]\n{mq['assume_md'][:2500]}")
        if mq.get("hints_md"):
            parts.append(f"\n[Hints]\n{mq['hints_md'][:2500]}")

        fus = q.get("follow_ups") or []
        if fus:
            fu_lines = [
                f"{idx}. {fu.get('title', '')}: {fu.get('question_md', '')[:800]}"
                for idx, fu in enumerate(fus[:6], 1)
            ]
            parts.append("\n[Follow-ups]\n" + "\n".join(fu_lines))

        sol = (q.get("solution") or {}).get("description_md") or ""
        if sol:
            parts.append(f"\n[Reference Solution]\n{sol[:6000]}")

        ls_lines = []
        for ls in q.get("level_signals") or []:
            lvl = ls.get("level")
            if lvl in {5, 6, 7}:
                sigs = [
                    f"{ss.get('skill_name')}: " + " ; ".join(ss.get("signals") or [])
                    for ss in ls.get("skill_signals") or []
                ]
                ls_lines.append(f"Level {lvl}: " + " | ".join(sigs))
        if ls_lines:
            parts.append("\n[Level Signals]\n" + "\n".join(ls_lines)[:4000])

        return "\n".join(parts)

    def ask(self, q: dict[str, Any], history: list[dict[str, Any]], user_message: str, coach_mode: str) -> str:
        from google.genai import types

        client = self._get_client()
        system_instruction = self._build_system_instruction(q, coach_mode)

        contents = []
        for msg in history[-20:]:
            role = "user" if msg.get("role") == "user" else "model"
            text = str(msg.get("text") or "").strip()
            if text:
                contents.append(types.Content(role=role, parts=[types.Part.from_text(text=text)]))
        contents.append(types.Content(role="user", parts=[types.Part.from_text(text=user_message)]))

        response = client.models.generate_content(
            model=self.model,
            contents=contents,
            config=types.GenerateContentConfig(
                system_instruction=system_instruction,
                temperature=0.4,
                max_output_tokens=2048,
            ),
        )
        return (response.text or "").strip() or "I couldn't generate a response. Please try rephrasing."

    def translate_to_python(self, q: dict[str, Any]) -> str:
        """Translate Java/Go/C++ reference code snippets into idiomatic Python 3."""
        from google.genai import types

        client = self._get_client()
        snippets = (q.get("solution") or {}).get("code_snippets") or []
        source_blocks = [
            f"### Original ({str(cs.get('language', '')).strip()})\n{cs.get('code_md', '')}"
            for cs in snippets
            if is_translatable_source_lang(str(cs.get("language", "")).strip().lower())
        ]
        if not source_blocks:
            desc_md = (q.get("solution") or {}).get("description_md") or ""
            source_blocks = [f"### Original Solution Walkthrough\n{desc_md}"]

        prompt = (
            f"Question: {q.get('title', '')}\n\n"
            "Translate the following original Java/Go/C++ reference solution(s) into clean, idiomatic Python 3 "
            "with type hints. Preserve the exact algorithm, complexity, and all solution variants/approaches "
            "(if there are multiple variants, include a clear Markdown heading for each). "
            "Return Markdown containing fenced ```python code blocks (and brief headings if multiple variants).\n\n"
            + "\n\n".join(source_blocks)
        )

        response = client.models.generate_content(
            model=self.model,
            contents=prompt,
            config=types.GenerateContentConfig(
                system_instruction=(
                    "You are a Google Staff Software Engineer translating interview reference solutions "
                    "from Java/Go/C++ to idiomatic Python 3. Keep the translation faithful, bug-free, and concise."
                ),
                temperature=0.2,
                max_output_tokens=4096,
            ),
        )
        return (response.text or "").strip()

    def generate_study_guide(self, q: dict[str, Any]) -> str:
        """Generate a structured 7-step interview study guide for a question using Gemini Neon."""
        from google.genai import types

        client = self._get_client()
        system_instruction = self._build_system_instruction(q, coach_mode="tutor")
        prompt = (
            "Generate a concise, high-signal, question-specific Study Guide for this interview question "
            "(using Python 3 for code/blueprint examples) following the EXACT Markdown framework below "
            "(Sections 0 through 7). Fill in every section with concrete, accurate details grounded in this "
            "exact question's prompt, assumptions, reference solutions, follow-ups, and level signals—no generic placeholders.\n\n"
            "## 0. Clear Problem Statement & Examples\n"
            "- Rewrite the problem in clear, precise, easy-to-understand language (removing interview verbosity or ambiguity while preserving every requirement).\n"
            "- Provide 2–3 concrete **Input → Expected Output** examples (including at least one edge/tricky case) with brief 1-line explanations.\n\n"
            "## 1. Problem Breakdown\n"
            "- **Inputs & Outputs:** Exact data types, return formats, and whether to mutate or return a new structure.\n"
            "- **Core Goal:** One plain-English sentence summarizing what the solution must achieve.\n"
            "- **Constraints:** Input sizes (N), value ranges, sorting/duplicate assumptions, memory/latency limits.\n\n"
            "## 2. Clarification Questions\n"
            "List 3–4 targeted questions to ask before designing:\n"
            "- **Input boundaries:** Concrete boundary/size/empty question for this problem.\n"
            "- **Data characteristics:** Concrete values/duplicates/cycles/format question for this problem.\n"
            "- **Tie-breakers & errors:** Concrete tie-breaking and invalid-input behavior question.\n\n"
            "## 3. Algorithm Proposals (Brute Force → Optimal)\n"
            "- **Approach 1: Brute Force**\n"
            "  - **Idea:** Straightforward baseline approach for this problem.\n"
            "  - **Complexity:** Exact Time & Space complexity and where it bottlenecks.\n"
            "- **Approach 2: Optimal Solution**\n"
            "  - **Idea:** Pattern/data structure that removes the bottleneck.\n"
            "  - **Complexity:** Improved Time & Space complexity.\n"
            "(Add Approach 3 if this question has another major design alternative such as Trie vs. HashMap or Heap vs. Bitset.)\n\n"
            "## 4. Implementation Blueprint\n"
            "- **Key narration points:** What to explain aloud while coding each logical block.\n"
            "- **Descriptive names & helpers:** Key variable names and helper functions to extract.\n"
            "- **Full Python 3 Solutions (with explanations):**\n"
            "  - Provide the **complete, runnable Python 3 Brute Force solution** (clean, type-hinted, with concise step-by-step explanation).\n"
            "  - Provide the **complete, runnable Python 3 Optimal solution** (clean, modular, interview-ready, with clear explanation of key invariants and helper functions).\n"
            "  - If the problem has another distinct optimal/production alternative (e.g., Trie vs. HashMap, Heap vs. Bitset, or a major follow-up extension), include its **complete Python 3 solution** as well.\n\n"
            "## 5. Trade-off Analysis\n"
            "| Dimension | Brute Force | Optimal Approach |\n"
            "| --- | --- | --- |\n"
            "| Time Complexity | ... | ... |\n"
            "| Space Complexity | ... | ... |\n"
            "| When to prefer | ... | ... |\n"
            "(Include an extra column if there is a 3rd key approach.)\n\n"
            "## 6. Edge Cases & Dry Run\n"
            "- **Empty / Single-element:** Concrete examples for this problem.\n"
            "- **Duplicates / Uniform values:** Concrete examples for this problem.\n"
            "- **Extremes & malformed inputs:** Concrete boundary/adversarial examples for this problem.\n"
            "- **Standard trace:** Walk one concrete normal input step-by-step through the key variables to verify state transitions.\n\n"
            "## 7. Follow-up Readiness\n"
            "- Address every actual follow-up from this question PLUS common scale pivots "
            "(infinite stream / out-of-memory dataset / millions of repeated queries / fault tolerance) with concrete strategies.\n"
        )

        response = client.models.generate_content(
            model=self.study_guide_model,
            contents=prompt,
            config=types.GenerateContentConfig(
                system_instruction=system_instruction,
                temperature=0.3,
                max_output_tokens=32768,
            ),
        )
        return (response.text or "").strip()
