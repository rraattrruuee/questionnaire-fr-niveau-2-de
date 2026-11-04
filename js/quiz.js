(function () {
  "use strict";

  /* ---------------------------------------------------------
     State
     --------------------------------------------------------- */
  var currentQuiz = null;
  var categories = [];        // [{ name, questions: [normQ] }]
  var currentCategoryIndex = 0;
  var questionsShuffled = [];
  var currentQuestionIndex = 0;
  var score = 0;
  var answeredCount = 0;
  var userSelection = null;   // { isCorrect } for mcq | string for text
  var quizInProgress = false;
  var subjectName = "";
  var notepadEnabled = false;
  var pendingAdvance = null;
  var advancing = false;

  var DISPLAY_SETTINGS_KEY = "quiz-display-settings";
  var DEFAULT_DISPLAY_SETTINGS = { correctDelay: 1100, wrongDelay: 3200 };

  /* ---------------------------------------------------------
     Gestion du Stockage & Reprise :
     • Progression non terminee : persiste dans localStorage
     • Detail des reponses de la partie : cache non-persistant sessionStorage
     • Nettoyage proactif de tout stockage excessif dans localStorage
     --------------------------------------------------------- */
  var ACTIVE_SESSION_PREFIX = "quiz-active-session-";
  var SESSION_PERFORMED_PREFIX = "quiz-session-performed-";

  // Nettoyage immediat des anciennes cles volumineuses dans localStorage
  (function cleanupExcessiveStorage() {
    try {
      var toRemove = [];
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && (k.startsWith("quiz-persistent-data-") || k.startsWith("quiz-performed-questions-"))) {
          toRemove.push(k);
        }
      }
      toRemove.forEach(function (k) { localStorage.removeItem(k); });
    } catch (e) {}
  })();

  function getActiveSessionKey(qId, catIdx) {
    return ACTIVE_SESSION_PREFIX + (qId || "embed") + "_" + (catIdx != null ? catIdx : 0);
  }

  function getSessionPerformedKey(qId, catIdx) {
    return SESSION_PERFORMED_PREFIX + (qId || "embed") + "_" + (catIdx != null ? catIdx : 0);
  }

  function showOfflineBadge() {
    var b = $("offline-badge");
    if (b) b.classList.remove("hidden");
  }

  /* Sauvegarde de la progression non terminée dans localStorage */
  function saveActiveSession() {
    var qId = getQuizId();
    if (!qId || window.__EMBED_QUIZ__) return;
    if (!questionsShuffled || questionsShuffled.length === 0) return;
    if (currentQuestionIndex >= questionsShuffled.length) {
      clearActiveSession();
      return;
    }
    var session = {
      quizId: qId,
      subjectName: subjectName,
      categoryIndex: currentCategoryIndex,
      categoryName: categories[currentCategoryIndex] ? categories[currentCategoryIndex].name : "",
      currentQuestionIndex: currentQuestionIndex,
      score: score,
      answeredCount: answeredCount,
      questionsShuffled: questionsShuffled,
      updatedAt: Date.now()
    };
    try {
      localStorage.setItem(getActiveSessionKey(qId, currentCategoryIndex), JSON.stringify(session));
    } catch (e) {
      console.warn("Erreur sauvegarde session active:", e);
    }
  }

  function loadActiveSession(qId, catIdx) {
    if (!qId) return null;
    try {
      var raw = localStorage.getItem(getActiveSessionKey(qId, catIdx));
      if (!raw) return null;
      var data = JSON.parse(raw);
      if (
        data &&
        Array.isArray(data.questionsShuffled) &&
        data.questionsShuffled.length > 0 &&
        typeof data.currentQuestionIndex === "number" &&
        data.currentQuestionIndex > 0 &&
        data.currentQuestionIndex < data.questionsShuffled.length
      ) {
        return data;
      }
    } catch (e) {}
    return null;
  }

  function clearActiveSession() {
    var qId = getQuizId();
    if (!qId) return;
    try {
      localStorage.removeItem(getActiveSessionKey(qId, currentCategoryIndex));
    } catch (e) {}
  }

  /* Enregistrement du détail des réponses dans un cache NON-PERSISTANT (sessionStorage) */
  function recordPerformedQuestion(q, userAnswerText, correctAnswerText, isCorrect) {
    var qId = getQuizId();
    if (!qId || window.__EMBED_QUIZ__) return;
    var item = {
      questionNumber: currentQuestionIndex + 1,
      totalQuestions: questionsShuffled.length,
      questionText: q.text,
      questionType: q.type,
      userAnswer: userAnswerText,
      correctAnswer: correctAnswerText,
      isCorrect: isCorrect,
      solution: q.solution || "",
      category: categories[currentCategoryIndex] ? categories[currentCategoryIndex].name : "",
      answeredAt: new Date().toISOString()
    };
    var key = getSessionPerformedKey(qId, currentCategoryIndex);
    try {
      var list = JSON.parse(sessionStorage.getItem(key) || "[]");
      var existing = list.findIndex(function (it) {
        return it.questionNumber === item.questionNumber;
      });
      if (existing >= 0) {
        list[existing] = item;
      } else {
        list.push(item);
      }
      sessionStorage.setItem(key, JSON.stringify(list));
    } catch (e) {
      console.warn("Erreur enregistrement sessionStorage:", e);
    }
  }

  function resetPerformedQuestions() {
    var qId = getQuizId();
    if (!qId) return;
    try {
      sessionStorage.removeItem(getSessionPerformedKey(qId, currentCategoryIndex));
    } catch (e) {}
  }

  function loadDisplaySettings() {
    try {
      var raw = JSON.parse(localStorage.getItem(DISPLAY_SETTINGS_KEY) || "null");
      if (!raw || typeof raw !== "object") return { ...DEFAULT_DISPLAY_SETTINGS };
      var correct = Number(raw.correctDelay);
      var wrong = Number(raw.wrongDelay);
      return {
        correctDelay:
          Number.isFinite(correct) && correct >= 0 && correct <= 15000
            ? correct
            : DEFAULT_DISPLAY_SETTINGS.correctDelay,
        wrongDelay:
          Number.isFinite(wrong) && wrong >= 0 && wrong <= 15000
            ? wrong
            : DEFAULT_DISPLAY_SETTINGS.wrongDelay
      };
    } catch (e) {
      return { ...DEFAULT_DISPLAY_SETTINGS };
    }
  }

  function cancelPendingAdvance() {
    if (pendingAdvance) {
      clearTimeout(pendingAdvance);
      pendingAdvance = null;
    }
  }

  var $ = function (id) { return document.getElementById(id); };

  /* ---------------------------------------------------------
     Data normalisation — supports:
       • Simple:  { q, answers:[...], correct:"..." [, solution] }
       • Rich:    { text, type:"mcq"|"text", options:[...],
                    correct:<index>, accepted:[...], solution, image }
       • Wrapped: { questions:[...] }  or  { categories:[{category,questions}] }
                    or an array of categories / questions
     --------------------------------------------------------- */
  function normalizeQuestions(list, categoryName) {
    if (!Array.isArray(list)) return [];
    return list.map(function (raw) {
      raw = raw || {};

      if (typeof raw.q === "string" && !raw.type) {
        var answers = Array.isArray(raw.answers) ? raw.answers.slice() : [];
        var idx = answers.indexOf(raw.correct);
        return {
          text: raw.q,
          type: "mcq",
          options: answers,
          correctIndex: idx,
          accepted: idx === -1 && raw.correct ? [String(raw.correct)] : [],
          solution: raw.solution || raw.explanation || "",
          image: raw.image || "",
          category: categoryName
        };
      }

      var type = raw.type === "text" ? "text" : "mcq";
      var options = Array.isArray(raw.options)
        ? raw.options.slice()
        : Array.isArray(raw.answers)
          ? raw.answers.slice()
          : [];
      var correctIndex = typeof raw.correct === "number" ? raw.correct : -1;
      var accepted = Array.isArray(raw.accepted)
        ? raw.accepted.map(String)
        : typeof raw.correct === "string"
          ? [raw.correct]
          : [];

      return {
        text: raw.text || raw.q || "",
        type: type,
        options: options,
        correctIndex: correctIndex,
        accepted: accepted,
        solution: raw.solution || raw.explanation || "",
        image: raw.image || "",
        category: categoryName
      };
    });
  }

  function normalizeQuiz(data, fallbackName) {
    var cats = [];

    if (data && Array.isArray(data.categories)) {
      data.categories.forEach(function (c) {
        cats.push({
          name: c.category || c.name || fallbackName,
          questions: normalizeQuestions(c.questions, c.category || c.name || fallbackName)
        });
      });
    } else if (
      Array.isArray(data) &&
      data.length > 0 &&
      data[0] &&
      (data[0].category || data[0].name) &&
      Array.isArray(data[0].questions)
    ) {
      data.forEach(function (c) {
        cats.push({
          name: c.category || c.name || fallbackName,
          questions: normalizeQuestions(c.questions, c.category || c.name || fallbackName)
        });
      });
    } else {
      var qs = Array.isArray(data) ? data : (data && data.questions) || [];
      cats.push({ name: fallbackName, questions: normalizeQuestions(qs, fallbackName) });
    }

    return cats.filter(function (c) { return c.questions.length > 0; });
  }

  /* ---------------------------------------------------------
     Helpers
     --------------------------------------------------------- */
  function shuffle(array) {
    for (var i = array.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = array[i];
      array[i] = array[j];
      array[j] = t;
    }
    return array;
  }

  function getQuizIdFromURL() {
    return new URLSearchParams(window.location.search).get("id");
  }

  function normalizeText(value) {
    return String(value == null ? "" : value)
      .toLowerCase()
      .replace(/\s+/g, "")
      .replace(/,/g, ".");
  }

  /* ---------------------------------------------------------
     Progression globale (localStorage)
     --------------------------------------------------------- */
  var PROGRESS_KEY = "quiz-progress";

  function loadProgress() {
    try { return JSON.parse(localStorage.getItem(PROGRESS_KEY) || "{}"); }
    catch (e) { return {}; }
  }

  function getQuizId() {
    if (window.__EMBED_QUIZ__) return null;
    return getQuizIdFromURL();
  }

  function saveProgress(quizId, catIdx, score, total) {
    if (!quizId) return;
    var all = loadProgress();
    if (!all[quizId]) all[quizId] = {};
    var pct = total ? Math.round((score / total) * 100) : 0;
    var prev = all[quizId][catIdx];
    if (!prev || pct > prev.pct) {
      all[quizId][catIdx] = { score: score, total: total, pct: pct };
      try { localStorage.setItem(PROGRESS_KEY, JSON.stringify(all)); } catch (e) {}
    }
  }

  function setBack(handler) {
    $("back-btn").onclick = handler;
  }

  function buildQuestionLocation(q) {
    var parts = [];
    if (subjectName) parts.push(subjectName);
    if (currentQuiz && currentQuiz.title) parts.push(currentQuiz.title);
    if (categories[currentCategoryIndex]) parts.push(categories[currentCategoryIndex].name);
    if (q && q.text) parts.push(q.text);
    return parts.join(" > ");
  }

  function showOnly(id) {
    if (id !== "quiz-area") cancelPendingAdvance();
    ["category-area", "quiz-area", "results", "resume-area", "offline-error-area"].forEach(function (x) {
      var el = $(x);
      if (el) el.classList.toggle("hidden", x !== id);
    });
  }

  function goToPortal() {
    if (window.__EMBED_QUIZ__) {
      startQuiz({
        title: window.__EMBED_QUIZ__.title || "Quiz",
        _data: window.__EMBED_QUIZ__
      });
      return;
    }
    window.location.href = "index.html";
  }

  /* ---------------------------------------------------------
     Ecran de choix de categorie
     --------------------------------------------------------- */
  function renderCategoryMenu() {
    showOnly("category-area");
    setBack(goToPortal);
    if (window.__analytics) window.__analytics.setPage("quiz-menu");

    $("category-title").innerHTML =
      'Quiz <span class="couleur-qui-change">' + currentQuiz.title + "</span>";

    var list = $("category-list");
    list.innerHTML = "";

    var quizId = getQuizId();
    var allProgress = loadProgress();
    var quizProgress = quizId && allProgress[quizId] ? allProgress[quizId] : {};

    categories.forEach(function (cat, idx) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "selector-item category-item";

      var prog = quizProgress[idx];
      var progHtml = "";
      if (prog) {
        progHtml =
          '<div class="category-progress">' +
            '<div class="category-progress-fill" style="width:' + prog.pct + '%"></div>' +
          "</div>" +
          '<span class="category-progress-text">' +
            prog.score + " / " + prog.total + " (" + prog.pct + "%)" +
          "</span>";
      }

      btn.innerHTML =
        '<span class="selector-title">' + cat.name + "</span>" +
        '<span class="selector-desc">' + cat.questions.length + " question" +
        (cat.questions.length > 1 ? "s" : "") + "</span>" +
        progHtml;
      btn.onclick = function () {
        if (window.__analytics) {
          window.__analytics.track("quiz_category_click", {
            quiz_id: getQuizIdFromURL(),
            quiz_title: currentQuiz ? currentQuiz.title : "",
            quiz_name: currentQuiz ? currentQuiz.title : "",
            category_index: idx,
            category_name: cat.name,
            questions_count: cat.questions.length
          });
        }
        startCategory(idx);
      };
      list.appendChild(btn);
    });
  }

  /* ---------------------------------------------------------
     Quiz flow
     --------------------------------------------------------- */
  function applyQuizCss(data) {
    var existing = document.getElementById("quiz-custom-css");
    if (existing) existing.remove();
    if (data && typeof data.css === "string" && data.css.trim()) {
      var style = document.createElement("style");
      style.id = "quiz-custom-css";
      style.textContent = data.css;
      document.head.appendChild(style);
    }
  }

  function startQuiz(quiz, subject) {
    currentQuiz = quiz;
    subjectName = subject || "";
    applyQuizCss(quiz._data);
    categories = normalizeQuiz(quiz._data, quiz.title || "Questions");

    if (window.__analytics) {
      window.__analytics.track("quiz_page_view", {
        quiz_id: getQuizIdFromURL(),
        quiz_title: quiz.title,
        categories_count: categories.length,
        total_questions: categories.reduce(function (sum, c) { return sum + c.questions.length; }, 0)
      });
    }

    if (categories.length === 0) {
      if (!window.__EMBED_QUIZ__) window.location.replace("index.html");
      return;
    }

    if (categories.length > 1) {
      renderCategoryMenu();
    } else {
      startCategory(0);
    }
  }

  function setupNotepad(idx) {
    var rawCats = (currentQuiz && currentQuiz._data && currentQuiz._data.categories) || [];
    var rawCat = rawCats[idx] || {};
    notepadEnabled = rawCat.notepad === true;
    var npContainer = $("notepad-container");
    if (npContainer) {
      npContainer.classList.toggle("hidden", !notepadEnabled);
      if (notepadEnabled) {
        var npTa = $("notepad-textarea");
        if (npTa) npTa.value = "";
        var npClear = $("notepad-clear");
        if (npClear) {
          npClear.onclick = function () {
            var ta = $("notepad-textarea");
            if (ta) ta.value = "";
          };
        }
      }
    }
  }

  function setupQuizUI() {
    $("quiz-title").innerHTML =
      'Quiz <span class="couleur-qui-change">' + currentQuiz.title + "</span>";
    $("cat-label").textContent = categories[currentCategoryIndex].name;

    setBack(function () {
      saveActiveSession();
      if (window.__analytics) {
        window.__analytics.track("quiz_menu_back", {
          quiz_id: getQuizIdFromURL(),
          quiz_title: currentQuiz ? currentQuiz.title : "",
          quiz_name: currentQuiz ? currentQuiz.title : "",
          category_name: categories[currentCategoryIndex].name,
          category_index: currentCategoryIndex,
          from: "quiz"
        });
        window.__analytics.setQuizState(null);
      }
      if (categories.length > 1) renderCategoryMenu();
      else goToPortal();
    });

    $("main-btn").onclick = checkAnswerAndProceed;
    $("restart-btn").onclick = function () {
      clearActiveSession();
      resetPerformedQuestions();
      if (window.__analytics) {
        window.__analytics.track("quiz_restart", {
          quiz_id: getQuizIdFromURL(),
          quiz_title: currentQuiz ? currentQuiz.title : "",
          quiz_name: currentQuiz ? currentQuiz.title : "",
          category_name: categories[currentCategoryIndex].name,
          category_index: currentCategoryIndex,
          previous_score: score,
          previous_answered: answeredCount,
          total_questions: questionsShuffled.length
        });
      }
      launchCategory(currentCategoryIndex);
    };
    $("back-btn-results").onclick = function () {
      if (window.__analytics) {
        window.__analytics.track("quiz_portal_back", {
          quiz_id: getQuizIdFromURL(),
          quiz_title: currentQuiz ? currentQuiz.title : "",
          quiz_name: currentQuiz ? currentQuiz.title : "",
          from: "results"
        });
        window.__analytics.setQuizState(null);
      }
      goToPortal();
    };

    var menuBtn = $("menu-btn");
    if (menuBtn) {
      menuBtn.classList.toggle("hidden", categories.length <= 1);
      menuBtn.onclick = function () {
        if (window.__analytics) {
          window.__analytics.track("quiz_menu_back", {
            quiz_id: getQuizIdFromURL(),
            quiz_title: currentQuiz ? currentQuiz.title : "",
            quiz_name: currentQuiz ? currentQuiz.title : "",
            category_name: categories[currentCategoryIndex].name,
            category_index: currentCategoryIndex,
            from: "quiz_menu_btn"
          });
          window.__analytics.setQuizState(null);
        }
        if (categories.length > 1) renderCategoryMenu();
        else goToPortal();
      };
    }
  }

  function startCategory(idx) {
    cancelPendingAdvance();
    currentCategoryIndex = idx;

    // Detection d'une session non terminee pour reprendre
    var saved = loadActiveSession(getQuizId(), idx);
    if (saved) {
      showResumePrompt(saved);
      return;
    }

    launchCategory(idx);
  }

  function showResumePrompt(saved) {
    showOnly("resume-area");
    setBack(function () {
      if (categories.length > 1) renderCategoryMenu();
      else goToPortal();
    });

    var desc = $("resume-description");
    if (desc) {
      desc.innerHTML =
        "Partie interrompue à la <strong>Question " +
        (saved.currentQuestionIndex + 1) +
        " sur " +
        saved.questionsShuffled.length +
        "</strong>.<br>" +
        "Score actuel : <strong>" +
        saved.score +
        " / " +
        saved.answeredCount +
        "</strong>.";
    }

    $("resume-continue-btn").onclick = function () {
      questionsShuffled = saved.questionsShuffled;
      currentQuestionIndex = saved.currentQuestionIndex;
      score = saved.score;
      answeredCount = saved.answeredCount;
      setupNotepad(currentCategoryIndex);
      setupQuizUI();
      showOnly("quiz-area");
      updateProgress();
      renderQuestion();
    };

    $("resume-restart-btn").onclick = function () {
      clearActiveSession();
      resetPerformedQuestions();
      launchCategory(currentCategoryIndex);
    };
  }

  function launchCategory(idx) {
    questionsShuffled = shuffle(categories[idx].questions.slice());
    currentQuestionIndex = 0;
    score = 0;
    answeredCount = 0;
    resetPerformedQuestions();
    setupNotepad(idx);
    setupQuizUI();

    if (window.__analytics) {
      window.__analytics.track("quiz_category_start", {
        quiz_id: getQuizIdFromURL(),
        quiz_title: currentQuiz ? currentQuiz.title : "",
        quiz_name: currentQuiz ? currentQuiz.title : "",
        category_index: idx,
        category_name: categories[idx].name,
        questions_count: questionsShuffled.length
      });
      window.__analytics.setQuizState({
        inProgress: true,
        quizId: getQuizIdFromURL(),
        quizTitle: currentQuiz ? currentQuiz.title : "",
        categoryName: categories[idx].name,
        categoryIndex: idx,
        questionIndex: 0,
        questionType: "",
        score: 0,
        answeredCount: 0,
        totalQuestions: questionsShuffled.length
      });
    }

    showOnly("quiz-area");
    updateProgress();
    renderQuestion();
  }

  function updateProgress() {
    var total = questionsShuffled.length;
    var pct = total ? Math.round((answeredCount / total) * 100) : 0;
    $("progress-fill").style.width = pct + "%";

    var counterEl = $("counter-label");
    if (counterEl) {
      counterEl.textContent =
        "Question " + Math.min(currentQuestionIndex + 1, total) + " / " + total;
      counterEl.classList.remove("pop");
      void counterEl.offsetWidth;
      counterEl.classList.add("pop");
    }
  }

  function renderQuestion() {
    if (currentQuestionIndex >= questionsShuffled.length) {
      showResults();
      return;
    }
    if (window.__analytics) window.__analytics.setPage("quiz-question");

    var q = questionsShuffled[currentQuestionIndex];
    var block = $("question-block");
    var card = $("current-question-card");

    var feedback = $("feedback-area");
    feedback.classList.add("hidden");
    feedback.classList.remove("feedback-correct", "feedback-incorrect");
    feedback.innerHTML = "";

    userSelection = null;
    quizInProgress = true;

    if (notepadEnabled) {
      var npTa = $("notepad-textarea");
      if (npTa) npTa.value = "";
    }

    var btn = $("main-btn");
    btn.textContent = "Valider la Réponse";
    btn.disabled = true;
    btn.onclick = checkAnswerAndProceed;

    var html = '<p class="question-text">' + q.text + "</p>";

    if (q.image) {
      html += '<div class="image-area"><img src="' + q.image + '" alt="Illustration" loading="lazy"></div>';
    }

    if (q.type === "text") {
      html +=
        '<div class="input-area"><input type="text" id="text-answer" class="text-answer" ' +
        'placeholder="Ta réponse..." autocomplete="off" spellcheck="false"></div>';
    } else {
      html += '<div id="options-container" class="options-container"></div>';
    }

    card.innerHTML = html;

    if (q.type === "text") {
      var input = $("text-answer");
      input.addEventListener("input", function () {
        btn.disabled = input.value.trim() === "";
      });
      input.addEventListener("keydown", function (e) {
        if (e.key === "Enter" && !btn.disabled) {
          e.preventDefault();
          checkAnswerAndProceed();
        }
      });
      setTimeout(function () { input.focus(); }, 120);
    } else {
      var optionsContainer = card.querySelector("#options-container");
      var opts = q.options.map(function (text, i) {
        return { text: text, isCorrect: i === q.correctIndex };
      });
      opts = shuffle(opts);
      opts.forEach(function (opt, i) {
        var button = document.createElement("button");
        button.type = "button";
        button.className = "answer-btn";
        button.style.setProperty("--i", i);
        button.innerHTML = opt.text;
        button.dataset.correct = opt.isCorrect ? "1" : "0";
        button.onclick = function () { selectAnswer(button); };
        optionsContainer.appendChild(button);
      });
    }

    // Declenchement fiable de l'animation d'entree scale
    block.classList.remove("anim-scale-out", "anim-scale-in", "is-correct", "is-wrong");
    void block.offsetWidth; // Forcer reflow
    block.classList.add("anim-scale-in");

    updateProgress();
    saveActiveSession();

    if (window.__analytics) {
      var qloc = buildQuestionLocation(q);
      window.__analytics.track("quiz_question_view", {
        quiz_id: getQuizIdFromURL(),
        quiz_title: currentQuiz ? currentQuiz.title : "",
        quiz_name: currentQuiz ? currentQuiz.title : "",
        subject_name: subjectName,
        category_name: categories[currentCategoryIndex].name,
        category_index: currentCategoryIndex,
        question_index: currentQuestionIndex,
        question_type: q.type,
        question_location: qloc,
        total_questions: questionsShuffled.length
      });
      window.__analytics.setQuizState({
        inProgress: true,
        quizId: getQuizIdFromURL(),
        quizTitle: currentQuiz ? currentQuiz.title : "",
        subjectName: subjectName,
        categoryName: categories[currentCategoryIndex].name,
        categoryIndex: currentCategoryIndex,
        questionIndex: currentQuestionIndex,
        questionType: q.type,
        questionLocation: qloc,
        score: score,
        answeredCount: answeredCount,
        totalQuestions: questionsShuffled.length
      });
    }
  }

  function selectAnswer(clickedButton) {
    if (!quizInProgress) return;
    var card = $("current-question-card");
    var optionsContainer = card ? card.querySelector("#options-container") : $("options-container");
    if (!optionsContainer) return;
    optionsContainer.querySelectorAll(".answer-btn").forEach(function (b) {
      b.classList.remove("selected");
    });
    clickedButton.classList.add("selected");
    userSelection = { isCorrect: clickedButton.dataset.correct === "1" };
    $("main-btn").disabled = false;
  }

  function checkAnswerAndProceed() {
    if (!quizInProgress) return;
    var q = questionsShuffled[currentQuestionIndex];
    var isCorrect = false;
    var correctAnswerHTML = "";
    var userAnswerText = "";

    if (q.type === "text") {
      var input = $("text-answer");
      if (!input || !input.value.trim()) return;
      userAnswerText = input.value.trim();
      var value = normalizeText(userAnswerText);
      isCorrect = q.accepted.some(function (a) {
        return normalizeText(a) === value;
      });
      if (!isCorrect && q.accepted.length) correctAnswerHTML = q.accepted[0];
      else if (isCorrect) correctAnswerHTML = userAnswerText;
      if (input) {
        input.classList.add(isCorrect ? "correct" : "incorrect");
        input.disabled = true;
      }
    } else {
      if (!userSelection) return;
      isCorrect = userSelection.isCorrect;
      var card = $("current-question-card");
      var optionsContainer = card ? card.querySelector("#options-container") : $("options-container");
      if (optionsContainer) {
        optionsContainer.querySelectorAll(".answer-btn").forEach(function (b) {
          var correct = b.dataset.correct === "1";
          var wasSelected = b.classList.contains("selected");
          if (wasSelected) {
            userAnswerText = b.innerHTML;
          }
          b.classList.remove("selected");
          if (correct) {
            b.classList.add("correct");
            if (!correctAnswerHTML) correctAnswerHTML = b.innerHTML;
          } else if (wasSelected) {
            b.classList.add("incorrect");
          }
        });
      }
    }

    quizInProgress = false;
    $("main-btn").disabled = true;
    answeredCount++;
    if (isCorrect) score++;
    updateProgress();

    // Enregistrer le detail dans le cache NON PERSISTANT (sessionStorage)
    recordPerformedQuestion(q, userAnswerText, correctAnswerHTML, isCorrect);
    // Sauvegarder la session active dans localStorage
    saveActiveSession();

    if (window.__analytics) {
      var qloc2 = buildQuestionLocation(q);
      window.__analytics.track("quiz_question_answer", {
        quiz_id: getQuizIdFromURL(),
        quiz_title: currentQuiz ? currentQuiz.title : "",
        quiz_name: currentQuiz ? currentQuiz.title : "",
        subject_name: subjectName,
        category_name: categories[currentCategoryIndex].name,
        category_index: currentCategoryIndex,
        question_index: currentQuestionIndex,
        question_type: q.type,
        question_location: qloc2,
        is_correct: isCorrect,
        score: score,
        answered_count: answeredCount,
        total_questions: questionsShuffled.length
      });
      window.__analytics.setQuizState({
        inProgress: true,
        quizId: getQuizIdFromURL(),
        quizTitle: currentQuiz ? currentQuiz.title : "",
        subjectName: subjectName,
        categoryName: categories[currentCategoryIndex].name,
        categoryIndex: currentCategoryIndex,
        questionIndex: currentQuestionIndex,
        questionType: q.type,
        questionLocation: qloc2,
        score: score,
        answeredCount: answeredCount,
        totalQuestions: questionsShuffled.length
      });
    }

    var feedback = $("feedback-area");
    var block = $("question-block");
    feedback.classList.remove("hidden");

    var solutionHTML = q.solution
      ? '<div class="solution">' + q.solution + "</div>"
      : "";

    if (isCorrect) {
      feedback.innerHTML = '<div class="feedback-title">✅ Bravo !</div>' + solutionHTML;
      feedback.classList.add("feedback-correct");
      block.classList.add("is-correct");
    } else {
      var correction = q.type === "text" && correctAnswerHTML
        ? "Réponse attendue : " + correctAnswerHTML
        : q.type === "mcq" && correctAnswerHTML
          ? "Bonne réponse : " + correctAnswerHTML
          : "";
      feedback.innerHTML =
        '<div class="feedback-title">❌ Faux.</div>' +
        (correction ? '<div class="feedback-answer">' + correction + "</div>" : "") +
        solutionHTML;
      feedback.classList.add("feedback-incorrect");
      block.classList.add("is-wrong");
    }

    var settings = loadDisplaySettings();
    var readingDelay = isCorrect ? settings.correctDelay : settings.wrongDelay;
    var nextBtn = $("main-btn");
    nextBtn.textContent = "Question Suivante";
    nextBtn.disabled = false;
    nextBtn.onclick = function () {
      cancelPendingAdvance();
      exitAndAdvance();
    };

    if (readingDelay > 0) {
      pendingAdvance = setTimeout(function () {
        pendingAdvance = null;
        exitAndAdvance();
      }, readingDelay);
    }
  }

  /* Animation fluide et fiable de passage a la question suivante (< 1.5s) */
  function exitAndAdvance() {
    if (advancing) return;
    advancing = true;
    cancelPendingAdvance();

    var nextBtn = $("main-btn");
    if (nextBtn) nextBtn.disabled = true;

    var block = $("question-block");
    block.classList.remove("anim-scale-in", "is-correct", "is-wrong");
    void block.offsetWidth;
    block.classList.add("anim-scale-out");

    setTimeout(function () {
      block.classList.remove("anim-scale-out");
      currentQuestionIndex++;
      saveActiveSession();
      advancing = false;

      if (currentQuestionIndex >= questionsShuffled.length) {
        showResults();
      } else {
        renderQuestion();
        var qArea = $("quiz-area");
        if (qArea && typeof qArea.scrollIntoView === "function") {
          qArea.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }
      }
    }, 200);
  }

  function renderPerformedQuestionsSummary() {
    var summaryBox = $("performed-summary-box");
    var listEl = $("performed-list");
    var toggleBtn = $("toggle-performed-btn");
    if (!summaryBox || !listEl || !toggleBtn) return;

    var qId = getQuizId();
    var performedList = [];
    try {
      performedList = JSON.parse(
        sessionStorage.getItem(getSessionPerformedKey(qId, currentCategoryIndex)) || "[]"
      );
    } catch (e) {}

    if (!Array.isArray(performedList) || performedList.length === 0) {
      summaryBox.classList.add("hidden");
      return;
    }

    summaryBox.classList.remove("hidden");
    listEl.innerHTML = "";

    performedList.forEach(function (item) {
      var card = document.createElement("div");
      card.className = "performed-card " + (item.isCorrect ? "correct" : "incorrect");
      var statusBadge = item.isCorrect ? "✅ Correct" : "❌ Faux";
      var userAns = item.userAnswer ? item.userAnswer : "(Aucune réponse)";
      var expectedAns = item.correctAnswer ? item.correctAnswer : "";

      var html =
        '<div class="performed-card-header">' +
          '<span>Question ' + item.questionNumber + '</span>' +
          '<span class="badge-status">' + statusBadge + '</span>' +
        '</div>' +
        '<div class="performed-q-text">' + item.questionText + '</div>' +
        '<div class="performed-user-answer"><strong>Votre réponse :</strong> ' + userAns + '</div>';

      if (!item.isCorrect && expectedAns) {
        html += '<div class="performed-expected-answer"><strong>Bonne réponse :</strong> ' + expectedAns + '</div>';
      }
      if (item.solution) {
        html += '<div class="solution">' + item.solution + '</div>';
      }

      card.innerHTML = html;
      listEl.appendChild(card);
    });

    toggleBtn.onclick = function () {
      var isHidden = listEl.classList.toggle("hidden");
      toggleBtn.textContent = isHidden
        ? "📋 Voir les questions de cette partie"
        : "▲ Masquer les questions de cette partie";
    };
  }

  function showResults() {
    showOnly("results");
    setBack(goToPortal);
    if (window.__analytics) window.__analytics.setPage("quiz-results");

    var total = questionsShuffled.length;
    var percentage = total ? Math.round((score / total) * 100) : 0;

    // La session active est terminee, on la supprime de localStorage
    clearActiveSession();

    if (window.__analytics) {
      window.__analytics.track("quiz_complete", {
        quiz_id: getQuizIdFromURL(),
        quiz_title: currentQuiz ? currentQuiz.title : "",
        quiz_name: currentQuiz ? currentQuiz.title : "",
        category_name: categories[currentCategoryIndex].name,
        category_index: currentCategoryIndex,
        score: score,
        total: total,
        percentage: percentage,
        questions_count: questionsShuffled.length
      });
      window.__analytics.setQuizState(null);
    }

    var quizId = getQuizId();
    if (quizId && categories.length > 1) {
      saveProgress(quizId, currentCategoryIndex, score, total);
    }

    var menuBtn = $("menu-btn");
    if (menuBtn) {
      menuBtn.classList.toggle("hidden", categories.length <= 1);
      menuBtn.onclick = function () {
        if (window.__analytics) {
          window.__analytics.track("quiz_menu_back", {
            quiz_id: getQuizIdFromURL(),
            quiz_title: currentQuiz ? currentQuiz.title : "",
            quiz_name: currentQuiz ? currentQuiz.title : "",
            category_name: categories[currentCategoryIndex].name,
            category_index: currentCategoryIndex,
            from: "results_menu_btn"
          });
          window.__analytics.setQuizState(null);
        }
        if (categories.length > 1) renderCategoryMenu();
        else goToPortal();
      };
    }

    $("score-display").textContent =
      "Votre score : " + score + " / " + total + " (" + percentage + "%)";

    var resultsDiv = $("results");
    resultsDiv.classList.remove("high-score-glow");

    var msg;
    if (percentage === 100) {
      msg = "Félicitations ! Maîtrise parfaite.";
      resultsDiv.classList.add("high-score-glow");
    } else if (percentage >= 80) {
      msg = "Excellent travail ! Très bonne compréhension des notions.";
      resultsDiv.classList.add("high-score-glow");
    } else if (percentage >= 60) {
      msg = "Bon effort ! Revoyez les thèmes où vous avez eu le plus d'erreurs.";
    } else {
      msg = "N'abandonnez pas. Reprenez les sections difficiles pour consolider les bases.";
    }
    $("feedback-message").textContent = msg;

    // Detail des questions effectuees issu de sessionStorage
    renderPerformedQuestionsSummary();

    resultsDiv.classList.remove("entering");
    void resultsDiv.offsetWidth;
    resultsDiv.classList.add("entering");
    setTimeout(function () {
      resultsDiv.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 100);
  }

  /* ---------------------------------------------------------
     Init & Offline Fallback (via Service Worker / Network)
     --------------------------------------------------------- */
  window.QUIZ_CORE = {
    normalizeQuiz: normalizeQuiz,
    normalizeQuestions: normalizeQuestions,
    normalizeText: normalizeText,
    shuffle: shuffle
  };

  if (window.__QUIZ_NO_AUTOINIT__) return;

  function showOfflineError() {
    showOnly("offline-error-area");
    setBack(goToPortal);
    var backBtn = $("offline-back-btn");
    if (backBtn) backBtn.onclick = goToPortal;
  }

  function init() {
    window.addEventListener("beforeunload", saveActiveSession);
    window.addEventListener("pagehide", saveActiveSession);

    if (window.__EMBED_QUIZ__) {
      startQuiz({
        title: window.__EMBED_QUIZ__.title || "Quiz",
        _data: window.__EMBED_QUIZ__
      });
      return;
    }

    var quizId = getQuizIdFromURL();
    if (!quizId) {
      window.location.replace("index.html");
      return;
    }

    function processConfig(config) {
      var quiz = (config.quizzes || []).find(function (q) {
        return q.id === quizId;
      });

      if (!quiz) {
        window.location.replace("index.html");
        return;
      }

      var subjectObj = (config.subjects || []).find(function (s) {
        return s.id === quiz.subject;
      });

      fetch(quiz.file)
        .then(function (res) {
          if (!res.ok) throw new Error("HTTP " + res.status);
          return res.json();
        })
        .then(function (data) {
          quiz._data = data;
          startQuiz(quiz, subjectObj ? subjectObj.name : "");
        })
        .catch(function (err) {
          console.warn("Échec chargement quiz:", err);
          showOfflineError();
        });
    }

    fetch("data/config.json")
      .then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      })
      .then(function (config) {
        processConfig(config);
      })
      .catch(function (err) {
        console.warn("Échec chargement config:", err);
        showOfflineError();
      });
  }

  init();
})();
