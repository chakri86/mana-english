import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CONTENT_FILE = ROOT / "backend/app/content/class3_week1.json"
CONTENT_WEEK_TWO = ROOT / "backend/app/content/class3_week2.json"


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
                self.assertTrue(phrase["meaning_telugu"])

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
        self.assertEqual(name_phrase["meaning_telugu"], "నీ పేరు ఏమిటి?")
        for lesson in self.module["lessons"]:
            for phrase in lesson["key_phrases"]:
                self.assertNotIn("natural_pronunciation_telugu", phrase)
            for question in lesson["questions"]:
                self.assertNotIn("natural_pronunciation_telugu", question)

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

    def test_week_one_role_play_matches_the_approved_eight_turn_script(self):
        role_play = self.module["role_play"]
        self.assertTrue(role_play["required_for_test"])
        self.assertEqual(role_play["image"], "/assets/week1-roleplay.jpg")
        self.assertEqual(len(role_play["turns"]), 8)
        self.assertEqual(role_play["turns"][0]["english"], "Good morning, teacher.")
        self.assertIn("What is your name?", role_play["turns"][2]["english"])
        self.assertEqual(role_play["turns"][-1]["english"], "Thank you, teacher.")


class ClassThreeWeekTwoTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.module = json.loads(CONTENT_WEEK_TWO.read_text(encoding="utf-8"))

    def test_week_two_has_complete_daily_and_test_content(self):
        self.assertEqual(self.module["grade"], 3)
        self.assertEqual(self.module["week"], 2)
        self.assertEqual(len(self.module["lessons"]), 5)
        self.assertTrue(all(len(lesson["questions"]) == 3 for lesson in self.module["lessons"]))
        self.assertEqual(len(self.module["weekend_test"]["questions"]), 10)

    def test_week_two_targets_and_telugu_support_are_reviewable(self):
        phrases = [phrase for lesson in self.module["lessons"] for phrase in lesson["key_phrases"]]
        by_english = {phrase["english"]: phrase for phrase in phrases}
        self.assertIn("This is my book.", by_english)
        self.assertIn("Please open your book.", by_english)
        self.assertEqual(by_english["This is my book."]["pronunciation_telugu"], "దిస్ ఇజ్ మై బుక్.")
        self.assertEqual(by_english["This is my book."]["meaning_telugu"], "ఇది నా పుస్తకం.")
        serialized = json.dumps(self.module, ensure_ascii=False)
        self.assertNotIn("natural_pronunciation_telugu", serialized)
        self.assertNotIn("ఈజ్", serialized)

    def test_week_two_role_play_has_eight_exact_turns_and_is_required(self):
        role_play = self.module["role_play"]
        self.assertTrue(role_play["required_for_test"])
        self.assertEqual(role_play["image"], "/assets/week2-roleplay.jpg")
        self.assertEqual(len(role_play["turns"]), 8)
        self.assertEqual(role_play["turns"][0]["speaker"], "Parrot Teacher")
        self.assertEqual(role_play["turns"][1]["speaker"], "Tara")
        self.assertIn("Please open your book.", [turn["english"] for turn in role_play["turns"]])
        self.assertEqual(role_play["turns"][-1]["english"], "Here is my pencil. I am ready.")

    def test_week_two_question_contract_and_skill_tags(self):
        questions = [question for lesson in self.module["lessons"] for question in lesson["questions"]]
        questions += self.module["weekend_test"]["questions"]
        ids = [question["id"] for question in questions]
        self.assertEqual(len(ids), len(set(ids)))
        for question in questions:
            self.assertTrue(question["prompt_telugu"])
            self.assertTrue(question["pronunciation_telugu"])
            self.assertEqual(len(question["choices"]), 3)
            self.assertIn(question["correct_index"], range(3))
            self.assertTrue(question["skill_tag"])

    def test_week_two_student_payload_hides_all_test_answers(self):
        from backend.app.content import student_week

        student_module = student_week(3, 2)
        for lesson in student_module["lessons"]:
            self.assertNotIn("teacher_guidance", lesson)
            self.assertTrue(all("correct_index" not in question for question in lesson["questions"]))
        for question in student_module["weekend_test"]["questions"]:
            self.assertNotIn("correct_index", question)
            self.assertEqual(question["audio"], question["prompt"])
            self.assertEqual(question["pronunciation_telugu"], "ప్రశ్నను వినండి. సమాధానం చూపించబడదు.")


if __name__ == "__main__":
    unittest.main()
