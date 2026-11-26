"""Authentication, scrypt passcode hashing, 3-strike lockout, and rate limiting.

TODO(security): Multi-user OAuth/OIDC and MFA are intentionally omitted because
this is a single-user personal study app safeguarded by a server-side scrypt
passcode gate with 10-minute lockout after 3 consecutive failed attempts.
"""

from __future__ import annotations

import base64
import collections
import hashlib
import hmac
import logging
import os
import secrets
import threading
import time
from http import HTTPStatus
from typing import Any

from app.config import LOCKOUT_DURATION_SEC, MAX_FAILED_ATTEMPTS, SESSION_TTL_SEC
from app.storage import StorageBackend

logger = logging.getLogger("swe6_study_guide.auth")


def hash_passcode_scrypt(passcode: str, salt: bytes | None = None) -> str:
    """Hash a passcode using memory-hard scrypt with a unique random salt."""
    if salt is None:
        salt = secrets.token_bytes(16)
    dk = hashlib.scrypt(passcode.encode("utf-8"), salt=salt, n=16384, r=8, p=1, dklen=32)
    return f"scrypt${base64.urlsafe_b64encode(salt).decode()}${base64.urlsafe_b64encode(dk).decode()}"


def verify_passcode_scrypt(passcode: str, encoded_hash: str) -> bool:
    """Verify a passcode against a stored scrypt$<salt>$<digest> string."""
    parts = encoded_hash.split("$")
    if len(parts) != 3 or parts[0] != "scrypt":
        return False
    try:
        salt = base64.urlsafe_b64decode(parts[1].encode("ascii"))
        expected = base64.urlsafe_b64decode(parts[2].encode("ascii"))
    except Exception:
        return False
    dk = hashlib.scrypt(passcode.encode("utf-8"), salt=salt, n=16384, r=8, p=1, dklen=32)
    return hmac.compare_digest(dk, expected)


def get_session_secret() -> bytes:
    """Resolve session signing secret from environment or generate an ephemeral one."""
    env_val = os.environ.get("SESSION_SECRET", "").strip()
    if env_val:
        return env_val.encode("utf-8")
    logger.warning("SESSION_SECRET not set; generating ephemeral secret (instance-isolated).")
    return secrets.token_bytes(32)


class RateLimiter:
    """Simple sliding-window rate limiter per client address."""

    def __init__(self, max_requests: int, window_sec: float) -> None:
        self._max_requests = max_requests
        self._window_sec = window_sec
        self._hits: dict[str, collections.deque[float]] = collections.defaultdict(collections.deque)
        self._lock = threading.Lock()

    def allow(self, key: str) -> bool:
        now = time.monotonic()
        with self._lock:
            q = self._hits[key]
            cutoff = now - self._window_sec
            while q and q[0] < cutoff:
                q.popleft()
            if len(q) >= self._max_requests:
                return False
            q.append(now)
            return True


class AuthManager:
    """Handles keypad passcode verification, durable 3-strike 10-min lockout, and signed sessions."""

    def __init__(self, backend: StorageBackend, passcode_hash: str, session_secret: bytes) -> None:
        self.backend = backend
        self.passcode_hash = passcode_hash.strip()
        self.session_secret = session_secret
        self._lock = threading.Lock()
        self._revoked_nonces: set[str] = set()

    @property
    def enabled(self) -> bool:
        return bool(self.passcode_hash)

    def _read_auth_state(self) -> dict[str, int]:
        raw = self.backend.read_json("auth_state.json") or {}
        return {
            "failed_attempts": int(raw.get("failed_attempts", 0)),
            "locked_until": int(raw.get("locked_until", 0)),
        }

    def _write_auth_state(self, failed_attempts: int, locked_until: int) -> None:
        self.backend.write_json(
            "auth_state.json",
            {"failed_attempts": failed_attempts, "locked_until": locked_until},
        )

    def get_lockout_info(self) -> dict[str, int]:
        now = int(time.time())
        with self._lock:
            st = self._read_auth_state()
            locked_until = st["locked_until"]
            failed = st["failed_attempts"]
            if locked_until > now:
                return {
                    "locked_until": locked_until,
                    "retry_after_sec": locked_until - now,
                    "attempts_remaining": 0,
                }
            return {
                "locked_until": 0,
                "retry_after_sec": 0,
                "attempts_remaining": max(0, MAX_FAILED_ATTEMPTS - failed),
            }

    def create_session_token(self) -> str:
        exp = int(time.time()) + SESSION_TTL_SEC
        nonce = secrets.token_urlsafe(16)
        payload = f"{exp}.{nonce}"
        sig = hmac.new(self.session_secret, payload.encode("utf-8"), hashlib.sha256).hexdigest()
        return f"{payload}.{sig}"

    def verify_session_token(self, token: str) -> bool:
        if not self.enabled:
            return True
        if not token:
            return False
        parts = token.split(".")
        if len(parts) != 3:
            return False
        exp_str, nonce, sig = parts
        if not exp_str.isdigit() or int(exp_str) <= int(time.time()):
            return False
        with self._lock:
            if nonce in self._revoked_nonces:
                return False
        payload = f"{exp_str}.{nonce}"
        expected = hmac.new(self.session_secret, payload.encode("utf-8"), hashlib.sha256).hexdigest()
        return hmac.compare_digest(sig, expected)

    def revoke_session_token(self, token: str) -> None:
        parts = (token or "").split(".")
        if len(parts) == 3:
            with self._lock:
                self._revoked_nonces.add(parts[1])

    def attempt_login(self, passcode: str) -> tuple[int, dict[str, Any], str | None]:
        """Returns (http_status, json_body, session_token_or_none)."""
        if not self.enabled:
            return HTTPStatus.OK, {"authenticated": True}, self.create_session_token()

        now = int(time.time())
        with self._lock:
            st = self._read_auth_state()
            if st["locked_until"] > now:
                remaining = st["locked_until"] - now
                return (
                    HTTPStatus.TOO_MANY_REQUESTS,
                    {
                        "error": "Login disabled for 10 minutes due to 3 consecutive failed attempts.",
                        "locked_until": st["locked_until"],
                        "retry_after_sec": remaining,
                        "attempts_remaining": 0,
                    },
                    None,
                )

            if verify_passcode_scrypt(passcode, self.passcode_hash):
                self._write_auth_state(0, 0)
                token = self.create_session_token()
                return (
                    HTTPStatus.OK,
                    {"authenticated": True, "locked_until": 0, "retry_after_sec": 0},
                    token,
                )

            failed = st["failed_attempts"] + 1
            if failed >= MAX_FAILED_ATTEMPTS:
                locked_until = now + LOCKOUT_DURATION_SEC
                self._write_auth_state(0, locked_until)
                return (
                    HTTPStatus.TOO_MANY_REQUESTS,
                    {
                        "error": "Too many incorrect attempts. Login disabled for 10 minutes.",
                        "locked_until": locked_until,
                        "retry_after_sec": LOCKOUT_DURATION_SEC,
                        "attempts_remaining": 0,
                    },
                    None,
                )

            self._write_auth_state(failed, 0)
            remaining_attempts = MAX_FAILED_ATTEMPTS - failed
            return (
                HTTPStatus.UNAUTHORIZED,
                {
                    "error": f"Incorrect code. {remaining_attempts} attempt(s) remaining.",
                    "locked_until": 0,
                    "retry_after_sec": 0,
                    "attempts_remaining": remaining_attempts,
                },
                None,
            )
