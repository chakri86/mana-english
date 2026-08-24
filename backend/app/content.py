import copy
import json
from functools import lru_cache
from pathlib import Path


CONTENT_DIR = Path(__file__).with_name("content")


@lru_cache(maxsize=16)
def load_week(grade: int, week: int) -> dict:
    path = CONTENT_DIR / f"class{grade}_week{week}.json"
    if not path.is_file():
        raise FileNotFoundError(path)
    with path.open(encoding="utf-8") as source:
        return json.load(source)


@lru_cache(maxsize=1)
def load_pronunciation_guide() -> dict:
    path = CONTENT_DIR / "pronunciation_guide.json"
    with path.open(encoding="utf-8") as source:
        return json.load(source)


def pronunciation_guide() -> dict:
    return copy.deepcopy(load_pronunciation_guide())


def student_week(grade: int, week: int) -> dict:
    module = copy.deepcopy(load_week(grade, week))
    for lesson in module["lessons"]:
        lesson.pop("teacher_guidance", None)
        for question in lesson["questions"]:
            question.pop("correct_index", None)
    for question in module["weekend_test"]["questions"]:
        question.pop("correct_index", None)
        # Assessment payloads must not expose the model answer through the
        # audio text or its Telugu pronunciation hint.
        question["audio"] = question["prompt"]
        question["pronunciation_telugu"] = "ప్రశ్నను వినండి. సమాధానం చూపించబడదు."
    return module


def find_question(module: dict, question_id: str) -> dict | None:
    for lesson in module["lessons"]:
        for question in lesson["questions"]:
            if question["id"] == question_id:
                return question
    for question in module["weekend_test"]["questions"]:
        if question["id"] == question_id:
            return question
    return None
