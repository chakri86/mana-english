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
  let questionAttemptNumber = 1;
  let lessonMasteredQuestions = new Set();
  let lessonQuestionSubset = null;
  let testAnswers = {};
  let assignmentRecords = [];
  let teacherData = null;
  let speakPhrases = [];
  let speakIndex = 0;
  let mediaRecorder = null;
  let mediaStream = null;
  let recordingChunks = [];
  let practiceQuestions = [];
  let practiceCurrent = null;
  let practiceAttemptNumber = 1;
  let improvementData = { total_mistakes: 0, needs_practice: 0, questions: [], history: [] };
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
    if (currentUser && currentUser.role === "student") {
      showStudentView("learn");
      showScreen("student");
    } else {
      showTeacherView("dashboard");
      showScreen("teacher");
    }
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
    document.getElementById("header-lessons").textContent = user.role === "student" ? "0 lessons" : "Class 3A";
  }

  function clearSession() {
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(USER_KEY);
    currentUser = null;
    moduleData = null;
    progressRecords = [];
    assignmentRecords = [];
    teacherData = null;
  }

  function preferredFemaleVoice(language) {
    const voices = window.speechSynthesis.getVoices();
    const languagePrefix = language.toLowerCase().split("-")[0];
    const matching = voices.filter((voice) => voice.lang.toLowerCase().startsWith(languagePrefix));
    const femaleHints = ["female", "heera", "shruti", "priya", "swara", "veena", "zira", "aria", "samantha", "susan", "karen", "moira", "ava", "natasha", "neerja", "lekha"];
    return matching.find((voice) => femaleHints.some((hint) => voice.name.toLowerCase().includes(hint)))
      || matching.find((voice) => voice.lang.toLowerCase() === language.toLowerCase())
      || matching[0]
      || null;
  }

  function speak(text, language = "en-IN") {
    if (!("speechSynthesis" in window)) {
      showToast("Audio is not supported by this browser.");
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = language;
    const voice = preferredFemaleVoice(language);
    if (voice) utterance.voice = voice;
    utterance.rate = 0.78;
    utterance.pitch = 1.08;
    window.speechSynthesis.speak(utterance);
  }

  function createAnswerOption(choice, index, onSelect) {
    const row = document.createElement("div");
    row.className = "answer-option";
    const choiceButton = document.createElement("button");
    choiceButton.type = "button";
    choiceButton.className = "answer-choice";
    choiceButton.dataset.answerIndex = String(index);
    const number = Object.assign(document.createElement("span"), { textContent: index + 1 });
    choiceButton.append(number, document.createTextNode(choice));
    choiceButton.addEventListener("click", () => onSelect(index, choiceButton));
    const listenButton = document.createElement("button");
    listenButton.type = "button";
    listenButton.className = "answer-listen";
    listenButton.textContent = "🔊";
    listenButton.setAttribute("aria-label", `Listen to answer ${index + 1}: ${choice}`);
    listenButton.addEventListener("click", () => speak(choice, "en-IN"));
    row.append(choiceButton, listenButton);
    return row;
  }

  function completedLessonCount(progress) {
    return progress.filter((item) => item.lesson_id.includes("-lesson") && item.status === "completed").length;
  }

  function showStudentView(name) {
    document.querySelectorAll(".student-view").forEach((view) => view.classList.toggle("active", view.id === `student-${name}-view`));
    document.querySelectorAll("[data-student-view]").forEach((button) => button.classList.toggle("nav-active", button.dataset.studentView === name));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function showTeacherView(name) {
    document.querySelectorAll(".teacher-view").forEach((view) => view.classList.toggle("active", view.id === `teacher-${name}-view`));
    document.querySelectorAll("[data-teacher-view]").forEach((button) => button.classList.toggle("nav-active", button.dataset.teacherView === name));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function spokenCountKey() {
    return `mana_spoken_count_${currentUser ? currentUser.username : "guest"}`;
  }

  function spokenCount() {
    return Number(localStorage.getItem(spokenCountKey()) || 0);
  }

  function updateSpokenCount() {
    const count = spokenCount() + 1;
    localStorage.setItem(spokenCountKey(), count);
    document.getElementById("progress-spoken").textContent = count;
    return count;
  }

  function renderSpeakPhrase() {
    if (!speakPhrases.length) return;
    const phrase = speakPhrases[speakIndex % speakPhrases.length];
    document.getElementById("speak-step").textContent = `PHRASE ${speakIndex + 1} OF ${speakPhrases.length}`;
    document.getElementById("speak-english").textContent = phrase.english;
    document.getElementById("speak-pronunciation").textContent = phrase.pronunciation_telugu;
    document.getElementById("speak-meaning").textContent = phrase.meaning_telugu;
    if (!window.isSecureContext || !navigator.mediaDevices || !window.MediaRecorder) {
      document.getElementById("speak-record").textContent = "✓ Mark as practised";
    }
  }

  function simpleRow(primary, second, third, fourth, warning = false) {
    const row = document.createElement("div");
    row.className = "simple-row";
    const name = Object.assign(document.createElement("b"), { textContent: primary });
    const value2 = Object.assign(document.createElement("span"), { textContent: second });
    const value3 = Object.assign(document.createElement("span"), { textContent: third });
    const statusValue = document.createElement("em");
    statusValue.textContent = fourth;
    if (warning) statusValue.className = "warning";
    row.append(name, value2, value3, statusValue);
    return row;
  }

  function metricCard(icon, label, value, detail) {
    const card = document.createElement("article");
    card.append(document.createTextNode(icon));
    const copy = document.createElement("div");
    copy.append(
      Object.assign(document.createElement("small"), { textContent: label }),
      Object.assign(document.createElement("b"), { textContent: value }),
      Object.assign(document.createElement("em"), { textContent: detail })
    );
    card.append(copy);
    return card;
  }

  function renderMistakeHistory(improvements) {
    const improvementList = document.getElementById("student-improvement-list");
    const mistakeHistory = document.getElementById("student-mistake-history");
    document.getElementById("improvement-count").textContent = `${improvements.total_mistakes} mistake${improvements.total_mistakes === 1 ? "" : "s"}`;
    improvementList.replaceChildren(...(improvements.questions.length
      ? improvements.questions.map((item) => simpleRow(
        item.lesson_title,
        `${item.prompt} · ${item.prompt_telugu}`,
        `${item.mistake_count} mistake${item.mistake_count === 1 ? "" : "s"}`,
        item.status,
        item.status === "Needs practice"
      ))
      : [Object.assign(document.createElement("div"), { className: "empty-state", textContent: "No mistakes recorded yet. Keep practising! · ఇంకా తప్పులు నమోదు కాలేదు." })]));
    mistakeHistory.replaceChildren(...(improvements.history.length
      ? improvements.history.map((item) => {
        const card = document.createElement("article");
        card.className = "mistake-item";
        card.append(
          Object.assign(document.createElement("b"), { textContent: item.prompt }),
          Object.assign(document.createElement("p"), { textContent: item.lesson_title }),
          Object.assign(document.createElement("span"), { textContent: `Your answer: ${item.selected_answer}` }),
          Object.assign(document.createElement("em"), { textContent: `Correct answer: ${item.correct_answer} · ${item.feedback_telugu}` })
        );
        return card;
      })
      : [Object.assign(document.createElement("div"), { className: "empty-state", textContent: "Your mistake history will appear here." })]));
  }

  function renderStudentSecondary(user, progress, assignments, improvements) {
    const records = new Map(progress.map((item) => [item.lesson_id, item]));
    const completed = completedLessonCount(progress);
    const testRecord = records.get(moduleData.weekend_test.id);
    const lessonScores = progress.filter((item) => item.lesson_id.includes("-lesson") && item.status === "completed");
    const accuracy = lessonScores.length ? Math.round(lessonScores.reduce((sum, item) => sum + item.score, 0) / lessonScores.length) : 0;

    speakPhrases = moduleData.lessons.flatMap((lesson) => lesson.key_phrases);
    speakIndex = Math.min(speakIndex, Math.max(speakPhrases.length - 1, 0));
    renderSpeakPhrase();
    document.getElementById("progress-lessons").textContent = completed;
    document.getElementById("progress-spoken").textContent = spokenCount();

    const improvementIds = new Set(improvements.questions.map((item) => item.question_id));
    practiceQuestions = moduleData.lessons
      .filter((lesson, index) => records.has(lesson.id) || index === 0)
      .flatMap((lesson) => lesson.questions)
      .sort((left, right) => Number(improvementIds.has(right.id)) - Number(improvementIds.has(left.id)));
    practiceCurrent = null;
    document.getElementById("practice-question").textContent = "Choose Start practice to begin.";
    document.getElementById("practice-telugu").textContent = "";
    document.getElementById("practice-answers").replaceChildren();
    document.getElementById("practice-feedback").textContent = "";
    document.getElementById("practice-button").textContent = "Start practice";
    document.getElementById("practice-listen-english").disabled = true;
    document.getElementById("practice-listen-telugu").disabled = true;

    const testsButton = document.getElementById("tests-start-button");
    testsButton.disabled = completed < moduleData.lessons.length;
    testsButton.textContent = testRecord ? `Retake Week 1 test · ${testRecord.score}%` : completed >= moduleData.lessons.length ? "Start Week 1 test" : `Complete ${moduleData.lessons.length - completed} more lesson${moduleData.lessons.length - completed === 1 ? "" : "s"}`;
    const history = document.getElementById("student-test-history");
    history.replaceChildren(testRecord
      ? simpleRow("Week 1 Challenge", `${testRecord.score}%`, `${testRecord.attempts} attempt${testRecord.attempts === 1 ? "" : "s"}`, testRecord.score >= 70 ? "Passed" : "Review", testRecord.score < 70)
      : Object.assign(document.createElement("div"), { className: "empty-state", textContent: "No completed tests yet." }));

    document.getElementById("student-progress-metrics").replaceChildren(
      metricCard("⚡", "Total XP", String(user.xp || 0), "All activities"),
      metricCard("📚", "Lessons", `${completed}/5`, "Week 1"),
      metricCard("🎯", "Accuracy", `${accuracy}%`, "Lesson practice")
    );
    document.getElementById("progress-completion-label").textContent = `${completed} of 5 complete`;
    document.getElementById("student-progress-list").replaceChildren(...moduleData.lessons.map((lesson) => {
      const record = records.get(lesson.id);
      const completedLesson = record && record.status === "completed";
      const needsPractice = record && record.status === "needs_practice";
      const lessonStatus = completedLesson ? "Completed" : needsPractice ? "Needs practice" : "Not started";
      return simpleRow(lesson.title, lesson.day, completedLesson ? `+${record.xp} XP` : "0 XP", lessonStatus, needsPractice);
    }));
    renderMistakeHistory(improvements);
    const assignmentList = document.getElementById("student-assignment-list");
    assignmentList.replaceChildren(...(assignments.length
      ? assignments.map((item) => simpleRow(item.title, `Due ${item.due_date}`, `Class ${item.grade}${item.section}`, records.has(item.lesson_id) ? "Completed" : "Assigned"))
      : [Object.assign(document.createElement("div"), { className: "empty-state", textContent: "No teacher assignments yet." })]));
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
    lessonMasteredQuestions = new Set();
    lessonQuestionSubset = null;
    testAnswers = {};
    renderQuestion();
    showScreen("lesson");
  }

  function openNextLesson() {
    const completed = completedLessonCount(progressRecords);
    const lesson = moduleData && moduleData.lessons[Math.min(completed, moduleData.lessons.length - 1)];
    if (lesson) openLessonById(lesson.id);
  }

  function renderStudent(user, progress, assignments = [], improvements = improvementData) {
    progressRecords = progress;
    const records = new Map(progress.map((item) => [item.lesson_id, item]));
    const completed = completedLessonCount(progress);
    const scored = progress.filter((item) => item.lesson_id.includes("-lesson") && item.status === "completed");
    const accuracy = scored.length ? Math.round(scored.reduce((sum, item) => sum + item.score, 0) / scored.length) : 0;
    document.getElementById("student-first-name").textContent = firstName(user.display_name);
    document.getElementById("weekly-goal-text").textContent = `${completed} / 5 lessons`;
    document.getElementById("weekly-goal-bar").style.width = `${Math.min(completed * 20, 100)}%`;
    document.getElementById("progress-xp").textContent = user.xp || 0;
    document.getElementById("progress-accuracy").textContent = `${accuracy}%`;
    document.getElementById("header-xp").textContent = `${user.xp || 0} XP`;
    document.getElementById("header-lessons").textContent = `${completed} lesson${completed === 1 ? "" : "s"}`;

    document.querySelectorAll(".path-item[data-lesson-id]").forEach((item, index) => {
      const lesson = moduleData.lessons[index];
      const record = records.get(item.dataset.lessonId);
      const isDone = record && record.status === "completed";
      const needsPractice = record && record.status === "needs_practice";
      const canStart = isDone || needsPractice || index <= completed;
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
        node.textContent = needsPractice ? "↻" : index === completed ? "🙂" : "💬";
        const button = document.createElement("button");
        button.textContent = needsPractice ? "Practice again" : index === completed ? "Continue" : "Start";
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
    improvementData = improvements;
    renderStudentSecondary(user, progress, assignments, improvements);
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
    studentStatus.textContent = student.mistakes ? `${student.status} · ${student.mistakes}` : student.status;
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

  function createLessonLibraryCard(lesson, index) {
    const card = document.createElement("article");
    card.className = "lesson-library-card";
    card.append(
      Object.assign(document.createElement("span"), { textContent: `${lesson.day} · LESSON ${index + 1} · ${lesson.duration_minutes} MIN` }),
      Object.assign(document.createElement("h3"), { textContent: lesson.title }),
      Object.assign(document.createElement("p"), { textContent: `${lesson.objective} ${lesson.objective_telugu}` })
    );
    const footer = document.createElement("footer");
    const preview = Object.assign(document.createElement("button"), { textContent: "Preview practice" });
    preview.addEventListener("click", () => openLessonById(lesson.id));
    const assign = Object.assign(document.createElement("button"), { textContent: "Assign lesson" });
    assign.addEventListener("click", () => openAssignmentDialog(lesson.id));
    footer.append(preview, assign);
    card.append(footer);
    return card;
  }

  function renderTeacherSecondary(data, assignments) {
    const students = data.students;
    document.getElementById("teacher-students-table").replaceChildren(...students.map(createRosterRow));
    document.getElementById("student-search-count").textContent = `${students.length} students`;
    document.getElementById("teacher-lesson-library").replaceChildren(...moduleData.lessons.map(createLessonLibraryCard));

    const tested = students.filter((student) => student.test_score > 0);
    const passed = students.filter((student) => student.test_score >= 70);
    const needsHelp = students.filter((student) => student.status === "Needs help");
    document.getElementById("assessment-metrics").replaceChildren(
      metricCard("📝", "Tests completed", `${tested.length}/${students.length}`, "Week 1"),
      metricCard("✅", "Passed", String(passed.length), "70% or higher"),
      metricCard("🎯", "Class average", `${data.metrics.average_accuracy}%`, "All students"),
      metricCard("🧭", "Needs support", String(needsHelp.length), "Follow-up group")
    );
    const assessmentList = document.getElementById("teacher-assessment-list");
    assessmentList.replaceChildren(...(students.length
      ? students.map((student) => simpleRow(student.name, student.username, student.test_score ? `${student.test_score}%` : "Not taken", student.test_score >= 70 ? "Passed" : student.test_score ? "Review" : "Pending", student.test_score > 0 && student.test_score < 70))
      : [Object.assign(document.createElement("div"), { className: "empty-state", textContent: "No students found." })]));

    document.getElementById("report-metrics").replaceChildren(
      metricCard("👥", "Students", String(data.metrics.total_students), "Class 3A"),
      metricCard("📚", "Lessons completed", String(data.metrics.lessons_completed), "Weekly total"),
      metricCard("🎯", "Average test", `${data.metrics.average_accuracy}%`, "Week 1"),
      metricCard("⚡", "Total XP", String(students.reduce((sum, student) => sum + student.xp, 0)), "Class total")
    );
    const attention = document.getElementById("attention-list");
    attention.replaceChildren(...(needsHelp.length
      ? needsHelp.map((student) => simpleRow(student.name, student.improvement_area, `${student.mistakes} mistake${student.mistakes === 1 ? "" : "s"}`, "Needs help", true))
      : [Object.assign(document.createElement("div"), { className: "empty-state", textContent: "No students currently require attention." })]));

    const lessonSelect = document.getElementById("assignment-lesson");
    lessonSelect.replaceChildren(...moduleData.lessons.map((lesson, index) => {
      const option = document.createElement("option");
      option.value = lesson.id;
      option.textContent = `Lesson ${index + 1} · ${lesson.title}`;
      return option;
    }));
    const latest = assignments[0];
    document.getElementById("latest-assignment-title").textContent = latest ? latest.title : "No assignment yet";
    document.getElementById("latest-assignment-detail").textContent = latest ? `Due ${latest.due_date}` : "Assign a Week 1 lesson to Class 3A.";
    document.getElementById("latest-assignment-meta").textContent = latest ? `👥 Class ${latest.grade}${latest.section} · ${latest.lesson_id}` : "👥 Class 3A";
  }

  function renderTeacher(data, assignments = []) {
    const metrics = data.metrics;
    document.getElementById("teacher-school").textContent = data.school;
    document.getElementById("teacher-name").textContent = firstName(currentUser.display_name);
    document.getElementById("metric-students").textContent = `${metrics.active_students} / ${metrics.total_students}`;
    document.getElementById("metric-lessons").textContent = metrics.lessons_completed;
    document.getElementById("metric-accuracy").textContent = `${metrics.average_accuracy}%`;
    document.getElementById("metric-reviews").textContent = metrics.speaking_reviews;
    document.getElementById("student-roster").replaceChildren(...data.students.map(createRosterRow));
    document.getElementById("teacher-week-plan").replaceChildren(...moduleData.lessons.map(createTeacherDay));
    renderTeacherSecondary(data, assignments);
  }

  async function loadStudent() {
    const [user, progress, week, assignments, improvements] = await Promise.all([
      api("/api/auth/me"), api("/api/progress"), api("/api/modules/3/weeks/1"), api("/api/assignments"), api("/api/improvements")
    ]);
    setUser(user);
    moduleData = week;
    assignmentRecords = assignments;
    improvementData = improvements;
    renderStudent(user, progress, assignments, improvements);
    showStudentView("learn");
    showScreen("student");
  }

  async function loadTeacher() {
    const [user, dashboard, week, assignments] = await Promise.all([
      api("/api/auth/me"), api("/api/teacher/dashboard"), api("/api/modules/3/weeks/1"), api("/api/assignments")
    ]);
    setUser(user);
    moduleData = week;
    teacherData = dashboard;
    assignmentRecords = assignments;
    renderTeacher(dashboard, assignments);
    showTeacherView("dashboard");
    showScreen("teacher");
  }

  async function initializeSession(user) {
    if (user.role === "student") await loadStudent();
    else await loadTeacher();
  }

  function activeQuestions() {
    if (activeMode === "test") return moduleData.weekend_test.questions;
    return lessonQuestionSubset || activeLesson.questions;
  }

  function resetAnswer() {
    selectedIndex = null;
    questionAttemptNumber = 1;
    checkButton.disabled = true;
    checkButton.dataset.mode = "check";
    checkButton.textContent = activeMode === "test" ? "Save answer" : "Check answer";
    answerFooter.className = "";
    feedback.replaceChildren();
  }

  function selectAnswer(index, button) {
    if (button.disabled) return;
    selectedIndex = index;
    answerList.querySelectorAll(".answer-choice").forEach((item) => item.classList.toggle("selected", item === button));
    checkButton.disabled = false;
    if (activeMode !== "test" && questionAttemptNumber === 2) checkButton.textContent = "Check again";
    answerFooter.className = "";
    feedback.replaceChildren();
  }

  function renderQuestion() {
    const questions = activeQuestions();
    const question = questions[questionIndex];
    const isTest = activeMode === "test";
    resetAnswer();
    document.getElementById("exercise-eyebrow").textContent = isTest ? "WEEKEND TEST · NO ANSWER HINTS" : `${activeLesson.day} · SPEAKING PRACTICE`;
    document.getElementById("exercise-title").textContent = question.prompt;
    document.getElementById("exercise-telugu").textContent = question.prompt_telugu;
    document.getElementById("exercise-phrase").textContent = isTest ? "Listen to the question" : `“${question.audio}”`;
    document.getElementById("exercise-pronunciation").textContent = isTest ? "ప్రశ్నను మాత్రమే వినండి. సమాధానం చూపించబడదు." : question.pronunciation_telugu;
    document.getElementById("lesson-counter").textContent = `${questionIndex + 1} / ${questions.length}`;
    document.getElementById("lesson-progress-bar").style.width = `${((questionIndex + 1) / questions.length) * 100}%`;
    answerList.replaceChildren(...question.choices.map((choice, index) => createAnswerOption(choice, index, selectAnswer)));
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
    const masteredCount = lessonMasteredQuestions.size;
    const score = Math.round((masteredCount / activeLesson.questions.length) * 100);
    const completed = score >= 67;
    await api(`/api/progress/${activeLesson.id}`, {
      method: "PUT",
      body: JSON.stringify({ status: completed ? "completed" : "needs_practice", score, xp: completed ? activeLesson.xp : 0 })
    });
    if (completed) {
      await loadStudent();
      showToast(`Lesson mastered · +${activeLesson.xp} XP. చాలా బాగుంది!`);
      return;
    }
    lessonQuestionSubset = activeLesson.questions.filter((question) => !lessonMasteredQuestions.has(question.id));
    questionIndex = 0;
    document.getElementById("exercise-eyebrow").textContent = "MORE PRACTICE NEEDED";
    document.getElementById("exercise-title").textContent = `${masteredCount} of ${activeLesson.questions.length} questions mastered`;
    document.getElementById("exercise-telugu").textContent = `పాఠం పూర్తి కావడానికి కనీసం 3లో 2 ప్రశ్నలకు సరైన సమాధానం ఇవ్వాలి.`;
    document.getElementById("exercise-phrase").textContent = "Keep trying — you can do it!";
    document.getElementById("exercise-pronunciation").textContent = "మళ్లీ ప్రయత్నించండి!";
    document.getElementById("lesson-counter").textContent = `${masteredCount} / ${activeLesson.questions.length} mastered`;
    document.getElementById("lesson-progress-bar").style.width = `${score}%`;
    answerList.replaceChildren();
    feedback.replaceChildren(
      Object.assign(document.createElement("b"), { textContent: "Lesson not completed · పాఠం ఇంకా పూర్తి కాలేదు" }),
      Object.assign(document.createElement("p"), { textContent: "Practise the missed questions and earn mastery before moving to the next lesson." })
    );
    answerFooter.className = "wrong";
    checkButton.textContent = "Practice missed questions";
    checkButton.dataset.mode = "retry-missed";
    checkButton.disabled = false;
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

  function nextSpeakPhrase() {
    if (!speakPhrases.length) return;
    speakIndex = (speakIndex + 1) % speakPhrases.length;
    renderSpeakPhrase();
    document.getElementById("recording-result").className = "recording-result";
    document.getElementById("recording-result").textContent = "Your recording will appear here.";
  }

  async function toggleRecording() {
    const button = document.getElementById("speak-record");
    const result = document.getElementById("recording-result");
    if (mediaRecorder && mediaRecorder.state === "recording") {
      mediaRecorder.stop();
      button.textContent = "🎙️ Start recording";
      return;
    }
    if (!window.isSecureContext || !navigator.mediaDevices || !window.MediaRecorder) {
      const count = updateSpokenCount();
      result.className = "recording-result success";
      result.textContent = `Practice counted (${count}). Microphone recording becomes available when the site uses trusted HTTPS.`;
      return;
    }
    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recordingChunks = [];
      mediaRecorder = new MediaRecorder(mediaStream);
      mediaRecorder.addEventListener("dataavailable", (event) => {
        if (event.data.size) recordingChunks.push(event.data);
      });
      mediaRecorder.addEventListener("stop", () => {
        const blob = new Blob(recordingChunks, { type: mediaRecorder.mimeType || "audio/webm" });
        const audio = document.createElement("audio");
        audio.controls = true;
        audio.src = URL.createObjectURL(blob);
        result.className = "recording-result success";
        result.replaceChildren(Object.assign(document.createElement("b"), { textContent: "Recording saved on this device · మీ రికార్డింగ్ సిద్ధంగా ఉంది" }), audio);
        if (mediaStream) mediaStream.getTracks().forEach((track) => track.stop());
        updateSpokenCount();
        mediaRecorder = null;
      });
      mediaRecorder.start();
      button.textContent = "■ Stop recording";
      result.className = "recording-result success";
      result.textContent = "Recording… Speak the phrase clearly.";
    } catch (_) {
      result.textContent = "Microphone access was not allowed. Enable microphone permission and try again.";
    }
  }

  function renderPracticeQuestion() {
    if (!practiceQuestions.length) {
      document.getElementById("practice-feedback").textContent = "Complete a lesson to unlock mixed practice.";
      return;
    }
    const choices = practiceQuestions.filter((question) => question !== practiceCurrent);
    practiceCurrent = choices[Math.floor(Math.random() * choices.length)] || practiceQuestions[0];
    practiceAttemptNumber = 1;
    document.getElementById("practice-question").textContent = practiceCurrent.prompt;
    document.getElementById("practice-telugu").textContent = practiceCurrent.prompt_telugu;
    document.getElementById("practice-feedback").textContent = "";
    document.getElementById("practice-button").textContent = "Next question";
    document.getElementById("practice-listen-english").disabled = false;
    document.getElementById("practice-listen-telugu").disabled = false;
    document.getElementById("practice-answers").replaceChildren(...practiceCurrent.choices.map((choice, index) => createAnswerOption(choice, index, checkPracticeAnswer)));
  }

  async function checkPracticeAnswer(index, selectedButton) {
    const buttons = [...document.getElementById("practice-answers").querySelectorAll(".answer-choice")];
    buttons.forEach((button) => { button.disabled = true; });
    selectedButton.classList.add("selected");
    try {
      const result = await api("/api/modules/3/weeks/1/check", {
        method: "POST",
        body: JSON.stringify({ question_id: practiceCurrent.id, selected_index: index, attempt_number: practiceAttemptNumber, activity: "practice" })
      });
      const target = document.getElementById("practice-feedback");
      if (result.correct) {
        selectedButton.classList.add("correct-answer");
        target.textContent = `✓ ${result.feedback} ${result.feedback_telugu}`;
        target.className = "inline-feedback success";
      } else if (!result.reveal_correct) {
        selectedButton.classList.remove("selected");
        selectedButton.closest(".answer-option").classList.add("eliminated");
        practiceAttemptNumber = 2;
        buttons.forEach((button) => { if (!button.closest(".answer-option").classList.contains("eliminated")) button.disabled = false; });
        target.textContent = "One wrong choice removed. Choose again from the two answers. · ఒక తప్పు ఎంపిక తొలగించబడింది. మిగిలిన రెండింటిలో మళ్లీ ఎంచుకోండి.";
        target.className = "inline-feedback warning";
      } else {
        selectedButton.classList.add("wrong-answer");
        const correctButton = buttons.find((button) => Number(button.dataset.answerIndex) === result.correct_index);
        if (correctButton) {
          correctButton.closest(".answer-option").classList.remove("eliminated");
          correctButton.classList.add("correct-answer");
        }
        target.textContent = `Correct answer: ${result.correct_answer}. ${result.feedback} ${result.feedback_telugu}`;
        target.className = "inline-feedback warning";
      }
    } catch (error) {
      showToast(error.message);
      buttons.forEach((button) => { if (!button.closest(".answer-option").classList.contains("eliminated")) button.disabled = false; });
    }
  }

  function openAssignmentDialog(lessonId = null) {
    if (lessonId) document.getElementById("assignment-lesson").value = lessonId;
    if (!document.getElementById("assignment-due-date").value) {
      const due = new Date();
      due.setDate(due.getDate() + 7);
      document.getElementById("assignment-due-date").value = due.toISOString().slice(0, 10);
    }
    document.getElementById("assignment-error").textContent = "";
    document.getElementById("assignment-dialog").showModal();
  }

  async function submitAssignment(event) {
    event.preventDefault();
    const error = document.getElementById("assignment-error");
    error.textContent = "";
    try {
      await api("/api/teacher/assignments", {
        method: "POST",
        body: JSON.stringify({
          grade: 3,
          section: document.getElementById("assignment-section").value,
          lesson_id: document.getElementById("assignment-lesson").value,
          due_date: document.getElementById("assignment-due-date").value
        })
      });
      document.getElementById("assignment-dialog").close();
      await loadTeacher();
      showToast("Lesson assigned to Class 3A.");
    } catch (requestError) {
      error.textContent = requestError.message;
    }
  }

  async function downloadReport() {
    try {
      const response = await fetch("/api/teacher/report.csv", { headers: { Authorization: `Bearer ${token()}` } });
      if (!response.ok) throw new Error("Report download failed.");
      const blob = await response.blob();
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = "mana-english-class3a-week1.csv";
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(link.href);
    } catch (error) {
      showToast(error.message);
    }
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
  document.querySelectorAll("[data-student-view]").forEach((button) => button.addEventListener("click", () => {
    showStudentView(button.dataset.studentView);
    showScreen("student");
  }));
  document.querySelectorAll("[data-teacher-view]").forEach((button) => button.addEventListener("click", () => {
    showTeacherView(button.dataset.teacherView);
    showScreen("teacher");
  }));
  document.getElementById("logout-button").addEventListener("click", () => {
    clearSession();
    loginForm.reset();
    document.getElementById("school-code").value = "MANA001";
    showScreen("login");
    showToast("You have signed out.");
  });
  document.getElementById("preview-student").addEventListener("click", () => {
    progressRecords = [];
    renderStudent(currentUser, [], [], { total_mistakes: 0, needs_practice: 0, questions: [], history: [] });
    showStudentView("learn");
    showScreen("student");
    showToast("Student preview · progress changes are disabled");
  });
  document.querySelector(".today-card .open-lesson").addEventListener("click", openNextLesson);
  document.querySelector(".today-card .sound-button").addEventListener("click", () => speak("My name is Ananya."));
  document.getElementById("open-test").addEventListener("click", openTest);
  document.getElementById("tests-start-button").addEventListener("click", () => {
    if (document.getElementById("tests-start-button").disabled) showToast("Complete all five lessons to unlock the test.");
    else openTest();
  });
  document.getElementById("close-lesson").addEventListener("click", async () => {
    if (currentUser && currentUser.role === "student") await loadStudent();
    else showHome();
  });
  document.getElementById("exercise-audio").addEventListener("click", () => {
    const question = activeQuestions()[questionIndex];
    speak(activeMode === "test" ? question.prompt : question.audio, "en-IN");
  });
  document.getElementById("exercise-audio-telugu").addEventListener("click", () => {
    const question = activeQuestions()[questionIndex];
    speak(question.prompt_telugu, "te-IN");
  });
  document.querySelectorAll(".word .sound-button").forEach((button) => button.addEventListener("click", () => speak("confident")));
  document.getElementById("speak-listen").addEventListener("click", () => speak(speakPhrases[speakIndex].english));
  document.getElementById("speak-record").addEventListener("click", toggleRecording);
  document.getElementById("speak-next").addEventListener("click", nextSpeakPhrase);
  document.getElementById("practice-button").addEventListener("click", renderPracticeQuestion);
  document.getElementById("practice-listen-english").addEventListener("click", () => {
    if (practiceCurrent) speak(practiceCurrent.prompt, "en-IN");
  });
  document.getElementById("practice-listen-telugu").addEventListener("click", () => {
    if (practiceCurrent) speak(practiceCurrent.prompt_telugu, "te-IN");
  });
  document.getElementById("telugu-help-button").addEventListener("click", () => document.getElementById("telugu-help-dialog").showModal());
  document.querySelectorAll("[data-close-dialog]").forEach((button) => button.addEventListener("click", () => document.getElementById(button.dataset.closeDialog).close()));
  document.querySelectorAll(".assign-lesson-button").forEach((button) => button.addEventListener("click", () => openAssignmentDialog()));
  document.getElementById("assignment-form").addEventListener("submit", submitAssignment);
  document.getElementById("download-report").addEventListener("click", downloadReport);
  document.getElementById("student-search").addEventListener("input", (event) => {
    if (!teacherData) return;
    const query = event.target.value.trim().toLowerCase();
    const filtered = teacherData.students.filter((student) => `${student.name} ${student.username}`.toLowerCase().includes(query));
    document.getElementById("teacher-students-table").replaceChildren(...filtered.map(createRosterRow));
    document.getElementById("student-search-count").textContent = `${filtered.length} student${filtered.length === 1 ? "" : "s"}`;
  });

  checkButton.addEventListener("click", async () => {
    try {
      if (checkButton.dataset.mode === "finish-test") {
        await loadStudent();
        return;
      }
      if (checkButton.dataset.mode === "retry-missed") {
        questionIndex = 0;
        renderQuestion();
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
        body: JSON.stringify({ question_id: question.id, selected_index: selectedIndex, attempt_number: questionAttemptNumber, activity: "lesson" })
      });
      const title = document.createElement("b");
      const detail = document.createElement("p");
      const buttons = [...answerList.querySelectorAll(".answer-choice")];
      const selectedButton = buttons.find((button) => Number(button.dataset.answerIndex) === selectedIndex);
      if (result.correct) {
        lessonMasteredQuestions.add(question.id);
        buttons.forEach((button) => { button.disabled = true; });
        if (selectedButton) selectedButton.classList.add("correct-answer");
        title.textContent = "Excellent! చాలా బాగుంది!";
        detail.textContent = `${result.feedback} ${result.feedback_telugu}`;
        feedback.replaceChildren(title, detail);
        answerFooter.className = "correct";
        checkButton.textContent = questionIndex + 1 === activeQuestions().length ? "Finish lesson" : "Continue";
        checkButton.dataset.mode = "continue";
        checkButton.disabled = false;
      } else if (!result.reveal_correct) {
        if (selectedButton) {
          selectedButton.classList.remove("selected");
          selectedButton.closest(".answer-option").classList.add("eliminated");
          selectedButton.disabled = true;
        }
        selectedIndex = null;
        questionAttemptNumber = 2;
        title.textContent = "One choice removed · ఒక ఎంపిక తొలగించబడింది";
        detail.textContent = "Choose again from the two remaining answers. · మిగిలిన రెండు సమాధానాల్లో మళ్లీ ఎంచుకోండి.";
        feedback.replaceChildren(title, detail);
        answerFooter.className = "wrong";
        checkButton.textContent = "Check again";
        checkButton.dataset.mode = "check";
        checkButton.disabled = true;
      } else {
        buttons.forEach((button) => { button.disabled = true; });
        if (selectedButton) selectedButton.classList.add("wrong-answer");
        const correctButton = buttons.find((button) => Number(button.dataset.answerIndex) === result.correct_index);
        if (correctButton) {
          correctButton.closest(".answer-option").classList.remove("eliminated");
          correctButton.classList.remove("selected");
          correctButton.classList.add("correct-answer");
        }
        title.textContent = `Correct answer: ${result.correct_answer}`;
        detail.textContent = `${result.feedback} ${result.feedback_telugu}`;
        feedback.replaceChildren(title, detail);
        answerFooter.className = "wrong";
        checkButton.textContent = questionIndex + 1 === activeQuestions().length ? "Finish lesson" : "Continue";
        checkButton.dataset.mode = "continue";
        checkButton.disabled = false;
      }
    } catch (error) {
      showToast(error.message);
      checkButton.disabled = false;
    }
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
