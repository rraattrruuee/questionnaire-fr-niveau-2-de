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

      // --- Simple format ---
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

      // --- Rich format ---
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

  function setBack(handler) {
    $("back-btn").onclick = handler;
  }

  function showOnly(id) {
    ["category-area", "quiz-area", "results"].forEach(function (x) {
      $(x).classList.toggle("hidden", x !== id);
    });
  }

  function goToPortal() {
    // En mode integre (apercu QuizMaster / export autonome), on relance le quiz
    // au lieu de renvoyer vers le portail.
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
     Ecran de choix de categorie (uniquement si plusieurs)
     --------------------------------------------------------- */
  function renderCategoryMenu() {
    showOnly("category-area");
    setBack(goToPortal);

    $("category-title").innerHTML =
      'Quiz <span class="couleur-qui-change">' + currentQuiz.title + "</span>";

    var list = $("category-list");
    list.innerHTML = "";

    categories.forEach(function (cat, idx) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "selector-item category-item";
      btn.innerHTML =
        '<span class="selector-title">' + cat.name + "</span>" +
        '<span class="selector-desc">' + cat.questions.length + " question" +
        (cat.questions.length > 1 ? "s" : "") + "</span>";
      btn.onclick = function () { startCategory(idx); };
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

  function startQuiz(quiz) {
    currentQuiz = quiz;
    applyQuizCss(quiz._data);
    categories = normalizeQuiz(quiz._data, quiz.title || "Questions");

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

  function startCategory(idx) {
    currentCategoryIndex = idx;
    questionsShuffled = shuffle(categories[idx].questions.slice());
    currentQuestionIndex = 0;
    score = 0;
    answeredCount = 0;

    showOnly("quiz-area");

    $("quiz-title").innerHTML =
      'Quiz <span class="couleur-qui-change">' + currentQuiz.title + "</span>";
    $("cat-label").textContent = categories[idx].name;

    setBack(function () {
      if (categories.length > 1) renderCategoryMenu();
      else goToPortal();
    });

    $("main-btn").onclick = checkAnswerAndProceed;
    $("restart-btn").onclick = function () { startCategory(currentCategoryIndex); };
    $("back-btn-results").onclick = goToPortal;

    updateProgress();
    renderQuestion();
  }

  function updateProgress() {
    var total = questionsShuffled.length;
    var pct = total ? Math.round((answeredCount / total) * 100) : 0;
    $("progress-fill").style.width = pct + "%";
    $("counter-label").textContent =
      "Question " + Math.min(currentQuestionIndex + 1, total) + " / " + total;
  }

  function renderQuestion() {
    if (currentQuestionIndex >= questionsShuffled.length) {
      showResults();
      return;
    }

    var q = questionsShuffled[currentQuestionIndex];
    var block = $("question-block");
    var card = $("current-question-card");

    block.classList.remove("exit", "is-correct", "is-wrong", "enter");
    void block.offsetWidth;
    block.classList.add("enter");

    var feedback = $("feedback-area");
    feedback.classList.add("hidden");
    feedback.classList.remove("feedback-correct", "feedback-incorrect");
    feedback.innerHTML = "";

    userSelection = null;
    quizInProgress = true;

    var btn = $("main-btn");
    btn.textContent = "Valider la Réponse";
    btn.disabled = true;

    // Question text (HTML allowed, e.g. <sup>, math fractions)
    var html = '<p class="question-text">' + q.text + "</p>";

    // Optional image
    if (q.image) {
      html += '<div class="image-area"><img src="' + q.image + '" alt="Illustration" loading="lazy"></div>';
    }

    // Answer area
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
      setTimeout(function () { input.focus(); }, 150);
    } else {
      var optionsContainer = card.querySelector("#options-container");
      var opts = q.options.map(function (text, i) {
        return { text: text, isCorrect: i === q.correctIndex };
      });
      opts = shuffle(opts);
      opts.forEach(function (opt) {
        var button = document.createElement("button");
        button.type = "button";
        button.className = "answer-btn";
        button.innerHTML = opt.text;
        button.dataset.correct = opt.isCorrect ? "1" : "0";
        button.onclick = function () { selectAnswer(button); };
        optionsContainer.appendChild(button);
      });
    }

    updateProgress();
    setTimeout(function () { block.classList.remove("enter"); }, 500);
  }

  function selectAnswer(clickedButton) {
    if (!quizInProgress) return;
    var optionsContainer = $("options-container");
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

    if (q.type === "text") {
      var input = $("text-answer");
      if (!input || !input.value.trim()) return;
      var value = normalizeText(input.value);
      isCorrect = q.accepted.some(function (a) {
        return normalizeText(a) === value;
      });
      if (!isCorrect && q.accepted.length) correctAnswerHTML = q.accepted[0];
      if (input) {
        input.classList.add(isCorrect ? "correct" : "incorrect");
        input.disabled = true;
      }
    } else {
      if (!userSelection) return;
      isCorrect = userSelection.isCorrect;
      var optionsContainer = $("options-container");
      optionsContainer.querySelectorAll(".answer-btn").forEach(function (b) {
        var correct = b.dataset.correct === "1";
        var wasSelected = b.classList.contains("selected");
        b.classList.remove("selected");
        if (correct) {
          b.classList.add("correct");
          if (!correctAnswerHTML) correctAnswerHTML = b.innerHTML;
        } else if (wasSelected) {
          b.classList.add("incorrect");
        }
      });
    }

    quizInProgress = false;
    $("main-btn").disabled = true;
    answeredCount++;
    if (isCorrect) score++;
    updateProgress();

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

    $("main-btn").textContent = "Question Suivante";

    // On laisse le temps de lire, puis on fait sortir le bloc ENTIER
    // (question + feedback) avant d'afficher la question suivante.
    var readingDelay = isCorrect ? 1100 : 3200;
    setTimeout(exitAndAdvance, readingDelay);
  }

  function exitAndAdvance() {
    var block = $("question-block");
    var advanced = false;

    function go() {
      if (advanced) return;
      advanced = true;
      block.removeEventListener("transitionend", go);
      currentQuestionIndex++;
      if (currentQuestionIndex >= questionsShuffled.length) {
        showResults();
      } else {
        renderQuestion();
      }
    }

    block.addEventListener("transitionend", go);
    block.classList.add("exit");
    setTimeout(go, 700); // securite si transitionend ne se declenche pas
  }

  function showResults() {
    showOnly("results");
    setBack(goToPortal);

    var total = questionsShuffled.length;
    var percentage = total ? Math.round((score / total) * 100) : 0;

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

    resultsDiv.classList.remove("entering");
    void resultsDiv.offsetWidth;
    resultsDiv.classList.add("entering");
    setTimeout(function () {
      resultsDiv.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 100);
  }

  /* ---------------------------------------------------------
     Init
     --------------------------------------------------------- */
  function init() {
    // Mode integre (apercu QuizMaster / export autonome) : les donnees sont
    // fournies dans window.__EMBED_QUIZ__, sans config.json ni parametre ?id.
    if (window.__EMBED_QUIZ__) {
      startQuiz({
        title: window.__EMBED_QUIZ__.title || "Quiz",
        _data: window.__EMBED_QUIZ__
      });
      return;
    }

    var quizId = getQuizIdFromURL();

    // Acces direct : sans identifiant de quiz, on renvoie au portail
    if (!quizId) {
      window.location.replace("index.html");
      return;
    }

    fetch("data/config.json")
      .then(function (res) { return res.json(); })
      .then(function (config) {
        var quiz = (config.quizzes || []).find(function (q) {
          return q.id === quizId;
        });

        if (!quiz) {
          window.location.replace("index.html");
          return;
        }

        return fetch(quiz.file)
          .then(function (res) { return res.json(); })
          .then(function (data) {
            quiz._data = data;
            startQuiz(quiz);
          });
      })
      .catch(function (err) {
        console.error("Erreur chargement du questionnaire:", err);
        window.location.replace("index.html");
      });
  }

  init();
})();
