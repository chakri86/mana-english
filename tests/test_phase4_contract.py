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
        self.assertIn("const completed = score >= (moduleData.mastery_score || 67)", javascript)
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

    def test_week_two_selector_and_role_play_are_wired(self):
        javascript = (ROOT / "public/app.js").read_text(encoding="utf-8")
        html = (ROOT / "public/index.html").read_text(encoding="utf-8")
        api = (ROOT / "backend/app/main.py").read_text(encoding="utf-8")
        self.assertIn('id="week-selector"', html)
        self.assertIn('id="role-play-dialog"', html)
        self.assertIn('id="role-play-complete"', html)
        self.assertIn('id="role-play-scene"', html)
        self.assertIn('scene.src = rolePlay.image || ""', javascript)
        week_one = (ROOT / "backend/app/content/class3_week1.json").read_text(encoding="utf-8")
        week_two = (ROOT / "backend/app/content/class3_week2.json").read_text(encoding="utf-8")
        self.assertIn('/assets/week1-roleplay.jpg', week_one)
        self.assertIn('/assets/week2-roleplay.jpg', week_two)
        self.assertIn("function renderRolePlay", javascript)
        self.assertIn("function completeRolePlay", javascript)
        self.assertIn("activeWeek = requested", javascript)
        self.assertIn("SUPPORTED_WEEKS = (1, 2)", api)
        self.assertIn("required_progress_ids", api)

    def test_weekly_vocabulary_is_available_to_students_and_teachers(self):
        javascript = (ROOT / "public/app.js").read_text(encoding="utf-8")
        html = (ROOT / "public/index.html").read_text(encoding="utf-8")
        css = (ROOT / "public/styles.css").read_text(encoding="utf-8")
        self.assertIn('id="student-vocabulary-list"', html)
        self.assertIn('id="teacher-vocabulary-list"', html)
        self.assertIn('id="word-of-day-phonetic"', html)
        self.assertIn("function createVocabularyCard", javascript)
        self.assertIn("function renderVocabulary", javascript)
        self.assertIn('speak(item.word, "en-IN")', javascript)
        self.assertIn("Say it: ${item.phonetic}", javascript)
        self.assertIn(".vocabulary-grid", css)

    def test_separate_pronunciation_guide_is_wired_to_student_navigation(self):
        javascript = (ROOT / "public/app.js").read_text(encoding="utf-8")
        html = (ROOT / "public/index.html").read_text(encoding="utf-8")
        css = (ROOT / "public/styles.css").read_text(encoding="utf-8")
        self.assertIn('data-student-view="vocabulary"', html)
        self.assertIn('id="student-vocabulary-view"', html)
        self.assertIn('id="pronunciation-levels"', html)
        self.assertIn('data-syllable-filter="1"', html)
        self.assertIn('data-syllable-filter="4"', html)
        self.assertIn("function renderPronunciationGuide", javascript)
        self.assertIn("function applySyllableFilter", javascript)
        self.assertIn('speak(item.word, "en-IN")', javascript)
        self.assertIn(".syllable-parts", css)
        self.assertIn(".pronunciation-word-card", css)


if __name__ == "__main__":
    unittest.main()
