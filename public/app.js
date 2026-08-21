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
  let assignmentRecords = [];
  let teacherData = null;
  let speakPhrases = [];
  let speakIndex = 0;
  let mediaRecorder = null;
  let mediaStream = null;
  let recordingChunks = [];
  let practiceQuestions = [];
  let practiceCurrent = null;
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

  function renderStudentSecondary(user, progress, assignments) {
    const records = new Map(progress.map((item) => [item.lesson_id, item]));
    const completed = completedLessonCount(progress);
    const testRecord = records.get(moduleData.weekend_test.id);
    const lessonScores = progress.filter((item) => item.lesson_id.includes("-lesson") && item.score > 0);
    const accuracy = lessonScores.length ? Math.round(lessonScores.reduce((sum, item) => sum + item.score, 0) / lessonScores.length) : 0;

    speakPhrases = moduleData.lessons.flatMap((lesson) => lesson.key_phrases);
    speakIndex = Math.min(speakIndex, Math.max(speakPhrases.length - 1, 0));
    renderSpeakPhrase();
    document.getElementById("progress-lessons").textContent = completed;
    document.getElementById("progress-spoken").textContent = spokenCount();

    practiceQuestions = moduleData.lessons
      .filter((lesson, index) => records.has(lesson.id) || index === 0)
      .flatMap((lesson) => lesson.questions);
    practiceCurrent = null;
    document.getElementById("practice-question").textContent = "Choose Start practice to begin.";
    document.getElementById("practice-telugu").textContent = "";
    document.getElementById("practice-answers").replaceChildren();
    document.getElementById("practice-feedback").textContent = "";
    document.getElementById("practice-button").textContent = "Start practice";

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
      return simpleRow(lesson.title, lesson.day, record ? `+${record.xp} XP` : "0 XP", record ? "Completed" : "Not started", false);
    }));
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
    testAnswers = {};
    renderQuestion();
    showScreen("lesson");
  }

  function openNextLesson() {
    const completed = completedLessonCount(progressRecords);
    const lesson = moduleData && moduleData.lessons[Math.min(completed, moduleData.lessons.length - 1)];
    if (lesson) openLessonById(lesson.id);
  }

  function renderStudent(user, progress, assignments = []) {
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
    document.getElementById("header-lessons").textContent = `${completed} lesson${completed === 1 ? "" : "s"}`;

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
    renderStudentSecondary(user, progress, assignments);
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
      ? needsHelp.map((student) => simpleRow(student.name, `${student.lessons_completed}/5 lessons`, student.test_score ? `${student.test_score}% test` : "Test pending", "Needs help", true))
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
    const [user, progress, week, assignments] = await Promise.all([
      api("/api/auth/me"), api("/api/progress"), api("/api/modules/3/weeks/1"), api("/api/assignments")
    ]);
    setUser(user);
    moduleData = week;
    assignmentRecords = assignments;
    renderStudent(user, progress, assignments);
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
    document.getElementById("practice-question").textContent = practiceCurrent.prompt;
    document.getElementById("practice-telugu").textContent = practiceCurrent.prompt_telugu;
    document.getElementById("practice-feedback").textContent = "";
    document.getElementById("practice-button").textContent = "Next question";
    const buttons = practiceCurrent.choices.map((choice, index) => {
      const button = document.createElement("button");
      button.append(Object.assign(document.createElement("span"), { textContent: index + 1 }), document.createTextNode(choice));
      button.addEventListener("click", () => checkPracticeAnswer(index, button));
      return button;
    });
    document.getElementById("practice-answers").replaceChildren(...buttons);
  }

  async function checkPracticeAnswer(index, selectedButton) {
    const buttons = [...document.getElementById("practice-answers").children];
    buttons.forEach((button) => { button.disabled = true; });
    selectedButton.classList.add("selected");
    try {
      const result = await api("/api/modules/3/weeks/1/check", {
        method: "POST",
        body: JSON.stringify({ question_id: practiceCurrent.id, selected_index: index })
      });
      const target = document.getElementById("practice-feedback");
      target.textContent = result.correct ? `✓ ${result.feedback} ${result.feedback_telugu}` : `Try again next time. ${result.feedback_telugu}`;
      target.className = `inline-feedback ${result.correct ? "success" : "warning"}`;
    } catch (error) {
      showToast(error.message);
      buttons.forEach((button) => { button.disabled = false; });
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
    renderStudent(currentUser, [], []);
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
  document.getElementById("close-lesson").addEventListener("click", showHome);
  document.getElementById("exercise-audio").addEventListener("click", () => speak(activeQuestions()[questionIndex].audio));
  document.querySelectorAll(".word .sound-button").forEach((button) => button.addEventListener("click", () => speak("confident")));
  document.getElementById("speak-listen").addEventListener("click", () => speak(speakPhrases[speakIndex].english));
  document.getElementById("speak-record").addEventListener("click", toggleRecording);
  document.getElementById("speak-next").addEventListener("click", nextSpeakPhrase);
  document.getElementById("practice-button").addEventListener("click", renderPracticeQuestion);
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
