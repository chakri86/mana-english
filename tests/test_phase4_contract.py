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


if __name__ == "__main__":
    unittest.main()
