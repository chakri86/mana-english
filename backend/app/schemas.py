from typing import Literal

from pydantic import BaseModel, Field, field_validator


class LoginRequest(BaseModel):
    school_code: str = Field(min_length=3, max_length=20)
    username: str = Field(min_length=2, max_length=60)
    secret: str = Field(min_length=4, max_length=128)

    @field_validator("school_code", "username")
    @classmethod
    def normalize_identifier(cls, value: str) -> str:
        return value.strip().upper()


class UserView(BaseModel):
    id: str
    school_code: str
    school_name: str
    username: str
    display_name: str
    role: str
    grade: int | None
    section: str | None
    xp: int = 0


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    user: UserView


class ProgressUpdate(BaseModel):
    status: Literal["started", "completed"] = "completed"
    score: int = Field(default=0, ge=0, le=100)
    xp: int = Field(default=0, ge=0, le=100)


class ProgressView(BaseModel):
    lesson_id: str
    status: str
    score: int
    xp: int
    attempts: int
    completed_at: str | None
