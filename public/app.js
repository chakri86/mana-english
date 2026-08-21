(() => {
  "use strict";

  const screens = {
    student: document.getElementById("student-screen"),
    teacher: document.getElementById("teacher-screen"),
    lesson: document.getElementById("lesson-screen")
  };
  const roleButtons = [...document.querySelectorAll(".role-switch button")];
  const answerButtons = [...document.querySelectorAll(".answers button")];
  const checkButton = document.getElementById("check-answer");
  const answerFooter = document.getElementById("answer-footer");
  const feedback = document.getElementById("feedback");
  const toast = document.getElementById("toast");
  let selectedAnswer = null;
  let toastTimer;

  function showScreen(name) {
    Object.entries(screens).forEach(([key, element]) => element.classList.toggle("active", key === name));
    roleButtons.forEach((button) => button.classList.toggle("active", button.dataset.screen === name || (name === "lesson" && button.dataset.screen === "student")));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function showToast(message) {
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("show"), 2600);
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

  document.querySelectorAll("[data-screen]").forEach((button) => {
    button.addEventListener("click", () => showScreen(button.dataset.screen));
  });

  document.querySelectorAll(".open-lesson").forEach((button) => {
    button.addEventListener("click", () => {
      resetExercise();
      showScreen("lesson");
    });
  });

  document.getElementById("close-lesson").addEventListener("click", () => showScreen("student"));

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

  checkButton.addEventListener("click", () => {
    if (checkButton.dataset.mode === "continue") {
      showToast("+10 XP added. Great work!");
      resetExercise();
      showScreen("student");
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
    detail.textContent = correct ? "+10 XP earned" : "Listen once more and choose the natural sentence.";
    feedback.replaceChildren(title, detail);
    checkButton.textContent = correct ? "Continue" : "Try again";
    checkButton.dataset.mode = correct ? "continue" : "retry";
  });

  document.querySelectorAll(".sound-button").forEach((button) => {
    button.addEventListener("click", () => {
      const wordCard = button.closest(".word");
      speak(wordCard ? "confident" : "My name is Ananya.");
    });
  });

  document.querySelectorAll("button").forEach((button) => {
    const isWired = button.matches("[data-screen],.open-lesson,.sound-button,#close-lesson,#check-answer,.answers button");
    if (!isWired) {
      button.addEventListener("click", () => showToast("This feature will be connected in the next build."));
    }
  });
})();
