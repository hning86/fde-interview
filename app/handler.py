"""HTTP request handler with Double-Submit Cookie CSRF, keypad auth, and static serving."""

from __future__ import annotations

import hmac
import json
import logging
import mimetypes
import secrets
import urllib.parse
from dataclasses import dataclass
from http import HTTPStatus
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler
from typing import Any

from app.auth import AuthManager, RateLimiter
from app.config import (
    ALLOWED_COACH_MODES,
    IS_CLOUD_RUN,
    MAX_BODY_BYTES,
    MAX_CHAT_MSG_LENGTH,
    MAX_STUDY_GUIDE_BODY_BYTES,
    MAX_STUDY_GUIDE_LENGTH,
    SESSION_TTL_SEC,
    STATIC_DIR,
    ensure_within_dir,
    is_translatable_source_lang,
)
from app.gemini import GeminiCoach
from app.store import StudyGuideStore

logger = logging.getLogger("swe6_study_guide.http")


@dataclass(frozen=True)
class BankEntry:
    bank_id: str
    label: str
    store: StudyGuideStore
    storage_label: str


def make_handler(
    banks: dict[str, BankEntry],
    default_bank_id: str,
    coach: GeminiCoach,
    auth: AuthManager,
    rate_limiter: RateLimiter,
):
    """Build a request handler class wired to question banks, coach, auth, and rate limiter."""

    csrf_cookie_name = "__Host-csrf" if IS_CLOUD_RUN else "swe6_csrf"
    session_cookie_name = "__Host-session" if IS_CLOUD_RUN else "swe6_session"

    class StudyGuideHandler(BaseHTTPRequestHandler):
        server_version = "SWE6StudyGuide/2.3"

        def _resolve_bank(self, query_str: str) -> BankEntry:
            qs = urllib.parse.parse_qs(query_str)
            requested = (qs.get("bank") or [default_bank_id])[0].strip().lower()
            return banks.get(requested) or banks[default_bank_id]

        def log_message(self, format: str, *args: Any) -> None:
            logger.info("%s - %s", self.client_address[0], format % args)

        # ---- Cookie & Response Helpers ----

        def _get_cookie(self, name: str) -> str:
            raw = self.headers.get("Cookie", "")
            if not raw:
                return ""
            cookie = SimpleCookie()
            try:
                cookie.load(raw)
            except Exception:
                return ""
            morsel = cookie.get(name)
            return morsel.value if morsel else ""

        def _cookie_attrs(self, name: str, value: str, max_age: int | None = None) -> str:
            attrs = f"{name}={value}; Path=/; SameSite=Lax; HttpOnly"
            if max_age is not None:
                attrs += f"; Max-Age={max_age}"
            if IS_CLOUD_RUN:
                attrs += "; Secure"
            return attrs

        def _send_security_headers(self, is_api: bool = False, cookies: list[str] | None = None) -> None:
            self.send_header(
                "Content-Security-Policy",
                "default-src 'self'; script-src 'self'; style-src 'self'; "
                "img-src 'self' data:; font-src 'self'; object-src 'none'; "
                "frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
            )
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("X-Frame-Options", "DENY")
            self.send_header("Referrer-Policy", "no-referrer")
            self.send_header("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
            if is_api:
                self.send_header("Cache-Control", "no-store")
            for cookie_str in cookies or []:
                self.send_header("Set-Cookie", cookie_str)

        def _send_json(self, status: int, data: Any, cookies: list[str] | None = None) -> None:
            body = json.dumps(data, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            self._send_security_headers(is_api=True, cookies=cookies)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def _send_error_json(self, status: int, message: str) -> None:
            self._send_json(status, {"error": message})

        def _read_json_body(self, max_bytes: int = MAX_BODY_BYTES) -> dict[str, Any] | None:
            try:
                length = int(self.headers.get("Content-Length", "0"))
            except ValueError:
                self._send_error_json(HTTPStatus.BAD_REQUEST, "Invalid Content-Length")
                return None
            if length <= 0 or length > max_bytes:
                self._send_error_json(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, "Payload size out of bounds")
                return None
            raw = self.rfile.read(length)
            try:
                data = json.loads(raw.decode("utf-8"))
            except (UnicodeDecodeError, json.JSONDecodeError):
                self._send_error_json(HTTPStatus.BAD_REQUEST, "Invalid JSON payload")
                return None
            if not isinstance(data, dict):
                self._send_error_json(HTTPStatus.BAD_REQUEST, "JSON payload must be an object")
                return None
            return data

        # ---- Security Guards ----

        def _check_host_and_origin(self) -> bool:
            host_only = (self.headers.get("Host") or "").strip().lower().split(":")[0]
            if not IS_CLOUD_RUN and host_only not in {"127.0.0.1", "localhost"}:
                self._send_error_json(HTTPStatus.FORBIDDEN, "Forbidden host")
                return False
            origin = self.headers.get("Origin")
            if origin:
                origin_host = (urllib.parse.urlparse(origin).hostname or "").lower()
                if not IS_CLOUD_RUN:
                    if origin_host not in {"127.0.0.1", "localhost"}:
                        self._send_error_json(HTTPStatus.FORBIDDEN, "Forbidden origin")
                        return False
                elif origin_host != host_only:
                    self._send_error_json(HTTPStatus.FORBIDDEN, "Origin mismatch")
                    return False
            return True

        def _check_rate_limit(self) -> bool:
            forwarded = (self.headers.get("X-Forwarded-For") or "").split(",")[0].strip()
            key = forwarded or self.client_address[0]
            if not rate_limiter.allow(key):
                self._send_error_json(HTTPStatus.TOO_MANY_REQUESTS, "Rate limit exceeded")
                return False
            return True

        def _verify_csrf(self) -> bool:
            cookie_val = self._get_cookie(csrf_cookie_name)
            header_val = self.headers.get("X-CSRF-Token", "")
            if not cookie_val or not header_val or not hmac.compare_digest(cookie_val, header_val):
                self._send_error_json(HTTPStatus.FORBIDDEN, "Invalid or missing CSRF token")
                return False
            return True

        def _is_authenticated(self) -> bool:
            if not auth.enabled:
                return True
            return auth.verify_session_token(self._get_cookie(session_cookie_name))

        def _require_auth(self) -> bool:
            if not self._is_authenticated():
                self._send_error_json(HTTPStatus.UNAUTHORIZED, "Authentication required")
                return False
            return True

        def _ensure_csrf(self) -> tuple[str, list[str]]:
            csrf = self._get_cookie(csrf_cookie_name)
            cookies: list[str] = []
            if not csrf:
                csrf = secrets.token_urlsafe(32)
                cookies.append(self._cookie_attrs(csrf_cookie_name, csrf))
            return csrf, cookies

        # ---- GET Handlers ----

        def do_GET(self) -> None:
            if not self._check_host_and_origin() or not self._check_rate_limit():
                return

            parsed = urllib.parse.urlparse(self.path)
            path = parsed.path

            if path == "/api/auth/status":
                csrf, cookies = self._ensure_csrf()
                self._send_json(
                    HTTPStatus.OK,
                    {
                        "auth_enabled": auth.enabled,
                        "authenticated": self._is_authenticated(),
                        "csrf_token": csrf,
                        **auth.get_lockout_info(),
                    },
                    cookies=cookies,
                )
                return

            if path.startswith("/api/"):
                if self._require_auth():
                    self._handle_api_get(path, parsed.query)
                return

            self._serve_static(path)

        def _handle_api_get(self, path: str, query_str: str) -> None:
            bank = self._resolve_bank(query_str)
            store = bank.store

            if path == "/api/bootstrap":
                csrf, cookies = self._ensure_csrf()
                bank_summaries = [
                    {
                        "id": entry.bank_id,
                        "label": entry.label,
                        "count": len(entry.store.index),
                        "storage_label": entry.storage_label,
                    }
                    for entry in banks.values()
                ]
                self._send_json(
                    HTTPStatus.OK,
                    {
                        "csrf_token": csrf,
                        "auth_enabled": auth.enabled,
                        "active_bank": bank.bank_id,
                        "banks": bank_summaries,
                        "storage_label": bank.storage_label,
                        "gemini_model": coach.model,
                        "manifest": {
                            "question_count": len(store.index),
                            "generated_at_utc": store.manifest.get("generated_at_utc", ""),
                            "confidentiality": store.manifest.get("confidentiality", ""),
                        },
                        "questions": store.index,
                        "progress": store.get_progress_snapshot(),
                    },
                    cookies=cookies,
                )
                return

            if path == "/api/search":
                qs = urllib.parse.parse_qs(query_str)
                query = (qs.get("q") or [""])[0][:200]
                self._send_json(HTTPStatus.OK, {"ids": store.search_ids(query)})
                return

            if path.startswith("/api/questions/"):
                id_part = path[len("/api/questions/") :]
                if not id_part.isdigit():
                    self._send_error_json(HTTPStatus.BAD_REQUEST, "Invalid question ID")
                    return
                q = store.get_question(int(id_part))
                if not q:
                    self._send_error_json(HTTPStatus.NOT_FOUND, "Question not found")
                    return
                self._send_json(HTTPStatus.OK, q)
                return

            if path.startswith("/api/chat/"):
                id_part = path[len("/api/chat/") :]
                if not id_part.isdigit():
                    self._send_error_json(HTTPStatus.BAD_REQUEST, "Invalid question ID")
                    return
                try:
                    messages = store.get_chat_thread(int(id_part))
                except KeyError:
                    self._send_error_json(HTTPStatus.NOT_FOUND, "Question not found")
                    return
                self._send_json(HTTPStatus.OK, {"question_id": int(id_part), "messages": messages})
                return

            self._send_error_json(HTTPStatus.NOT_FOUND, "Endpoint not found")

        def _serve_static(self, path: str) -> None:
            rel = "index.html" if path in {"", "/"} else path.lstrip("/")
            if "/" in rel or "\\" in rel or ".." in rel:
                self._send_error_json(HTTPStatus.NOT_FOUND, "Not found")
                return
            try:
                target = ensure_within_dir(STATIC_DIR, STATIC_DIR / rel)
            except ValueError:
                self._send_error_json(HTTPStatus.FORBIDDEN, "Forbidden")
                return
            if not target.is_file():
                self._send_error_json(HTTPStatus.NOT_FOUND, "Not found")
                return

            content = target.read_bytes()
            ctype, _ = mimetypes.guess_type(str(target))
            if not ctype:
                ctype = "application/octet-stream"
            elif ctype.startswith("text/") or ctype == "application/javascript":
                ctype = f"{ctype}; charset=utf-8"

            self.send_response(HTTPStatus.OK)
            self._send_security_headers(is_api=False)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(content)))
            self.end_headers()
            self.wfile.write(content)

        # ---- POST Handlers ----

        def do_POST(self) -> None:
            if not self._check_host_and_origin() or not self._check_rate_limit():
                return
            if not self._verify_csrf():
                return

            parsed = urllib.parse.urlparse(self.path)
            path = parsed.path

            if path == "/api/auth/login":
                self._handle_login()
                return
            if path == "/api/auth/logout":
                auth.revoke_session_token(self._get_cookie(session_cookie_name))
                cookies = [self._cookie_attrs(session_cookie_name, "", max_age=0)]
                self._send_json(HTTPStatus.OK, {"ok": True}, cookies=cookies)
                return

            if not self._require_auth():
                return

            store = self._resolve_bank(parsed.query).store

            if path.startswith("/api/questions/") and path.endswith("/python"):
                self._handle_generate_python(store, path[len("/api/questions/") : -len("/python")])
                return
            if path.startswith("/api/questions/") and path.endswith("/study-guide/save"):
                self._handle_save_study_guide(store, path[len("/api/questions/") : -len("/study-guide/save")])
                return
            if path.startswith("/api/questions/") and path.endswith("/study-guide"):
                self._handle_generate_study_guide(store, path[len("/api/questions/") : -len("/study-guide")])
                return
            if path == "/api/progress/reset":
                store.reset_progress()
                self._send_json(HTTPStatus.OK, {"ok": True})
                return
            if path.startswith("/api/progress/"):
                self._handle_update_progress(store, path[len("/api/progress/") :])
                return
            if path.startswith("/api/chat/") and path.endswith("/clear"):
                self._handle_clear_chat(store, path[len("/api/chat/") : -len("/clear")])
                return
            if path.startswith("/api/chat/"):
                self._handle_chat_message(store, path[len("/api/chat/") :])
                return

            self._send_error_json(HTTPStatus.NOT_FOUND, "Endpoint not found")

        def _handle_login(self) -> None:
            body = self._read_json_body()
            if body is None:
                return
            code = body.get("code")
            if not isinstance(code, str) or not code.isdigit() or len(code) != 4:
                self._send_error_json(HTTPStatus.BAD_REQUEST, "Passcode must be 4 digits")
                return
            status, resp_body, token = auth.attempt_login(code)
            cookies = [self._cookie_attrs(session_cookie_name, token, max_age=SESSION_TTL_SEC)] if token else None
            self._send_json(status, resp_body, cookies=cookies)

        def _handle_generate_python(self, store: StudyGuideStore, id_part: str) -> None:
            if not id_part.isdigit():
                self._send_error_json(HTTPStatus.BAD_REQUEST, "Invalid question ID")
                return
            qid = int(id_part)
            q = store.get_question(qid)
            if not q:
                self._send_error_json(HTTPStatus.NOT_FOUND, "Question not found")
                return
            sol = q.get("solution") or {}
            if not sol.get("needs_generated_python"):
                self._send_error_json(
                    HTTPStatus.BAD_REQUEST,
                    "Question either already includes Python or has no Java/Go/C++ code",
                )
                return
            body = self._read_json_body() or {}
            force = bool(body.get("force", False))
            cached = store.get_generated_python(qid)
            if cached and not force:
                self._send_json(HTTPStatus.OK, cached)
                return

            source_langs = [
                str(cs.get("language", ""))
                for cs in (sol.get("code_snippets") or [])
                if is_translatable_source_lang(str(cs.get("language", "")).lower())
            ]
            if not source_langs:
                desc_low = (sol.get("description_md") or "").lower()
                if "c++" in desc_low or "#include" in desc_low or "std::" in desc_low:
                    source_langs.append("C++")
                if "java" in desc_low:
                    source_langs.append("Java")
                if "golang" in desc_low or "func " in desc_low:
                    source_langs.append("Go")
                if not source_langs:
                    source_langs = ["Java/Go/C++"]
            try:
                code_md = coach.translate_to_python(q)
            except Exception as exc:
                logger.exception("Python translation failed: %s", exc)
                self._send_error_json(
                    HTTPStatus.BAD_GATEWAY,
                    "Failed to generate Python translation. Please try again.",
                )
                return
            saved = store.save_generated_python(qid, code_md, coach.model, source_langs)
            self._send_json(HTTPStatus.OK, saved)

        def _handle_generate_study_guide(self, store: StudyGuideStore, id_part: str) -> None:
            if not id_part.isdigit():
                self._send_error_json(HTTPStatus.BAD_REQUEST, "Invalid question ID")
                return
            qid = int(id_part)
            q = store.get_question(qid)
            if not q:
                self._send_error_json(HTTPStatus.NOT_FOUND, "Question not found")
                return
            body = self._read_json_body() or {}
            force = bool(body.get("force", False))
            cached = store.get_study_guide(qid)
            if cached and not force:
                self._send_json(HTTPStatus.OK, cached)
                return
            try:
                guide_md = coach.generate_study_guide(q)
            except Exception as exc:
                logger.exception("Study guide generation failed: %s", exc)
                self._send_error_json(
                    HTTPStatus.BAD_GATEWAY,
                    "Failed to generate study guide. Please try again.",
                )
                return
            saved = store.save_study_guide(qid, guide_md, coach.study_guide_model)
            self._send_json(HTTPStatus.OK, saved)

        def _handle_save_study_guide(self, store: StudyGuideStore, id_part: str) -> None:
            if not id_part.isdigit():
                self._send_error_json(HTTPStatus.BAD_REQUEST, "Invalid question ID")
                return
            qid = int(id_part)
            if not store.get_question(qid):
                self._send_error_json(HTTPStatus.NOT_FOUND, "Question not found")
                return
            body = self._read_json_body(max_bytes=MAX_STUDY_GUIDE_BODY_BYTES)
            if body is None:
                return
            guide_md = body.get("guide_md")
            if not isinstance(guide_md, str) or not guide_md.strip() or len(guide_md) > MAX_STUDY_GUIDE_LENGTH:
                self._send_error_json(
                    HTTPStatus.BAD_REQUEST,
                    f"guide_md must be 1..{MAX_STUDY_GUIDE_LENGTH} characters",
                )
                return
            saved = store.save_study_guide(qid, guide_md, coach.study_guide_model, edited=True)
            self._send_json(HTTPStatus.OK, saved)

        def _handle_update_progress(self, store: StudyGuideStore, id_part: str) -> None:
            if not id_part.isdigit():
                self._send_error_json(HTTPStatus.BAD_REQUEST, "Invalid question ID")
                return
            body = self._read_json_body()
            if body is None:
                return
            try:
                updated = store.update_question_progress(int(id_part), body)
            except KeyError:
                self._send_error_json(HTTPStatus.NOT_FOUND, "Question not found")
                return
            except ValueError as exc:
                self._send_error_json(HTTPStatus.BAD_REQUEST, str(exc))
                return
            self._send_json(HTTPStatus.OK, {"id": int(id_part), "progress": updated})

        def _handle_clear_chat(self, store: StudyGuideStore, id_part: str) -> None:
            if not id_part.isdigit():
                self._send_error_json(HTTPStatus.BAD_REQUEST, "Invalid question ID")
                return
            try:
                store.clear_chat_thread(int(id_part))
            except KeyError:
                self._send_error_json(HTTPStatus.NOT_FOUND, "Question not found")
                return
            self._send_json(HTTPStatus.OK, {"ok": True, "messages": []})

        def _handle_chat_message(self, store: StudyGuideStore, id_part: str) -> None:
            if not id_part.isdigit():
                self._send_error_json(HTTPStatus.BAD_REQUEST, "Invalid question ID")
                return
            qid = int(id_part)
            q = store.get_question(qid)
            if not q:
                self._send_error_json(HTTPStatus.NOT_FOUND, "Question not found")
                return
            body = self._read_json_body()
            if body is None:
                return
            message = body.get("message")
            coach_mode = str(body.get("coach_mode", "tutor"))
            if not isinstance(message, str) or not message.strip() or len(message) > MAX_CHAT_MSG_LENGTH:
                self._send_error_json(
                    HTTPStatus.BAD_REQUEST,
                    f"Message must be 1..{MAX_CHAT_MSG_LENGTH} characters",
                )
                return
            if coach_mode not in ALLOWED_COACH_MODES:
                self._send_error_json(HTTPStatus.BAD_REQUEST, "Invalid coach_mode")
                return

            history = store.get_chat_thread(qid)
            try:
                reply_text = coach.ask(q, history, message.strip(), coach_mode)
            except Exception as exc:
                logger.exception("Gemini request failed: %s", exc)
                self._send_error_json(
                    HTTPStatus.BAD_GATEWAY,
                    "Gemini service is temporarily unavailable. Please try again.",
                )
                return

            messages = store.append_chat_turn(qid, message.strip(), reply_text, coach_mode)
            self._send_json(HTTPStatus.OK, {"question_id": qid, "messages": messages})

        # ---- Disallowed HTTP Methods ----

        def do_PUT(self) -> None:
            self._send_error_json(HTTPStatus.METHOD_NOT_ALLOWED, "Method not allowed")

        def do_DELETE(self) -> None:
            self._send_error_json(HTTPStatus.METHOD_NOT_ALLOWED, "Method not allowed")

        def do_PATCH(self) -> None:
            self._send_error_json(HTTPStatus.METHOD_NOT_ALLOWED, "Method not allowed")

        def do_TRACE(self) -> None:
            self._send_error_json(HTTPStatus.METHOD_NOT_ALLOWED, "Method not allowed")

    return StudyGuideHandler
