import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CONTENT_FILE = ROOT / "backend/app/content/class3_week1.json"


class ClassThreeWeekOneTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.module = json.loads(CONTENT_FILE.read_text(encoding="utf-8"))

    def test_week_has_five_daily_lessons_and_ten_test_questions(self):
        self.assertEqual(self.module["grade"], 3)
        self.assertEqual(self.module["week"], 1)
        self.assertEqual(len(self.module["lessons"]), 5)
        self.assertEqual(len(self.module["weekend_test"]["questions"]), 10)

    def test_every_lesson_has_bilingual_practice_and_teacher_guidance(self):
        required_guidance = {
            "warm_up",
            "model",
            "guided_practice",
            "pair_practice",
            "common_errors",
            "home_practice",
        }
        for lesson in self.module["lessons"]:
            self.assertTrue(lesson["telugu_title"])
            self.assertTrue(lesson["objective_telugu"])
            self.assertGreaterEqual(len(lesson["key_phrases"]), 3)
            self.assertEqual(len(lesson["questions"]), 3)
            self.assertEqual(set(lesson["teacher_guidance"]), required_guidance)
            for phrase in lesson["key_phrases"]:
                self.assertTrue(phrase["pronunciation_telugu"])
                self.assertTrue(phrase["natural_pronunciation_telugu"])
                self.assertTrue(phrase["meaning_telugu"])
            for question in lesson["questions"]:
                self.assertTrue(question["natural_pronunciation_telugu"])

    def test_telugu_uses_reviewed_child_friendly_pronunciation(self):
        serialized = json.dumps(self.module, ensure_ascii=False)
        self.assertNotIn("ఈజ్", serialized)
        self.assertNotIn("యువర్", serialized)
        self.assertNotIn("ప్రశ్న ఉపయోగిస్తారు", serialized)
        name_phrase = next(
            phrase
            for lesson in self.module["lessons"]
            for phrase in lesson["key_phrases"]
            if phrase["english"] == "What is your name?"
        )
        self.assertEqual(name_phrase["pronunciation_telugu"], "వాట్ ఇజ్ యోర్ నేమ్?")
        self.assertEqual(name_phrase["natural_pronunciation_telugu"], "వాటిజ్ యోర్ నేమ్?")
        self.assertEqual(name_phrase["meaning_telugu"], "నీ పేరు ఏమిటి?")

    def test_question_ids_are_unique_and_answers_are_valid(self):
        questions = [
            question
            for lesson in self.module["lessons"]
            for question in lesson["questions"]
        ] + self.module["weekend_test"]["questions"]
        ids = [question["id"] for question in questions]
        self.assertEqual(len(ids), len(set(ids)))
        for question in questions:
            self.assertTrue(question["prompt_telugu"])
            self.assertTrue(question["pronunciation_telugu"])
            self.assertGreaterEqual(len(question["choices"]), 3)
            self.assertIn(question["correct_index"], range(len(question["choices"])))

    def test_student_payload_can_hide_answer_keys(self):
        from backend.app.content import student_week

        student_module = student_week(3, 1)
        for lesson in student_module["lessons"]:
            self.assertNotIn("teacher_guidance", lesson)
            for question in lesson["questions"]:
                self.assertNotIn("correct_index", question)
        for question in student_module["weekend_test"]["questions"]:
            self.assertNotIn("correct_index", question)

    def test_weekend_test_payload_does_not_reveal_answers_as_audio_hints(self):
        from backend.app.content import student_week

        student_module = student_week(3, 1)
        source_questions = {question["id"]: question for question in self.module["weekend_test"]["questions"]}
        for question in student_module["weekend_test"]["questions"]:
            source = source_questions[question["id"]]
            correct_answer = source["choices"][source["correct_index"]]
            self.assertNotEqual(question["audio"], correct_answer)
            self.assertNotEqual(question["pronunciation_telugu"], source["pronunciation_telugu"])
            self.assertEqual(question["audio"], question["prompt"])


if __name__ == "__main__":
    unittest.main()
