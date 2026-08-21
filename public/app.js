(() => {
  "use strict";

  const TOKEN_KEY = "mana_english_token";
  const USER_KEY = "mana_english_user";
  const screens = {
    login: document.getElementById("login-screen"),
    student: document.getElementById("student-screen"),
    teacher: document.getElementById("teacher-screen"),
    lesson: document.getElementById("lesson-screen")
  };
  const topbar = document.getElementById("topbar");
  const loginForm = document.getElementById("login-form");
  const loginButton = document.getElementById("login-button");
  const loginError = document.getElementById("login-error");
  const answerButtons = [...document.querySelectorAll(".answers button")];
  const checkButton = document.getElementById("check-answer");
  const answerFooter = document.getElementById("answer-footer");
  const feedback = document.getElementById("feedback");
  const toast = document.getElementById("toast");
  let currentUser = null;
  let selectedAnswer = null;
  let toastTimer;

  const token = () => sessionStorage.getItem(TOKEN_KEY);

  async function api(path, options = {}) {
    const headers = new Headers(options.headers || {});
    if (options.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    if (token()) headers.set("Authorization", `Bearer ${token()}`);
    const response = await fetch(path, { ...options, headers });
    let payload = {};
    try { payload = await response.json(); } catch (_) { /* An empty error body is handled below. */ }
    if (!response.ok) {
      const error = new Error(payload.detail || "Something went wrong. Please try again.");
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  function showScreen(name) {
    Object.entries(screens).forEach(([key, element]) => element.classList.toggle("active", key === name));
    topbar.classList.toggle("hidden", name === "login");
    if (name !== "login") window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function showHome() {
    showScreen(currentUser && currentUser.role === "student" ? "student" : "teacher");
  }

  function showToast(message) {
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("show"), 2800);
  }

  function initials(name) {
    return name.split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]).join("").toUpperCase();
  }

  function firstName(displayName) {
    return displayName.replace(/\.$/, "").split(/\s+/)[0];
  }

  function setUser(user) {
    currentUser = user;
    sessionStorage.setItem(USER_KEY, JSON.stringify(user));
    const role = user.role === "student" ? `Class ${user.grade || 3}${user.section || ""} Student` : user.role === "admin" ? "Administrator" : "Teacher";
    document.getElementById("role-label").textContent = role;
    document.getElementById("user-avatar").textContent = initials(user.display_name) || "ME";
    document.getElementById("header-xp").textContent = `${user.xp || 0} XP`;
  }

  function clearSession() {
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(USER_KEY);
    currentUser = null;
  }

  function resetExercise() {
    selectedAnswer = null;
    answerButtons.forEach((button) => button.classList.remove("selected"));
    checkButton.disabled = true;
    checkButton.textContent = "Check answer";
    checkButton.dataset.mode = "check";
    answerFooter.className = "";
    feedback.replaceChildren();
  }

  function speak(text) {
    if (!("speechSynthesis" in window)) {
      showToast("Audio is not supported by this browser.");
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "en-IN";
    utterance.rate = 0.78;
    utterance.pitch = 1.05;
    window.speechSynthesis.speak(utterance);
  }

  function renderStudent(user, progress) {
    const records = new Map(progress.map((item) => [item.lesson_id, item]));
    const completed = progress.filter((item) => item.lesson_id.includes("-lesson") && item.status === "completed").length;
    const scored = progress.filter((item) => item.score > 0);
    const accuracy = scored.length ? Math.round(scored.reduce((sum, item) => sum + item.score, 0) / scored.length) : 0;
    document.getElementById("student-first-name").textContent = firstName(user.display_name);
    document.getElementById("weekly-goal-text").textContent = `${completed} / 5 lessons`;
    document.getElementById("weekly-goal-bar").style.width = `${Math.min(completed * 20, 100)}%`;
    document.getElementById("progress-xp").textContent = user.xp || 0;
    document.getElementById("progress-accuracy").textContent = `${accuracy}%`;
    document.getElementById("header-xp").textContent = `${user.xp || 0} XP`;

    document.querySelectorAll(".path-item[data-lesson-id]").forEach((item, index) => {
      const record = records.get(item.dataset.lessonId);
      const isDone = record && record.status === "completed";
      const canStart = isDone || index <= completed;
      item.classList.toggle("done", Boolean(isDone));
      item.classList.toggle("current", !isDone && canStart);
      item.classList.toggle("locked", !canStart);
      item.classList.toggle("open", !isDone && canStart);
      const node = item.querySelector(".node");
      const action = item.querySelector(".lesson-action");
      if (isDone) {
        node.textContent = "✓";
        action.replaceChildren(Object.assign(document.createElement("span"), { className: "xp", textContent: `+${record.xp} XP` }));
      } else if (canStart) {
        node.textContent = index === 1 ? "🙂" : "💬";
        const button = document.createElement("button");
        button.className = "open-lesson";
        button.textContent = index === completed ? "Continue" : "Practise";
        button.addEventListener("click", openLesson);
        action.replaceChildren(button);
      } else {
        node.textContent = "🔒";
        action.replaceChildren(Object.assign(document.createElement("span"), { textContent: "Locked" }));
      }
    });
  }

  function createRosterRow(student) {
    const row = document.createElement("div");
    row.className = "roster-row";
    const name = document.createElement("div");
    name.className = "student-name";
    const avatar = document.createElement("i");
    avatar.textContent = initials(student.name);
    const label = document.createElement("span");
    label.textContent = student.name;
    name.append(avatar, label);
    const xp = document.createElement("span");
    xp.textContent = student.xp;
    const lessons = document.createElement("span");
    lessons.textContent = `${student.lessons_completed}/${student.lessons_total}`;
    const test = document.createElement("span");
    test.textContent = `${student.test_score}%`;
    const status = document.createElement("em");
    status.textContent = student.status;
    if (student.status === "Needs help") status.className = "needs-help";
    row.append(name, xp, lessons, test, status);
    return row;
  }

  function renderTeacher(data) {
    const metrics = data.metrics;
    document.getElementById("teacher-school").textContent = data.school;
    document.getElementById("teacher-name").textContent = firstName(currentUser.display_name);
    document.getElementById("metric-students").textContent = `${metrics.active_students} / ${metrics.total_students}`;
    document.getElementById("metric-lessons").textContent = metrics.lessons_completed;
    document.getElementById("metric-accuracy").textContent = `${metrics.average_accuracy}%`;
    document.getElementById("metric-reviews").textContent = metrics.speaking_reviews;
    document.getElementById("student-roster").replaceChildren(...data.students.map(createRosterRow));
  }

  async function loadStudent() {
    const [user, progress] = await Promise.all([api("/api/auth/me"), api("/api/progress")]);
    setUser(user);
    renderStudent(user, progress);
    showScreen("student");
  }

  async function loadTeacher() {
    const [user, dashboard] = await Promise.all([api("/api/auth/me"), api("/api/teacher/dashboard")]);
    setUser(user);
    renderTeacher(dashboard);
    showScreen("teacher");
  }

  async function initializeSession(user) {
    if (user.role === "student") await loadStudent();
    else await loadTeacher();
  }

  function openLesson() {
    resetExercise();
    showScreen("lesson");
  }

  document.querySelectorAll("[data-login-role]").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll("[data-login-role]").forEach((item) => item.classList.toggle("active", item === button));
      const isStudent = button.dataset.loginRole === "student";
      document.getElementById("username-label").textContent = isStudent ? "Student ID" : "Username";
      document.getElementById("username").placeholder = isStudent ? "Example: ANANYA03" : "Example: LAKSHMI";
      document.getElementById("secret-label").textContent = isStudent ? "4-digit PIN" : "Password";
      document.getElementById("secret").inputMode = isStudent ? "numeric" : "text";
      loginError.textContent = "";
    });
  });

  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    loginError.textContent = "";
    loginButton.disabled = true;
    loginButton.firstChild.textContent = "Signing in… ";
    try {
      const response = await api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({
          school_code: document.getElementById("school-code").value,
          username: document.getElementById("username").value,
          secret: document.getElementById("secret").value
        })
      });
      sessionStorage.setItem(TOKEN_KEY, response.access_token);
      setUser(response.user);
      await initializeSession(response.user);
    } catch (error) {
      clearSession();
      loginError.textContent = error.message;
    } finally {
      loginButton.disabled = false;
      loginButton.firstChild.textContent = "Sign in ";
    }
  });

  document.querySelectorAll("[data-home]").forEach((button) => button.addEventListener("click", showHome));
  document.getElementById("logout-button").addEventListener("click", () => {
    clearSession();
    loginForm.reset();
    document.getElementById("school-code").value = "MANA001";
    showScreen("login");
    showToast("You have signed out.");
  });
  document.getElementById("preview-student").addEventListener("click", () => {
    showScreen("student");
    showToast("Student preview · progress changes are disabled");
  });
  document.querySelectorAll(".open-lesson").forEach((button) => button.addEventListener("click", openLesson));
  document.getElementById("close-lesson").addEventListener("click", showHome);

  answerButtons.forEach((button) => {
    button.addEventListener("click", () => {
      selectedAnswer = button;
      answerButtons.forEach((item) => item.classList.toggle("selected", item === button));
      checkButton.disabled = false;
      answerFooter.className = "";
      feedback.replaceChildren();
      checkButton.textContent = "Check answer";
      checkButton.dataset.mode = "check";
    });
  });

  checkButton.addEventListener("click", async () => {
    if (checkButton.dataset.mode === "continue") {
      if (currentUser && currentUser.role === "student") {
        try {
          checkButton.disabled = true;
          await api("/api/progress/class3-unit1-lesson2", {
            method: "PUT",
            body: JSON.stringify({ status: "completed", score: 100, xp: 20 })
          });
          await loadStudent();
          showToast("+20 XP saved. Great work!");
        } catch (error) {
          showToast(error.message);
          checkButton.disabled = false;
        }
      } else {
        showHome();
        showToast("Preview completed. Student progress was not changed.");
      }
      return;
    }
    if (checkButton.dataset.mode === "retry") {
      resetExercise();
      return;
    }
    if (!selectedAnswer) return;
    const correct = selectedAnswer.dataset.correct === "true";
    answerFooter.className = correct ? "correct" : "wrong";
    const title = document.createElement("b");
    const detail = document.createElement("p");
    title.textContent = correct ? "Excellent! చాలా బాగుంది!" : "Let’s try again · మళ్ళీ ప్రయత్నిద్దాం";
    detail.textContent = correct ? "+20 XP when you continue" : "Listen once more and choose the natural sentence.";
    feedback.replaceChildren(title, detail);
    checkButton.textContent = correct ? "Continue" : "Try again";
    checkButton.dataset.mode = correct ? "continue" : "retry";
  });

  document.querySelectorAll(".sound-button").forEach((button) => {
    button.addEventListener("click", () => speak(button.closest(".word") ? "confident" : "My name is Ananya."));
  });

  document.querySelectorAll("button").forEach((button) => {
    const wired = button.matches("[data-login-role],[data-home],.open-lesson,.sound-button,#close-lesson,#check-answer,.answers button,#logout-button,#preview-student") || button.type === "submit";
    if (!wired) button.addEventListener("click", () => showToast("This feature is planned for a later build."));
  });

  (async function restoreSession() {
    if (!token()) {
      showScreen("login");
      return;
    }
    try {
      const user = await api("/api/auth/me");
      setUser(user);
      await initializeSession(user);
    } catch (_) {
      clearSession();
      showScreen("login");
    }
  })();
})();
