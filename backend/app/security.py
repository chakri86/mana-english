import base64
import hashlib
import hmac
import os
import secrets
import uuid
from datetime import datetime, timedelta, timezone

import jwt


PBKDF2_ITERATIONS = 600_000
JWT_ALGORITHM = "HS256"
JWT_SECRET = os.getenv("JWT_SECRET", "")
TOKEN_HOURS = int(os.getenv("TOKEN_HOURS", "8"))


def hash_secret(secret: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac(
        "sha256", secret.encode("utf-8"), salt, PBKDF2_ITERATIONS
    )
    return "$".join(
        (
            "pbkdf2_sha256",
            str(PBKDF2_ITERATIONS),
            base64.urlsafe_b64encode(salt).decode("ascii"),
            base64.urlsafe_b64encode(digest).decode("ascii"),
        )
    )


def verify_secret(secret: str, encoded: str) -> bool:
    try:
        algorithm, iterations, salt_b64, expected_b64 = encoded.split("$", 3)
        if algorithm != "pbkdf2_sha256":
            return False
        salt = base64.urlsafe_b64decode(salt_b64.encode("ascii"))
        expected = base64.urlsafe_b64decode(expected_b64.encode("ascii"))
        actual = hashlib.pbkdf2_hmac(
            "sha256", secret.encode("utf-8"), salt, int(iterations)
        )
        return hmac.compare_digest(actual, expected)
    except (ValueError, TypeError):
        return False


def create_access_token(
    user_id: uuid.UUID, role: str, school_id: uuid.UUID
) -> tuple[str, int]:
    if len(JWT_SECRET) < 32:
        raise RuntimeError("JWT_SECRET must be at least 32 characters")
    now = datetime.now(timezone.utc)
    expires = now + timedelta(hours=TOKEN_HOURS)
    payload = {
        "sub": str(user_id),
        "role": role,
        "school_id": str(school_id),
        "iat": now,
        "exp": expires,
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM), TOKEN_HOURS * 3600


def decode_access_token(token: str) -> dict:
    if len(JWT_SECRET) < 32:
        raise RuntimeError("JWT_SECRET must be at least 32 characters")
    return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
