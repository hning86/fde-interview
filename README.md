# Interview Study Guide Web App

A mobile-friendly, Cloud Run–ready study guide web application for technical interview preparation, featuring multi-bank question switching, GCS-backed persistence, a Vertex AI Gemini interview coach, AI-generated Python translations, structured 8-section study guides, native MathML LaTeX rendering, and a server-side keypad lock screen.

## Features

- **Multi-Bank Question Switcher**: Switch between configured question banks (e.g., `FDE Bank` and `SWE L6 Bank`) from the top bar; each bank stores its own durable progress, notes, chat threads, and generated artifacts.
- **Structured Question View (7 Tabs)**:
  1. **Problem** — Context, main prompt, assumptions, and follow-up questions.
  2. **Hints** — Interviewer hints and pacing guidance.
  3. **Solution** — Walkthrough, language-tabbed reference code, and on-demand **✦ Python (AI-Generated)** translations for Java/Go/C++ solutions lacking Python.
  4. **L6 Rubric** — Level-calibrated signals (L3–L8) with L6 highlighted and L6/L7 rubric sidebar filters.
  5. **Study Guide** — Structured Sections 0–7 (Clear Problem Statement & Examples, Problem Breakdown, Clarification Questions, Algorithm Proposals, Full Python 3 Brute Force & Optimal Implementations, Trade-off Analysis, Edge Cases & Dry Run, and Follow-up Readiness) generated with `gemini-4-neon`.
  6. **Notes** — Auto-saved personal notes and related question links.
  7. **✦ Ask Gemini** — Persistent per-question conversation threads powered by Vertex AI (`gemini-4-hydrogen`) with **Full Tutor** and **Socratic (No Spoilers)** modes.
- **Progress Tracking & Filtering**: Full-text search, status (`Not Started`, `Studying`, `Needs Review`, `Mastered`), 1–5 confidence stars, bookmarks, hide/unhide questions with a **Show hidden** toggle, 45-minute mock timer, and JSON progress export.
- **Native MathML LaTeX Rendering**: Zero-dependency DOM/MathML renderer for inline (`$...$`, `\(...\)`) and display (`$$...$$`, `\[...\]`) math—works natively in Desktop Chrome and iPhone Safari without external CDNs.
- **Dark, Midnight (OLED) & Light Themes**: Mobile-first responsive UI with iOS Safari safe-area support (`100dvh`, `viewport-fit=cover`, 16px mobile inputs).
- **Security**: Server-side 4-digit keypad gate (`scrypt`-hashed via `APP_PASSCODE_HASH`) with durable 3-strike 10-minute lockout, HMAC-signed `HttpOnly` session cookies, Double-Submit Cookie CSRF protection, strict CSP, and DOM-only Markdown rendering (no `innerHTML`).

## Project Structure

```text
.
├── server.py                      # CLI entrypoint & HTTP server wiring
├── app/
│   ├── config.py                  # Constants, path-boundary & language helpers
│   ├── storage.py                 # Local filesystem & GCS storage backends
│   ├── auth.py                    # scrypt hashing, 3-strike lockout, sessions, rate limiter
│   ├── gemini.py                  # Vertex AI Gemini coach, Python translator, study guide generator
│   ├── store.py                   # Question catalog, search, progress, chat & caches
│   └── handler.py                 # HTTP router, CSRF/auth guards, security headers, static serving
├── static/
│   ├── index.html                 # App shell, keypad lock screen, native <dialog> modals
│   ├── styles.css                 # Light / Dark / Midnight themes & mobile Safari layout
│   ├── app.js                     # Client state, tabs, filters, Gemini chat, keyboard shortcuts
│   ├── markdown.js                # Safe DOM-only Markdown renderer
│   └── math.js                    # Pure DOM/MathML TeX renderer
├── scripts/
│   ├── sync_to_gcs.py             # Bundle & upload local question data to GCS
│   ├── generate_study_guides.py   # Batch-generate study guides into GCS & local storage
│   └── prepend_section0.py        # Generate & prepend Section 0 problem rewrites/examples
├── Dockerfile                     # Cloud Run container build using uv
└── pyproject.toml                 # Python dependencies (managed via uv)
```

## Local Development

Requires Python 3.11+ and [`uv`](https://docs.astral.sh/uv/).

```bash
uv sync
uv run python server.py --port 8765
```

Open `http://127.0.0.1:8765`. By default, local mode reads from `~/fde_interview_questions` (and `~/swe6_study_guide_data` if present) and stores user data in `.study_user_data/`.

## Environment Variables

| Variable | Default | Description |
| --- | --- | --- |
| `GCS_BUCKET` | *(unset -> local)* | Primary GCS bucket name for default question bank & durable `user_data/` |
| `SWE6_GCS_BUCKET` | *(unset)* | Optional secondary GCS bucket name for bank switcher |
| `GOOGLE_CLOUD_PROJECT` | `ninghai-ccai` | GCP project ID for GCS and Vertex AI |
| `GOOGLE_CLOUD_LOCATION` | `global` | Vertex AI location |
| `GEMINI_MODEL` | `gemini-4-hydrogen` | Model for Ask Gemini chat & Python code translation |
| `STUDY_GUIDE_MODEL` | `gemini-4-neon` | Model for structured Study Guide generation |
| `APP_PASSCODE_HASH` | *(unset -> disabled)* | Salted `scrypt` hash of the 4-digit keypad passcode |
| `SESSION_SECRET` | *(ephemeral)* | Hex secret for HMAC-SHA256 session cookie signing |
| `PORT` | `8765` (`8080` in Docker) | HTTP listen port |

## Deploying to Cloud Run

1. Upload your question bank bundle to GCS:
   ```bash
   uv run python scripts/sync_to_gcs.py --data-dir ~/fde_interview_questions --bucket <YOUR_BUCKET> --project <YOUR_PROJECT>
   ```
2. Generate a salted `scrypt` passcode hash and session secret:
   ```bash
   PASSCODE_HASH=$(uv run python -c "from app.auth import hash_passcode_scrypt; print(hash_passcode_scrypt('<4-DIGIT-PIN>'))")
   SESSION_SECRET=$(uv run python -c "import secrets; print(secrets.token_hex(32))")
   ```
3. Deploy to Cloud Run:
   ```bash
   gcloud run deploy swe6-study-guide \
     --project=<YOUR_PROJECT> \
     --region=us-central1 \
     --source=. \
     --memory=512Mi \
     --cpu=1 \
     --timeout=120 \
     --set-env-vars="^@^GCS_BUCKET=<YOUR_BUCKET>@GOOGLE_CLOUD_PROJECT=<YOUR_PROJECT>@GOOGLE_CLOUD_LOCATION=global@GEMINI_MODEL=gemini-4-hydrogen@STUDY_GUIDE_MODEL=gemini-4-neon@APP_PASSCODE_HASH=${PASSCODE_HASH}@SESSION_SECRET=${SESSION_SECRET}"
   ```

## Keyboard Shortcuts

- `/` — Focus search
- `j` / `k` — Next / Previous question
- `1`–`7` — Switch tabs (Problem, Hints, Solution, L6 Rubric, Study Guide, Notes, Ask Gemini)
- `b` — Bookmark / Unbookmark
- `h` — Hide / Unhide question
- `t` — Start / Pause 45-minute timer
- `?` — Show shortcuts dialog
