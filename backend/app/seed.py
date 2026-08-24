import os
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import LessonProgress, School, User
from .security import hash_secret


DEMO_STUDENTS = [
    ("ANANYA03", "Ananya R.", 1, 0, 20),
    ("SAIKIRAN03", "Sai Kiran", 5, 87, 365),
    ("HARSHINI03", "Harshini", 4, 80, 290),
    ("ROHAN03", "Rohan", 3, 67, 180),
]


def seed_demo_data(db: Session) -> None:
    school_code = os.getenv("DEMO_SCHOOL_CODE", "MANA001").strip().upper()
    student_pin = os.getenv("DEMO_STUDENT_PIN", "")
    teacher_password = os.getenv("DEMO_TEACHER_PASSWORD", "")
    admin_password = os.getenv("DEMO_ADMIN_PASSWORD", "")
    if not all((student_pin, teacher_password, admin_password)):
        raise RuntimeError("Demo account secrets are not configured")

    school = db.scalar(select(School).where(School.code == school_code))
    if school is None:
        school = School(
            code=school_code,
            name="Mana English Pilot School",
            district="Guntur",
            state="Andhra Pradesh",
        )
        db.add(school)
        db.flush()

    accounts = [
        ("LAKSHMI", "Ms. Lakshmi", "teacher", None, None, teacher_password),
        ("ADMIN", "Mana English Admin", "admin", None, None, admin_password),
    ]
    accounts.extend(
        (username, display_name, "student", 3, "A", student_pin)
        for username, display_name, *_ in DEMO_STUDENTS
    )

    created_students: dict[str, User] = {}
    for username, display_name, role, grade, section, secret in accounts:
        user = db.scalar(
            select(User).where(
                User.school_id == school.id,
                User.username == username,
            )
        )
        if user is None:
            user = User(
                school_id=school.id,
                username=username,
                display_name=display_name,
                role=role,
                grade=grade,
                section=section,
                password_hash=hash_secret(secret),
            )
            db.add(user)
            db.flush()
        if role == "student":
            created_students[username] = user

    lesson_ids = [f"class3-unit1-lesson{i}" for i in range(1, 6)]
    now = datetime.now(timezone.utc)
    for username, _, completed_count, test_score, total_xp in DEMO_STUDENTS:
        student = created_students[username]
        existing = db.scalar(
            select(LessonProgress.id).where(LessonProgress.user_id == student.id)
        )
        if existing is not None:
            continue
        base_xp = max((total_xp - test_score) // max(completed_count, 1), 10)
        for lesson_id in lesson_ids[:completed_count]:
            db.add(
                LessonProgress(
                    user_id=student.id,
                    lesson_id=lesson_id,
                    status="completed",
                    score=min(100, test_score + 2),
                    xp=base_xp,
                    completed_at=now,
                )
            )
        if test_score > 0:
            db.add(
                LessonProgress(
                    user_id=student.id,
                    lesson_id="class3-unit1-week1-test",
                    status="completed",
                    score=test_score,
                    xp=max(total_xp - (base_xp * completed_count), 0),
                    completed_at=now,
                )
            )
    db.commit()
