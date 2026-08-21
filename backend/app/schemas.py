from datetime import date
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
    status: Literal["started", "needs_practice", "completed"] = "completed"
    score: int = Field(default=0, ge=0, le=100)
    xp: int = Field(default=0, ge=0, le=100)


class ProgressView(BaseModel):
    lesson_id: str
    status: str
    score: int
    xp: int
    attempts: int
    completed_at: str | None


class AnswerRequest(BaseModel):
    question_id: str = Field(min_length=3, max_length=40)
    selected_index: int = Field(ge=0, le=10)
    attempt_number: int = Field(default=1, ge=1, le=2)
    activity: Literal["lesson", "practice"] = "lesson"


class TestSubmission(BaseModel):
    answers: dict[str, int] = Field(min_length=1, max_length=20)

    @field_validator("answers")
    @classmethod
    def validate_answer_indexes(cls, answers: dict[str, int]) -> dict[str, int]:
        if any(index < 0 or index > 10 for index in answers.values()):
            raise ValueError("Answer indexes must be between 0 and 10")
        return answers


class AssignmentCreate(BaseModel):
    grade: int = Field(ge=3, le=5)
    section: str = Field(default="A", min_length=1, max_length=10)
    lesson_id: str = Field(min_length=5, max_length=80)
    due_date: date

    @field_validator("section")
    @classmethod
    def normalize_section(cls, value: str) -> str:
        return value.strip().upper()
