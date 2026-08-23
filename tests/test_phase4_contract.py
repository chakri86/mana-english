import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class PhaseFourMenuTests(unittest.TestCase):
    def test_student_menu_views_are_present(self):
        html = (ROOT / "public/index.html").read_text(encoding="utf-8")
        for view in ("learn", "speak", "practice", "tests", "progress"):
            self.assertIn(f'id="student-{view}-view"', html)
            self.assertIn(f'data-student-view="{view}"', html)
        self.assertIn('id="telugu-help-dialog"', html)
        self.assertIn('id="speak-record"', html)

    def test_teacher_menu_views_and_assignment_dialog_are_present(self):
        html = (ROOT / "public/index.html").read_text(encoding="utf-8")
        for view in ("dashboard", "students", "lessons", "assessments", "reports"):
            self.assertIn(f'id="teacher-{view}-view"', html)
            self.assertIn(f'data-teacher-view="{view}"', html)
        self.assertIn('id="assignment-dialog"', html)
        self.assertIn('id="download-report"', html)

    def test_phase_four_api_contract_is_present(self):
        api = (ROOT / "backend/app/main.py").read_text(encoding="utf-8")
        models = (ROOT / "backend/app/models.py").read_text(encoding="utf-8")
        for route in (
            '@app.get("/api/assignments")',
            '@app.post("/api/teacher/assignments"',
            '@app.get("/api/teacher/report.csv")',
        ):
            self.assertIn(route, api)
        self.assertIn("class Assignment(Base):", models)

    def test_first_progress_save_handles_unapplied_database_defaults(self):
        api = (ROOT / "backend/app/main.py").read_text(encoding="utf-8")
        self.assertIn("max(record.score or 0, score)", api)
        self.assertIn("max(record.xp or 0, xp)", api)
        self.assertIn("(record.attempts or 0) + 1", api)

    def test_visible_controls_are_wired_without_placeholder_handler(self):
        javascript = (ROOT / "public/app.js").read_text(encoding="utf-8")
        for behavior in (
            "toggleRecording",
            "renderPracticeQuestion",
            "submitAssignment",
            "downloadReport",
            "showStudentView",
            "showTeacherView",
        ):
            self.assertIn(f"function {behavior}", javascript)
        self.assertNotIn("This feature is planned for a later build", javascript)

    def test_two_attempt_correction_and_mistake_history_are_present(self):
        javascript = (ROOT / "public/app.js").read_text(encoding="utf-8")
        api = (ROOT / "backend/app/main.py").read_text(encoding="utf-8")
        models = (ROOT / "backend/app/models.py").read_text(encoding="utf-8")
        html = (ROOT / "public/index.html").read_text(encoding="utf-8")
        self.assertIn('class AnswerAttempt(Base):', models)
        self.assertIn('@app.get("/api/improvements")', api)
        self.assertIn('attempt_number=payload.attempt_number', api)
        self.assertIn('activity="test"', api)
        self.assertIn('questionAttemptNumber = 2', javascript)
        self.assertIn('classList.add("eliminated")', javascript)
        self.assertIn('result.correct_index', javascript)
        self.assertIn('id="student-improvement-list"', html)
        self.assertIn('id="student-mistake-history"', html)

    def test_lesson_completion_requires_minimum_mastery(self):
        javascript = (ROOT / "public/app.js").read_text(encoding="utf-8")
        api = (ROOT / "backend/app/main.py").read_text(encoding="utf-8")
        schemas = (ROOT / "backend/app/schemas.py").read_text(encoding="utf-8")
        self.assertIn("MASTERY_SCORE = 67", api)
        self.assertIn("reconcile_legacy_mastery", api)
        self.assertIn('Literal["started", "needs_practice", "completed"]', schemas)
        self.assertIn("const completed = score >= 67", javascript)
        self.assertIn('status: completed ? "completed" : "needs_practice"', javascript)
        self.assertIn('checkButton.dataset.mode = "retry-missed"', javascript)

    def test_weekend_test_ui_plays_only_the_question(self):
        javascript = (ROOT / "public/app.js").read_text(encoding="utf-8")
        self.assertIn('isTest ? "Listen to the question"', javascript)
        self.assertIn('activeMode === "test" ? question.prompt : question.audio', javascript)
        self.assertIn('WEEKEND TEST · NO ANSWER HINTS', javascript)

    def test_accessible_question_and_answer_audio_controls_are_present(self):
        javascript = (ROOT / "public/app.js").read_text(encoding="utf-8")
        html = (ROOT / "public/index.html").read_text(encoding="utf-8")
        styles = (ROOT / "public/styles.css").read_text(encoding="utf-8")
        self.assertIn("function preferredFemaleVoice", javascript)
        self.assertIn("function createAnswerOption", javascript)
        self.assertIn('listenButton.className = "answer-listen"', javascript)
        self.assertIn('speak(question.prompt_telugu, "te-IN")', javascript)
        for element_id in (
            "exercise-audio-telugu",
            "practice-listen-english",
            "practice-listen-telugu",
        ):
            self.assertIn(f'id="{element_id}"', html)
        self.assertIn(".answers .answer-option", styles)

    def test_telugu_voice_loading_and_missing_voice_guidance_are_present(self):
        javascript = (ROOT / "public/app.js").read_text(encoding="utf-8")
        html = (ROOT / "public/index.html").read_text(encoding="utf-8")
        self.assertIn("function loadSpeechVoices", javascript)
        self.assertIn('addEventListener("voiceschanged"', javascript)
        self.assertIn('language.toLowerCase().startsWith("te") && !voice', javascript)
        self.assertIn("function refreshTeluguVoiceStatus", javascript)
        self.assertIn('id="telugu-voice-status"', html)
        self.assertIn('id="telugu-voice-test"', html)


if __name__ == "__main__":
    unittest.main()
