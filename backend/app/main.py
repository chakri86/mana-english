import csv
import io
import time
import uuid
from collections import defaultdict, deque
from contextlib import asynccontextmanager
from datetime import datetime, timezone

import jwt
from fastapi import Depends, FastAPI, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .content import find_question, load_week, student_week
from .db import Base, SessionLocal, engine, get_db, wait_for_database
from .models import AnswerAttempt, Assignment, LessonProgress, School, User
from .schemas import (
    AnswerRequest,
    AssignmentCreate,
    LoginRequest,
    LoginResponse,
    ProgressUpdate,
    ProgressView,
    TestSubmission,
    UserView,
)
from .security import create_access_token, decode_access_token, verify_secret
from .seed import seed_demo_data


WEEK_ONE = load_week(3, 1)
LESSONS = [
    {
        "id": lesson["id"],
        "day": lesson["day"],
        "title": lesson["title"],
        "telugu": lesson["telugu_title"],
        "duration_minutes": lesson["duration_minutes"],
        "xp": lesson["xp"],
    }
    for lesson in WEEK_ONE["lessons"]
]

bearer = HTTPBearer(auto_error=False)
failed_attempts: dict[str, deque[float]] = defaultdict(deque)
RATE_WINDOW_SECONDS = 600
RATE_LIMIT = 5
MASTERY_SCORE = 67


def reconcile_legacy_mastery(db: Session) -> None:
    lesson_ids = {lesson["id"] for lesson in LESSONS}
    records = db.scalars(
        select(LessonProgress).where(
            LessonProgress.lesson_id.in_(lesson_ids),
            LessonProgress.status == "completed",
            LessonProgress.score < MASTERY_SCORE,
        )
    ).all()
    for record in records:
        record.status = "needs_practice"
        record.xp = 0
        record.completed_at = None
    if records:
        db.commit()


@asynccontextmanager
async def lifespan(_: FastAPI):
    wait_for_database()
    Base.metadata.create_all(bind=engine)
    with SessionLocal() as db:
        seed_demo_data(db)
        reconcile_legacy_mastery(db)
    yield


app = FastAPI(
    title="Mana English API",
    version="0.5.2",
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
    return {"status": "ok", "service": "mana-english-api", "version": "0.5.2"}


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


def requested_week(grade: int, week: int, current: User) -> dict:
    if current.role == "student" and current.grade and current.grade != grade:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="This module is not assigned to your class")
    try:
        return load_week(grade, week)
    except FileNotFoundError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Learning module not found")


@app.get("/api/modules/{grade}/weeks/{week}")
def get_week_module(
    grade: int,
    week: int,
    current: User = Depends(get_current_user),
):
    requested_week(grade, week, current)
    if current.role == "student":
        return student_week(grade, week)
    return load_week(grade, week)


@app.post("/api/modules/{grade}/weeks/{week}/check")
def check_module_answer(
    grade: int,
    week: int,
    payload: AnswerRequest,
    current: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    module = requested_week(grade, week, current)
    question = find_question(module, payload.question_id)
    if question is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Question not found")
    if payload.selected_index >= len(question["choices"]):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Answer choice not found")
    correct = payload.selected_index == question["correct_index"]
    lesson = next(
        (item for item in module["lessons"] if any(q["id"] == payload.question_id for q in item["questions"])),
        None,
    )
    lesson_id = lesson["id"] if lesson else module["weekend_test"]["id"]
    if current.role == "student":
        db.add(
            AnswerAttempt(
                user_id=current.id,
                question_id=payload.question_id,
                lesson_id=lesson_id,
                activity=payload.activity,
                selected_index=payload.selected_index,
                correct_index=question["correct_index"],
                is_correct=correct,
                attempt_number=payload.attempt_number,
            )
        )
        db.commit()
    reveal_correct = not correct and payload.attempt_number >= 2
    return {
        "question_id": payload.question_id,
        "correct": correct,
        "attempt_number": payload.attempt_number,
        "reveal_correct": reveal_correct,
        "correct_index": question["correct_index"] if reveal_correct else None,
        "correct_answer": question["choices"][question["correct_index"]] if reveal_correct else None,
        "feedback": question.get("feedback", "Correct answer." if correct else "Review this phrase and try again."),
        "feedback_telugu": question.get("feedback_telugu", "సరైన సమాధానం." if correct else "ఈ వాక్యాన్ని మళ్లీ చూసి ప్రయత్నించండి."),
    }


def question_details(question_id: str) -> tuple[dict, dict] | None:
    for lesson in WEEK_ONE["lessons"]:
        question = next((item for item in lesson["questions"] if item["id"] == question_id), None)
        if question:
            return lesson, question
    question = next(
        (item for item in WEEK_ONE["weekend_test"]["questions"] if item["id"] == question_id),
        None,
    )
    if question:
        return WEEK_ONE["weekend_test"], question
    return None


def improvement_summary(db: Session, user: User) -> dict:
    attempts = db.scalars(
        select(AnswerAttempt)
        .where(AnswerAttempt.user_id == user.id)
        .order_by(AnswerAttempt.created_at)
    ).all()
    grouped: dict[str, list[AnswerAttempt]] = defaultdict(list)
    for attempt in attempts:
        grouped[attempt.question_id].append(attempt)

    questions = []
    for question_id, records in grouped.items():
        mistakes = [record for record in records if not record.is_correct]
        details = question_details(question_id)
        if not mistakes or details is None:
            continue
        lesson, question = details
        questions.append(
            {
                "question_id": question_id,
                "lesson_id": lesson["id"],
                "lesson_title": lesson["title"],
                "lesson_title_telugu": lesson["telugu_title"],
                "prompt": question["prompt"],
                "prompt_telugu": question["prompt_telugu"],
                "correct_answer": question["choices"][question["correct_index"]],
                "feedback": question.get("feedback", "Review the correct answer and practise again."),
                "feedback_telugu": question.get("feedback_telugu", "సరైన సమాధానాన్ని చూసి మళ్లీ సాధన చేయండి."),
                "mistake_count": len(mistakes),
                "last_attempt_correct": records[-1].is_correct,
                "status": "Improving" if records[-1].is_correct else "Needs practice",
            }
        )
    questions.sort(key=lambda item: (item["status"] != "Needs practice", -item["mistake_count"]))

    history = []
    for attempt in reversed([item for item in attempts if not item.is_correct]):
        details = question_details(attempt.question_id)
        if details is None:
            continue
        lesson, question = details
        history.append(
            {
                "question_id": attempt.question_id,
                "lesson_title": lesson["title"],
                "prompt": question["prompt"],
                "selected_answer": question["choices"][attempt.selected_index],
                "correct_answer": question["choices"][attempt.correct_index],
                "feedback_telugu": question.get("feedback_telugu", "సరైన సమాధానాన్ని చూసి మళ్లీ సాధన చేయండి."),
                "attempt_number": attempt.attempt_number,
                "activity": attempt.activity,
                "created_at": attempt.created_at.isoformat(),
            }
        )
    return {
        "total_mistakes": sum(item["mistake_count"] for item in questions),
        "needs_practice": sum(item["status"] == "Needs practice" for item in questions),
        "questions": questions,
        "history": history,
    }


@app.get("/api/improvements")
def get_improvements(current: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if current.role != "student":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Student account required")
    return improvement_summary(db, current)


def save_progress_record(
    db: Session,
    user: User,
    lesson_id: str,
    progress_status: str,
    score: int,
    xp: int,
) -> LessonProgress:
    record = db.scalar(
        select(LessonProgress).where(
            LessonProgress.user_id == user.id,
            LessonProgress.lesson_id == lesson_id,
        )
    )
    now = datetime.now(timezone.utc)
    was_completed = record is not None and record.status == "completed"
    if record is None:
        record = LessonProgress(user_id=user.id, lesson_id=lesson_id)
        db.add(record)
    else:
        record.attempts = (record.attempts or 0) + 1
    if not was_completed or progress_status == "completed":
        record.status = progress_status
    # SQLAlchemy applies Python column defaults during INSERT. Until the first
    # flush, a newly constructed progress record can still contain None here.
    record.score = max(record.score or 0, score)
    record.xp = max(record.xp or 0, xp)
    if not was_completed or progress_status == "completed":
        record.completed_at = now if progress_status == "completed" else None
    db.commit()
    db.refresh(record)
    return record


@app.post("/api/modules/{grade}/weeks/{week}/test/submit")
def submit_week_test(
    grade: int,
    week: int,
    payload: TestSubmission,
    current: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if current.role != "student":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Student account required")
    module = requested_week(grade, week, current)
    weekly_test = module["weekend_test"]
    questions = weekly_test["questions"]
    valid_ids = {question["id"] for question in questions}
    if not set(payload.answers).issubset(valid_ids):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Test contains an unknown question")
    correct_count = sum(
        payload.answers.get(question["id"]) == question["correct_index"]
        for question in questions
    )
    for question in questions:
        selected_index = payload.answers.get(question["id"])
        if selected_index is None or selected_index >= len(question["choices"]):
            continue
        db.add(
            AnswerAttempt(
                user_id=current.id,
                question_id=question["id"],
                lesson_id=weekly_test["id"],
                activity="test",
                selected_index=selected_index,
                correct_index=question["correct_index"],
                is_correct=selected_index == question["correct_index"],
                attempt_number=1,
            )
        )
    score = round((correct_count / len(questions)) * 100)
    passed = score >= weekly_test["pass_score"]
    xp = weekly_test["xp"] if passed else 10
    record = save_progress_record(db, current, weekly_test["id"], "completed", score, xp)
    return {
        "score": score,
        "correct": correct_count,
        "total": len(questions),
        "passed": passed,
        "xp": record.xp,
        "message": "Excellent work!" if passed else "Good try. Review the lessons and try again.",
        "message_telugu": "చాలా బాగా చేశారు!" if passed else "మంచి ప్రయత్నం. పాఠాలను మళ్లీ చూసి ప్రయత్నించండి.",
    }


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


def assignment_to_dict(assignment: Assignment) -> dict:
    return {
        "id": str(assignment.id),
        "grade": assignment.grade,
        "section": assignment.section,
        "lesson_id": assignment.lesson_id,
        "title": assignment.title,
        "due_date": assignment.due_date.isoformat(),
        "created_at": assignment.created_at.isoformat(),
    }


@app.get("/api/assignments")
def list_assignments(
    current: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    statement = select(Assignment).where(Assignment.school_id == current.school_id)
    if current.role == "student":
        statement = statement.where(
            Assignment.grade == (current.grade or 3),
            Assignment.section == (current.section or "A"),
        )
    assignments = db.scalars(statement.order_by(Assignment.due_date.desc())).all()
    return [assignment_to_dict(assignment) for assignment in assignments]


@app.post("/api/teacher/assignments", status_code=status.HTTP_201_CREATED)
def create_assignment(
    payload: AssignmentCreate,
    current: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if current.role not in {"teacher", "admin"}:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Teacher account required")
    lesson = next((item for item in LESSONS if item["id"] == payload.lesson_id), None)
    if lesson is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Lesson not found")
    assignment = Assignment(
        school_id=current.school_id,
        assigned_by=current.id,
        grade=payload.grade,
        section=payload.section,
        lesson_id=payload.lesson_id,
        title=lesson["title"],
        due_date=payload.due_date,
    )
    db.add(assignment)
    db.commit()
    db.refresh(assignment)
    return assignment_to_dict(assignment)


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
    record = save_progress_record(db, current, lesson_id, payload.status, payload.score, payload.xp)
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
        improvements = improvement_summary(db, student)
        lesson_records = [r for r in records if "-lesson" in r.lesson_id and r.status == "completed"]
        test_record = next((r for r in records if r.lesson_id.endswith("week1-test")), None)
        xp = sum(r.xp for r in records)
        accuracy = test_record.score if test_record else 0
        total_accuracy += accuracy
        total_lessons += len(lesson_records)
        if accuracy >= 90 and improvements["needs_practice"] == 0:
            student_status = "Excellent"
        elif accuracy >= 75 and improvements["needs_practice"] <= 1:
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
                "mistakes": improvements["total_mistakes"],
                "improvement_area": improvements["questions"][0]["lesson_title"] if improvements["questions"] else "None yet",
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
            "speaking_reviews": 0,
        },
        "students": student_rows,
    }


@app.get("/api/teacher/report.csv")
def download_teacher_report(
    current: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    data = teacher_dashboard(current, db)
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["Student", "Student ID", "XP", "Lessons completed", "Lessons total", "Week 1 test", "Mistakes", "Main improvement area", "Status"])
    for student in data["students"]:
        writer.writerow(
            [
                student["name"],
                student["username"],
                student["xp"],
                student["lessons_completed"],
                student["lessons_total"],
                student["test_score"],
                student["mistakes"],
                student["improvement_area"],
                student["status"],
            ]
        )
    headers = {"Content-Disposition": 'attachment; filename="mana-english-class3a-week1.csv"'}
    return StreamingResponse(iter([output.getvalue()]), media_type="text/csv; charset=utf-8", headers=headers)
