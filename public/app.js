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
  const checkButton = document.getElementById("check-answer");
  const answerFooter = document.getElementById("answer-footer");
  const feedback = document.getElementById("feedback");
  const answerList = document.getElementById("exercise-answers");
  const toast = document.getElementById("toast");
  let currentUser = null;
  let moduleData = null;
  let progressRecords = [];
  let activeMode = "lesson";
  let activeLesson = null;
  let questionIndex = 0;
  let selectedIndex = null;
  let testAnswers = {};
  let toastTimer;

  const token = () => sessionStorage.getItem(TOKEN_KEY);

  async function api(path, options = {}) {
    const headers = new Headers(options.headers || {});
    if (options.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    if (token()) headers.set("Authorization", `Bearer ${token()}`);
    const response = await fetch(path, { ...options, headers });
    let payload = {};
    try { payload = await response.json(); } catch (_) { /* Empty error bodies use the fallback below. */ }
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
    moduleData = null;
    progressRecords = [];
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

  function completedLessonCount(progress) {
    return progress.filter((item) => item.lesson_id.includes("-lesson") && item.status === "completed").length;
  }

  function openLessonById(lessonId) {
    if (!moduleData) return;
    const lesson = moduleData.lessons.find((item) => item.id === lessonId);
    if (!lesson) {
      showToast("Lesson content is unavailable.");
      return;
    }
    activeMode = "lesson";
    activeLesson = lesson;
    questionIndex = 0;
    testAnswers = {};
    renderQuestion();
    showScreen("lesson");
  }

  function openNextLesson() {
    const completed = completedLessonCount(progressRecords);
    const lesson = moduleData && moduleData.lessons[Math.min(completed, moduleData.lessons.length - 1)];
    if (lesson) openLessonById(lesson.id);
  }

  function renderStudent(user, progress) {
    progressRecords = progress;
    const records = new Map(progress.map((item) => [item.lesson_id, item]));
    const completed = completedLessonCount(progress);
    const scored = progress.filter((item) => item.score > 0);
    const accuracy = scored.length ? Math.round(scored.reduce((sum, item) => sum + item.score, 0) / scored.length) : 0;
    document.getElementById("student-first-name").textContent = firstName(user.display_name);
    document.getElementById("weekly-goal-text").textContent = `${completed} / 5 lessons`;
    document.getElementById("weekly-goal-bar").style.width = `${Math.min(completed * 20, 100)}%`;
    document.getElementById("progress-xp").textContent = user.xp || 0;
    document.getElementById("progress-accuracy").textContent = `${accuracy}%`;
    document.getElementById("header-xp").textContent = `${user.xp || 0} XP`;

    document.querySelectorAll(".path-item[data-lesson-id]").forEach((item, index) => {
      const lesson = moduleData.lessons[index];
      const record = records.get(item.dataset.lessonId);
      const isDone = record && record.status === "completed";
      const canStart = isDone || index <= completed;
      item.querySelector(".lesson-copy span").textContent = `${lesson.day} · LESSON ${index + 1}`;
      item.querySelector(".lesson-copy b").textContent = lesson.title;
      item.querySelector(".lesson-copy small").textContent = lesson.telugu_title;
      item.classList.toggle("done", Boolean(isDone));
      item.classList.toggle("current", !isDone && canStart);
      item.classList.toggle("locked", !canStart);
      item.classList.toggle("open", !isDone && canStart);
      const node = item.querySelector(".node");
      const action = item.querySelector(".lesson-action");
      if (isDone) {
        node.textContent = "✓";
        const practise = document.createElement("button");
        practise.textContent = "Practise";
        practise.addEventListener("click", () => openLessonById(lesson.id));
        action.replaceChildren(practise);
      } else if (canStart) {
        node.textContent = index === completed ? "🙂" : "💬";
        const button = document.createElement("button");
        button.textContent = index === completed ? "Continue" : "Start";
        button.addEventListener("click", () => openLessonById(lesson.id));
        action.replaceChildren(button);
      } else {
        node.textContent = "🔒";
        action.replaceChildren(Object.assign(document.createElement("span"), { textContent: "Locked" }));
      }
    });

    const testButton = document.getElementById("open-test");
    const testRecord = records.get(moduleData.weekend_test.id);
    testButton.disabled = completed < moduleData.lessons.length;
    testButton.textContent = testRecord ? `Retake · ${testRecord.score}%` : completed >= moduleData.lessons.length ? "Start test" : "Complete all lessons";
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
    const xp = Object.assign(document.createElement("span"), { textContent: student.xp });
    const lessons = Object.assign(document.createElement("span"), { textContent: `${student.lessons_completed}/${student.lessons_total}` });
    const test = Object.assign(document.createElement("span"), { textContent: `${student.test_score}%` });
    const studentStatus = document.createElement("em");
    studentStatus.textContent = student.status;
    if (student.status === "Needs help") studentStatus.className = "needs-help";
    row.append(name, xp, lessons, test, studentStatus);
    return row;
  }

  function guidanceItem(term, text) {
    const dt = Object.assign(document.createElement("dt"), { textContent: term });
    const dd = Object.assign(document.createElement("dd"), { textContent: text });
    return [dt, dd];
  }

  function createTeacherDay(lesson, index) {
    const card = document.createElement("article");
    card.className = "teacher-day";
    const day = Object.assign(document.createElement("span"), { textContent: `${lesson.day} · ${lesson.duration_minutes} MIN` });
    const title = Object.assign(document.createElement("h4"), { textContent: lesson.title });
    const objective = Object.assign(document.createElement("p"), { textContent: lesson.objective });
    const details = document.createElement("details");
    if (index === 0) details.open = true;
    details.append(Object.assign(document.createElement("summary"), { textContent: "Open lesson plan" }));
    const list = document.createElement("dl");
    const guidance = lesson.teacher_guidance;
    list.append(
      ...guidanceItem("Warm-up", guidance.warm_up),
      ...guidanceItem("Model", guidance.model),
      ...guidanceItem("Guided practice", guidance.guided_practice),
      ...guidanceItem("Pair practice", guidance.pair_practice),
      ...guidanceItem("Common errors", guidance.common_errors),
      ...guidanceItem("Home practice", guidance.home_practice)
    );
    details.append(list);
    card.append(day, title, objective, details);
    return card;
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
    document.getElementById("teacher-week-plan").replaceChildren(...moduleData.lessons.map(createTeacherDay));
  }

  async function loadStudent() {
    const [user, progress, week] = await Promise.all([
      api("/api/auth/me"), api("/api/progress"), api("/api/modules/3/weeks/1")
    ]);
    setUser(user);
    moduleData = week;
    renderStudent(user, progress);
    showScreen("student");
  }

  async function loadTeacher() {
    const [user, dashboard, week] = await Promise.all([
      api("/api/auth/me"), api("/api/teacher/dashboard"), api("/api/modules/3/weeks/1")
    ]);
    setUser(user);
    moduleData = week;
    renderTeacher(dashboard);
    showScreen("teacher");
  }

  async function initializeSession(user) {
    if (user.role === "student") await loadStudent();
    else await loadTeacher();
  }

  function activeQuestions() {
    return activeMode === "test" ? moduleData.weekend_test.questions : activeLesson.questions;
  }

  function resetAnswer() {
    selectedIndex = null;
    checkButton.disabled = true;
    checkButton.dataset.mode = "check";
    checkButton.textContent = activeMode === "test" ? "Save answer" : "Check answer";
    answerFooter.className = "";
    feedback.replaceChildren();
  }

  function selectAnswer(index, button) {
    selectedIndex = index;
    [...answerList.children].forEach((item) => item.classList.toggle("selected", item === button));
    checkButton.disabled = false;
    answerFooter.className = "";
    feedback.replaceChildren();
  }

  function renderQuestion() {
    const questions = activeQuestions();
    const question = questions[questionIndex];
    resetAnswer();
    document.getElementById("exercise-eyebrow").textContent = activeMode === "test" ? "WEEKEND TEST" : `${activeLesson.day} · SPEAKING PRACTICE`;
    document.getElementById("exercise-title").textContent = question.prompt;
    document.getElementById("exercise-telugu").textContent = question.prompt_telugu;
    document.getElementById("exercise-phrase").textContent = `“${question.audio}”`;
    document.getElementById("exercise-pronunciation").textContent = question.pronunciation_telugu;
    document.getElementById("lesson-counter").textContent = `${questionIndex + 1} / ${questions.length}`;
    document.getElementById("lesson-progress-bar").style.width = `${((questionIndex + 1) / questions.length) * 100}%`;
    const buttons = question.choices.map((choice, index) => {
      const button = document.createElement("button");
      const number = Object.assign(document.createElement("span"), { textContent: index + 1 });
      button.append(number, document.createTextNode(choice));
      button.addEventListener("click", () => selectAnswer(index, button));
      return button;
    });
    answerList.replaceChildren(...buttons);
  }

  function openTest() {
    if (document.getElementById("open-test").disabled) return;
    activeMode = "test";
    activeLesson = null;
    questionIndex = 0;
    testAnswers = {};
    renderQuestion();
    showScreen("lesson");
  }

  async function finishLesson() {
    if (currentUser.role !== "student") {
      showHome();
      showToast("Teacher preview completed. No student progress changed.");
      return;
    }
    checkButton.disabled = true;
    await api(`/api/progress/${activeLesson.id}`, {
      method: "PUT",
      body: JSON.stringify({ status: "completed", score: 100, xp: activeLesson.xp })
    });
    await loadStudent();
    showToast(`+${activeLesson.xp} XP saved. చాలా బాగుంది!`);
  }

  async function submitTest() {
    checkButton.disabled = true;
    const result = await api("/api/modules/3/weeks/1/test/submit", {
      method: "POST",
      body: JSON.stringify({ answers: testAnswers })
    });
    const resultBox = document.createElement("div");
    resultBox.className = "test-result";
    const score = Object.assign(document.createElement("strong"), { textContent: `${result.score}%` });
    const message = Object.assign(document.createElement("span"), { textContent: `${result.message} ${result.message_telugu}` });
    resultBox.append(score, message);
    feedback.replaceChildren(resultBox);
    answerFooter.className = result.passed ? "correct" : "wrong";
    checkButton.textContent = "Finish";
    checkButton.dataset.mode = "finish-test";
    checkButton.disabled = false;
  }

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

  document.querySelectorAll("[data-home]").forEach((button) => button.addEventListener("click", showHome));
  document.getElementById("logout-button").addEventListener("click", () => {
    clearSession();
    loginForm.reset();
    document.getElementById("school-code").value = "MANA001";
    showScreen("login");
    showToast("You have signed out.");
  });
  document.getElementById("preview-student").addEventListener("click", () => {
    progressRecords = [];
    renderStudent(currentUser, []);
    showScreen("student");
    showToast("Student preview · progress changes are disabled");
  });
  document.querySelector(".today-card .open-lesson").addEventListener("click", openNextLesson);
  document.getElementById("open-test").addEventListener("click", openTest);
  document.getElementById("close-lesson").addEventListener("click", showHome);
  document.getElementById("exercise-audio").addEventListener("click", () => speak(activeQuestions()[questionIndex].audio));
  document.querySelectorAll(".word .sound-button").forEach((button) => button.addEventListener("click", () => speak("confident")));

  checkButton.addEventListener("click", async () => {
    try {
      if (checkButton.dataset.mode === "finish-test") {
        await loadStudent();
        return;
      }
      if (checkButton.dataset.mode === "continue") {
        if (questionIndex + 1 < activeQuestions().length) {
          questionIndex += 1;
          renderQuestion();
        } else {
          await finishLesson();
        }
        return;
      }
      if (checkButton.dataset.mode === "retry") {
        renderQuestion();
        return;
      }
      if (selectedIndex === null) return;

      const question = activeQuestions()[questionIndex];
      if (activeMode === "test") {
        testAnswers[question.id] = selectedIndex;
        if (questionIndex + 1 < activeQuestions().length) {
          questionIndex += 1;
          renderQuestion();
        } else {
          await submitTest();
        }
        return;
      }

      checkButton.disabled = true;
      const result = await api("/api/modules/3/weeks/1/check", {
        method: "POST",
        body: JSON.stringify({ question_id: question.id, selected_index: selectedIndex })
      });
      const title = document.createElement("b");
      const detail = document.createElement("p");
      title.textContent = result.correct ? "Excellent! చాలా బాగుంది!" : "Let’s try again · మళ్ళీ ప్రయత్నిద్దాం";
      detail.textContent = `${result.feedback} ${result.feedback_telugu}`;
      feedback.replaceChildren(title, detail);
      answerFooter.className = result.correct ? "correct" : "wrong";
      checkButton.textContent = result.correct ? (questionIndex + 1 === activeQuestions().length ? "Complete lesson" : "Continue") : "Try again";
      checkButton.dataset.mode = result.correct ? "continue" : "retry";
      checkButton.disabled = false;
    } catch (error) {
      showToast(error.message);
      checkButton.disabled = false;
    }
  });

  document.querySelectorAll("button").forEach((button) => {
    const wired = button.matches("[data-login-role],[data-home],.open-lesson,.sound-button,#exercise-audio,#close-lesson,#check-answer,#logout-button,#preview-student,#open-test") || button.type === "submit";
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
