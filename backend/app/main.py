import time
import uuid
from collections import defaultdict, deque
from contextlib import asynccontextmanager
from datetime import datetime, timezone

import jwt
from fastapi import Depends, FastAPI, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .db import Base, SessionLocal, engine, get_db, wait_for_database
from .models import LessonProgress, School, User
from .schemas import (
    LoginRequest,
    LoginResponse,
    ProgressUpdate,
    ProgressView,
    UserView,
)
from .security import create_access_token, decode_access_token, verify_secret
from .seed import seed_demo_data


LESSONS = [
    {
        "id": "class3-unit1-lesson1",
        "day": "MON",
        "title": "Hello!",
        "telugu": "హలో!",
        "duration_minutes": 10,
        "xp": 20,
    },
    {
        "id": "class3-unit1-lesson2",
        "day": "TUE",
        "title": "My name is…",
        "telugu": "నా పేరు…",
        "duration_minutes": 12,
        "xp": 20,
    },
    {
        "id": "class3-unit1-lesson3",
        "day": "WED",
        "title": "How are you?",
        "telugu": "మీరు ఎలా ఉన్నారు?",
        "duration_minutes": 12,
        "xp": 20,
    },
    {
        "id": "class3-unit1-lesson4",
        "day": "THU",
        "title": "I am fine",
        "telugu": "నేను బాగున్నాను",
        "duration_minutes": 12,
        "xp": 20,
    },
    {
        "id": "class3-unit1-lesson5",
        "day": "FRI",
        "title": "Let’s practise",
        "telugu": "అభ్యాసం చేద్దాం",
        "duration_minutes": 15,
        "xp": 20,
    },
]

bearer = HTTPBearer(auto_error=False)
failed_attempts: dict[str, deque[float]] = defaultdict(deque)
RATE_WINDOW_SECONDS = 600
RATE_LIMIT = 5


@asynccontextmanager
async def lifespan(_: FastAPI):
    wait_for_database()
    Base.metadata.create_all(bind=engine)
    with SessionLocal() as db:
        seed_demo_data(db)
    yield


app = FastAPI(
    title="Mana English API",
    version="0.2.0",
    docs_url="/api/docs",
    openapi_url="/api/openapi.json",
    redoc_url=None,
    lifespan=lifespan,
)


def user_to_view(db: Session, user: User) -> UserView:
    school = db.get(School, user.school_id)
    xp = db.scalar(
        select(func.coalesce(func.sum(LessonProgress.xp), 0)).where(
            LessonProgress.user_id == user.id
        )
    )
    return UserView(
        id=str(user.id),
        school_code=school.code,
        school_name=school.name,
        username=user.username,
        display_name=user.display_name,
        role=user.role,
        grade=user.grade,
        section=user.section,
        xp=int(xp or 0),
    )


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: Session = Depends(get_db),
) -> User:
    if credentials is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required")
    try:
        payload = decode_access_token(credentials.credentials)
        user_id = uuid.UUID(payload["sub"])
    except (jwt.InvalidTokenError, ValueError, KeyError):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired session")
    user = db.get(User, user_id)
    if user is None or not user.active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Account is unavailable")
    return user


def login_rate_key(request: Request, payload: LoginRequest) -> str:
    client_ip = request.client.host if request.client else "unknown"
    return f"{client_ip}:{payload.school_code}:{payload.username}"


def check_rate_limit(key: str) -> None:
    now = time.monotonic()
    attempts = failed_attempts[key]
    while attempts and now - attempts[0] > RATE_WINDOW_SECONDS:
        attempts.popleft()
    if len(attempts) >= RATE_LIMIT:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many attempts. Please wait 10 minutes.",
        )


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok", "service": "mana-english-api", "version": "0.2.0"}


@app.post("/api/auth/login", response_model=LoginResponse)
def login(payload: LoginRequest, request: Request, db: Session = Depends(get_db)):
    key = login_rate_key(request, payload)
    check_rate_limit(key)
    school = db.scalar(select(School).where(School.code == payload.school_code))
    user = None
    if school is not None:
        user = db.scalar(
            select(User).where(
                User.school_id == school.id,
                User.username == payload.username,
                User.active.is_(True),
            )
        )
    if user is None or not verify_secret(payload.secret, user.password_hash):
        failed_attempts[key].append(time.monotonic())
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid school code or credentials")
    failed_attempts.pop(key, None)
    token, expires_in = create_access_token(user.id, user.role, user.school_id)
    return LoginResponse(
        access_token=token,
        expires_in=expires_in,
        user=user_to_view(db, user),
    )


@app.get("/api/auth/me", response_model=UserView)
def me(current: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return user_to_view(db, current)


@app.get("/api/lessons")
def list_lessons(current: User = Depends(get_current_user)):
    return {"grade": current.grade or 3, "unit": 1, "lessons": LESSONS}


@app.get("/api/progress", response_model=list[ProgressView])
def get_progress(current: User = Depends(get_current_user), db: Session = Depends(get_db)):
    records = db.scalars(
        select(LessonProgress)
        .where(LessonProgress.user_id == current.id)
        .order_by(LessonProgress.lesson_id)
    ).all()
    return [
        ProgressView(
            lesson_id=record.lesson_id,
            status=record.status,
            score=record.score,
            xp=record.xp,
            attempts=record.attempts,
            completed_at=record.completed_at.isoformat() if record.completed_at else None,
        )
        for record in records
    ]


@app.put("/api/progress/{lesson_id}", response_model=ProgressView)
def save_progress(
    lesson_id: str,
    payload: ProgressUpdate,
    current: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if current.role != "student":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Student account required")
    valid_ids = {lesson["id"] for lesson in LESSONS} | {"class3-unit1-week1-test"}
    if lesson_id not in valid_ids:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Lesson not found")
    record = db.scalar(
        select(LessonProgress).where(
            LessonProgress.user_id == current.id,
            LessonProgress.lesson_id == lesson_id,
        )
    )
    now = datetime.now(timezone.utc)
    if record is None:
        record = LessonProgress(user_id=current.id, lesson_id=lesson_id)
        db.add(record)
    else:
        record.attempts += 1
    record.status = payload.status
    record.score = max(record.score, payload.score)
    record.xp = max(record.xp, payload.xp)
    record.completed_at = now if payload.status == "completed" else record.completed_at
    db.commit()
    db.refresh(record)
    return ProgressView(
        lesson_id=record.lesson_id,
        status=record.status,
        score=record.score,
        xp=record.xp,
        attempts=record.attempts,
        completed_at=record.completed_at.isoformat() if record.completed_at else None,
    )


@app.get("/api/teacher/dashboard")
def teacher_dashboard(
    current: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if current.role not in {"teacher", "admin"}:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Teacher account required")
    students = db.scalars(
        select(User)
        .where(
            User.school_id == current.school_id,
            User.role == "student",
            User.active.is_(True),
        )
        .order_by(User.display_name)
    ).all()
    student_rows = []
    total_accuracy = 0
    total_lessons = 0
    for student in students:
        records = db.scalars(
            select(LessonProgress).where(LessonProgress.user_id == student.id)
        ).all()
        lesson_records = [r for r in records if "-lesson" in r.lesson_id and r.status == "completed"]
        test_record = next((r for r in records if r.lesson_id.endswith("week1-test")), None)
        xp = sum(r.xp for r in records)
        accuracy = test_record.score if test_record else 0
        total_accuracy += accuracy
        total_lessons += len(lesson_records)
        if accuracy >= 90:
            student_status = "Excellent"
        elif accuracy >= 75:
            student_status = "On track"
        else:
            student_status = "Needs help"
        student_rows.append(
            {
                "id": str(student.id),
                "name": student.display_name,
                "username": student.username,
                "xp": xp,
                "lessons_completed": len(lesson_records),
                "lessons_total": 5,
                "test_score": accuracy,
                "status": student_status,
            }
        )
    student_count = len(students)
    return {
        "school": current.school.name,
        "class_name": "Class 3A",
        "metrics": {
            "active_students": student_count,
            "total_students": student_count,
            "lessons_completed": total_lessons,
            "average_accuracy": round(total_accuracy / student_count) if student_count else 0,
            "speaking_reviews": 7,
        },
        "students": student_rows,
    }
