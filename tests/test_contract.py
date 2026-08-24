import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class PhaseTwoContractTests(unittest.TestCase):
    def test_login_and_dashboard_elements_exist(self):
        html = (ROOT / "public/index.html").read_text(encoding="utf-8")
        for element_id in (
            "login-form",
            "school-code",
            "username",
            "secret",
            "student-screen",
            "teacher-screen",
            "student-roster",
        ):
            self.assertIn(f'id="{element_id}"', html)

    def test_browser_uses_authenticated_api(self):
        javascript = (ROOT / "public/app.js").read_text(encoding="utf-8")
        for endpoint in (
            "/api/auth/login",
            "/api/auth/me",
            "/api/progress",
            "/api/teacher/dashboard",
            "/api/assignments",
        ):
            self.assertIn(endpoint, javascript)
        self.assertIn("function moduleApi", javascript)
        self.assertIn("/api/modules/${activeGrade}/weeks/${activeWeek}", javascript)
        self.assertIn('headers.set("Authorization", `Bearer ${token()}`)', javascript)

    def test_api_contract_is_present(self):
        api = (ROOT / "backend/app/main.py").read_text(encoding="utf-8")
        for route in (
            '@app.get("/api/health")',
            '@app.post("/api/auth/login"',
            '@app.get("/api/auth/me"',
            '@app.get("/api/progress"',
            '@app.put("/api/progress/{lesson_id}"',
            '@app.get("/api/teacher/dashboard")',
            '@app.get("/api/modules/{grade}/weeks/{week}")',
            '@app.post("/api/modules/{grade}/weeks/{week}/check")',
            '@app.post("/api/modules/{grade}/weeks/{week}/test/submit")',
        ):
            self.assertIn(route, api)

    def test_private_api_and_no_committed_credentials(self):
        quadlet = (ROOT / "deploy/quadlet/mana-english-api.container").read_text(encoding="utf-8")
        installer = (ROOT / "deploy/install.sh").read_text(encoding="utf-8")
        self.assertIn("PublishPort=127.0.0.1:8000:8000", quadlet)
        self.assertIn('chmod 0600 "${CONF_DIR}"/*.env "${CREDENTIAL_FILE}"', installer)
        self.assertNotIn("change-me", installer.lower())

    def test_demo_credentials_can_be_rotated_without_resetting_progress(self):
        rotation = (ROOT / "deploy/rotate-demo-credentials.sh").read_text(encoding="utf-8")
        self.assertIn("hash_secret", rotation)
        self.assertIn("db.commit()", rotation)
        self.assertNotIn("DROP TABLE", rotation.upper())
        self.assertNotIn("podman volume rm", rotation.lower())


if __name__ == "__main__":
    unittest.main()
