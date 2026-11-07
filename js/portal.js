(function () {
  const searchInput = document.getElementById("searchInput");
  const sectionsContainer = document.getElementById("sections-container");
  const cachingIndicator = document.getElementById("caching-indicator");
  let allConfig = null;

  const NEW_BADGE_DAYS = 30;
  const RECENT_COUNT = 4;

  function updateURLParameter(key, value, replace) {
    const url = new URL(window.location);
    if (value === "all") {
      url.searchParams.delete(key);
    } else {
      url.searchParams.set(key, value);
    }
    const state = { path: url.href };
    if (replace) {
      window.history.replaceState(state, "", url.href);
    } else {
      window.history.pushState(state, "", url.href);
    }
  }

  // Comparaison insensible a la casse ET aux accents.
  function normalizeSearch(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim();
  }

  let noResultsEl = null;
  function ensureNoResults() {
    if (noResultsEl) return noResultsEl;
    noResultsEl = document.createElement("p");
    noResultsEl.id = "no-results";
    noResultsEl.className = "hidden";
    noResultsEl.style.cssText =
      "text-align:center;color:var(--couleur-gris);font-style:italic;margin:2rem 1rem;";
    noResultsEl.textContent = "Aucun questionnaire ne correspond à cette recherche.";
    sectionsContainer.appendChild(noResultsEl);
    return noResultsEl;
  }

  function filterElements(searchTerm, filterTarget) {
    const term = normalizeSearch(searchTerm);
    const sections = document.querySelectorAll(".menu-section");
    let anyVisible = false;

    sections.forEach((section) => {
      const sectionId = section.id;
      let sectionHasVisible = false;
      section.classList.remove("is-animated");
      const isTargeted = filterTarget === "all" || sectionId === filterTarget;
      const titleEl = section.querySelector(".menu-title");
      const sectionMatches =
        term !== "" &&
        !!titleEl &&
        normalizeSearch(titleEl.textContent).includes(term);
      const links = section.querySelectorAll(".bouton-lien");

      links.forEach((link) => {
        // On cible le libelle, pas tout le lien : sinon le badge "Nouveau"
        // rend tous les quiz trouvables en tapant "nouveau".
        const labelEl = link.querySelector(".bouton-lien-label");
        const text = normalizeSearch(labelEl ? labelEl.textContent : link.textContent);
        const matches = term === "" || sectionMatches || text.includes(term);
        const wrapper = link.closest(".quiz-wrapper") || link;
        if (isTargeted && matches) {
          wrapper.classList.remove("hidden");
          sectionHasVisible = true;
        } else {
          wrapper.classList.add("hidden");
        }
      });

      // Un sujet sans quiz reste visible quand on le selectionne
      // explicitement (sinon l'ecran devient entierement vide).
      const emptySelection = isTargeted && term === "" && links.length === 0;
      if (isTargeted && (sectionHasVisible || emptySelection)) {
        section.classList.remove("hidden");
        anyVisible = true;
        setTimeout(() => section.classList.add("is-animated"), 0);
      } else {
        section.classList.add("hidden");
      }
    });

    const noResults = ensureNoResults();
    noResults.classList.toggle("hidden", !(term !== "" && !anyVisible));
  }

  function isRunningAsPWA() {
    return (
      window.matchMedia("(display-mode: standalone)").matches ||
      window.matchMedia("(display-mode: fullscreen)").matches ||
      window.navigator.standalone === true ||
      (document.referrer && document.referrer.startsWith("android-app://"))
    );
  }

  /* ---------------------------------------------------------
     "Nouveautes" : tri automatique des quiz par date d'ajout.
     - Si un quiz a un champ "added" (AAAA-MM-JJ), il est daté.
     - Sinon, l'ordre dans config.json fait foi (le dernier = le
       plus récent), donc il suffit d'ajouter les nouveaux quiz à
       la fin du tableau "quizzes".
     --------------------------------------------------------- */
  function addedTime(quiz) {
    if (!quiz || !quiz.added) return NaN;
    const t = Date.parse(quiz.added);
    return isNaN(t) ? NaN : t;
  }

  function sortByRecency(quizzes) {
    return quizzes
      .map((quiz, index) => ({ quiz, index }))
      .sort((a, b) => {
        const ta = addedTime(a.quiz);
        const tb = addedTime(b.quiz);
        if (!isNaN(ta) && !isNaN(tb)) return tb - ta;
        if (!isNaN(ta)) return -1;
        if (!isNaN(tb)) return 1;
        return b.index - a.index;
      })
      .map((entry) => entry.quiz);
  }

  function isNew(quiz) {
    const t = addedTime(quiz);
    if (isNaN(t)) return false;
    return Date.now() - t <= NEW_BADGE_DAYS * 24 * 60 * 60 * 1000;
  }

  function buildQuizRow(quiz, subject, forceBadge) {
    const wrapper = document.createElement("div");
    wrapper.className = "quiz-wrapper";

    const link = document.createElement("a");
    link.href = "quiz.html?id=" + encodeURIComponent(quiz.id);
    link.className = "bouton-lien";

    link.addEventListener("click", function () {
      if (window.__analytics) {
        window.__analytics.track("portal_quiz_click", {
          quiz_id: quiz.id,
          quiz_title: quiz.title,
            quiz_name: quiz.title,
          subject_id: quiz.subject,
          subject_name: subject ? subject.name : "",
          questions_count: quiz.questionsCount || 0
        });
      }
    });

    const label = document.createElement("span");
    label.className = "bouton-lien-label";
    label.textContent = (subject ? subject.icon + " " : "") + quiz.title;
    link.appendChild(label);

    if (forceBadge || isNew(quiz)) {
      const badge = document.createElement("span");
      badge.className = "badge-new";
      badge.textContent = "Nouveau";
      link.appendChild(badge);
    }

    wrapper.appendChild(link);

    if (quiz.file && !isRunningAsPWA()) {
      const dlBtn = document.createElement("a");
      dlBtn.href = "#";
      dlBtn.className = "btn-dl";
      dlBtn.innerHTML = "📥";
      dlBtn.title = "Télécharger le quiz complet (.html)";
      dlBtn.onclick = function (e) {
        e.preventDefault();
        if (window.__analytics) {
          window.__analytics.track("portal_quiz_download", {
            quiz_id: quiz.id,
            quiz_title: quiz.title,
            quiz_name: quiz.title,
            subject_id: quiz.subject
          });
        }
        downloadStandalone(quiz, dlBtn);
      };
      wrapper.appendChild(dlBtn);
    }

    return wrapper;
  }

  function buildRecentSection(quizzes, subjectById) {
    if (!quizzes || quizzes.length === 0) return null;

    const recent = sortByRecency(quizzes).slice(0, RECENT_COUNT);

    const section = document.createElement("section");
    section.className = "menu-section recent-section";
    section.id = "nouveautes";

    const title = document.createElement("h2");
    title.className = "menu-title";
    title.innerHTML = '<img src="assets/papicons/sparkles.svg" class="papicon" alt="" /> Nouveautés';
    section.appendChild(title);

    recent.forEach((quiz) => {
      section.appendChild(buildQuizRow(quiz, subjectById[quiz.subject], true));
    });

    return section;
  }

  function buildLinkSection(id, titleText, items) {
    const section = document.createElement("section");
    section.className = "menu-section";
    section.id = id;

    const title = document.createElement("h2");
    title.className = "menu-title";
    title.innerHTML = titleText;
    section.appendChild(title);

    items.forEach(function (item) {
      const wrapper = document.createElement("div");
      wrapper.className = "quiz-wrapper";

      const link = document.createElement("a");
      link.href = item.url;
      link.target = "_blank";
      link.rel = "noopener";
      link.className = "bouton-lien";
      link.textContent = (item.icon ? item.icon + " " : "") + item.title;

      link.addEventListener("click", function () {
        if (window.__analytics) {
          window.__analytics.track("portal_link_click", {
            link_url: item.url,
            link_title: item.title,
            section_id: id
          });
        }
      });

      wrapper.appendChild(link);
      section.appendChild(wrapper);
    });

    return section;
  }

  /* ---------------------------------------------------------
     Téléchargement standalone (.html hors-ligne)
     --------------------------------------------------------- */
  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function sanitizeFileName(name) {
    return (name.replace(/[<>:"/\\|?*\x00-\x1F]/g, "").trim().replace(/\s+/g, "_") || "quiz");
  }

  function extractQuizContainer(html) {
    var doc = new DOMParser().parseFromString(html, "text/html");
    var el = doc.querySelector(".quiz-container");
    return el ? el.outerHTML : "";
  }

  function buildStandaloneHtml(data, title, assets) {
    var payloadData = {};
    for (var k in data) { if (Object.prototype.hasOwnProperty.call(data, k)) payloadData[k] = data[k]; }
    payloadData.title = title;
    var payload = JSON.stringify(payloadData).replace(/<\//g, "<\\/");
    var container = extractQuizContainer(assets.quizHtml);

    return "<!doctype html>\n<html lang=\"fr\" data-theme=\"dark\">\n<head>\n" +
      "<meta charset=\"UTF-8\" />\n" +
      "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\" />\n" +
      "<meta name=\"theme-color\" content=\"#0b1020\" />\n" +
      "<title>" + escapeHtml(title) + "</title>\n" +
      "<style>\n" + assets.themeCss + "\n</style>\n" +
      "<style>\n" + assets.quizCss + "\n</style>\n" +
      "<style>.quiz-nav-bar{display:none}.results-actions #back-btn-results{display:none}</style>\n" +
      "</head>\n<body>\n" + container + "\n" +
      "<script>window.__EMBED_QUIZ__=" + payload + ";<\/script>\n" +
      "<script>\n" + assets.quizJs + "\n<\/script>\n" +
      "</body>\n</html>";
  }

  function downloadStandalone(quiz, btn) {
    if (btn) { btn.innerHTML = "⏳"; btn.style.pointerEvents = "none"; }

    Promise.all([
      fetch(quiz.file).then(function (r) { return r.json(); }),
      fetch("quiz.html").then(function (r) { return r.text(); }),
      fetch("css/theme.css").then(function (r) { return r.text(); }),
      fetch("css/quiz.css").then(function (r) { return r.text(); }),
      fetch("js/quiz.js").then(function (r) { return r.text(); })
    ]).then(function (files) {
      var assets = { quizHtml: files[1], themeCss: files[2], quizCss: files[3], quizJs: files[4] };
      var html = buildStandaloneHtml(files[0], quiz.title, assets);
      var blob = new Blob([html], { type: "text/html;charset=utf-8" });
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url; a.download = sanitizeFileName(quiz.title) + ".html";
      document.body.appendChild(a); a.click();
      document.body.removeChild(a); URL.revokeObjectURL(url);
      if (btn) { btn.innerHTML = "📥"; btn.style.pointerEvents = ""; }

      if (window.__analytics) {
        window.__analytics.track("portal_quiz_downloaded", {
          quiz_id: quiz.id,
          quiz_title: quiz.title,
            quiz_name: quiz.title,
          subject_id: quiz.subject,
          file_size_kb: Math.round(blob.size / 1024)
        });
      }
    }).catch(function (err) {
      console.error("Erreur téléchargement:", err);
      alert("Erreur lors du téléchargement du quiz.");
      if (btn) { btn.innerHTML = "📥"; btn.style.pointerEvents = ""; }
    });
  }

  function buildPortal(config) {
    allConfig = config;
    const subjects = config.subjects || [];
    const quizzes = config.quizzes || [];
    const tools = config.tools || [];
    const resources = config.resources || [];

    const subjectById = {};
    subjects.forEach((s) => {
      subjectById[s.id] = s;
    });

    // 1) Nouveautes (5 derniers quiz ajoutes)
    const recentSection = buildRecentSection(quizzes, subjectById);
    if (recentSection) sectionsContainer.appendChild(recentSection);

    // 2) Outils
    if (tools.length > 0) {
      sectionsContainer.appendChild(
        buildLinkSection("tools", '<img src="assets/papicons/gears.svg" class="papicon" alt="" /> Outils', tools)
      );
    }

    // 3) Matieres
    subjects.forEach((subject) => {
      const section = document.createElement("section");
      section.className = "menu-section";
      section.id = subject.id;

      const title = document.createElement("h2");
      title.className = "menu-title";
      title.textContent = subject.icon + " " + subject.name;
      section.appendChild(title);

      const quizList = quizzes.filter((q) => q.subject === subject.id);
      quizList.forEach((quiz) => {
        section.appendChild(buildQuizRow(quiz, subject, false));
      });

      if (quizList.length === 0) {
        const empty = document.createElement("p");
        empty.style.color = "var(--couleur-gris)";
        empty.style.fontStyle = "italic";
        empty.textContent = "Aucun questionnaire disponible pour l'instant.";
        section.appendChild(empty);
      }

      sectionsContainer.appendChild(section);
    });

    // 4) Ressources
    if (resources.length > 0) {
      sectionsContainer.appendChild(
        buildLinkSection("resources", '<img src="assets/papicons/globe.svg" class="papicon" alt="" /> Ressources', resources)
      );
    }

    // 5) Filtres
    const labelsContainer = document.getElementById("labels-selection");
    const allBtn = document.createElement("button");
    allBtn.className = "label-button";
    allBtn.dataset.target = "all";
    allBtn.textContent = "Tout Afficher";
    labelsContainer.appendChild(allBtn);

    if (recentSection) {
      const recentBtn = document.createElement("button");
      recentBtn.className = "label-button tab-recent";
      recentBtn.dataset.target = "nouveautes";
      recentBtn.innerHTML = '<img src="assets/papicons/sparkles.svg" class="papicon" alt="" /> Nouveautés';
      labelsContainer.insertBefore(recentBtn, allBtn);
    }

    subjects.forEach((subject) => {
      const btn = document.createElement("button");
      btn.className = "label-button";
      btn.dataset.target = subject.id;
      btn.textContent = subject.icon + " " + subject.name;
      labelsContainer.appendChild(btn);
    });

    [
      { id: "tools", label: '<img src="assets/papicons/gears.svg" class="papicon" alt="" /> Outils' },
      { id: "resources", label: '<img src="assets/papicons/globe.svg" class="papicon" alt="" /> Ressources' }
    ].forEach(function (extra) {
      if (!document.getElementById(extra.id)) return;
      const btn = document.createElement("button");
      btn.className = "label-button";
      btn.dataset.target = extra.id;
      btn.innerHTML = extra.label;
      labelsContainer.appendChild(btn);
    });

    const labelButtons = document.querySelectorAll(".label-button");

    function setActiveButton(target) {
      labelButtons.forEach((b) => {
        b.classList.toggle("active", b.getAttribute("data-target") === target);
      });
    }

    function applyFilter(target, push) {
      const known =
        target === "all" ||
        Array.prototype.some.call(
          labelButtons,
          (b) => b.getAttribute("data-target") === target
        );
      const next = known ? target : "all";
      setActiveButton(next);
      searchInput.value = "";
      const current = new URL(window.location).searchParams.get("filtre") || "all";
      if (push && current !== next) updateURLParameter("filtre", next);
      filterElements("", next);
    }

    labelButtons.forEach((button) => {
      button.addEventListener("click", function () {
        const target = this.getAttribute("data-target");
        applyFilter(target, true);

        if (window.__analytics) {
          window.__analytics.track("portal_filter", {
            filter_target: target,
            filter_label: this.textContent.trim()
          });
        }
      });
    });

    let searchTimeout = null;
    searchInput.addEventListener("input", function () {
      labelButtons.forEach((b) => b.classList.remove("active"));
      // replaceState : chaque frappe ne doit pas creer une entree d'historique.
      updateURLParameter("filtre", "all", true);
      filterElements(this.value, "all");

      clearTimeout(searchTimeout);
      var query = this.value.trim();
      if (query.length > 0) {
        searchTimeout = setTimeout(function () {
          if (window.__analytics) {
            window.__analytics.track("portal_search", { query: query });
          }
        }, 800);
      }
    });

    // Le bouton Retour doit remettre l'interface en phase avec l'URL.
    window.addEventListener("popstate", function () {
      const params = new URLSearchParams(window.location.search);
      applyFilter(params.get("filtre") || "all", false);
    });

    const multiLink = document.getElementById("multi-link");
    if (multiLink) {
      multiLink.addEventListener("click", (e) => {
        if (!navigator.onLine) e.preventDefault();
      });
      const syncMultiAvailability = () => {
        const offline = !navigator.onLine;
        multiLink.classList.toggle("is-offline", offline);
        multiLink.setAttribute("aria-disabled", offline ? "true" : "false");
        multiLink.title = offline
          ? "Multijoueur nécessite une connexion Internet"
          : "Multijoueur en direct — un hôte, des joueurs, un QR code";
      };
      syncMultiAvailability();
      window.addEventListener("online", syncMultiAvailability);
      window.addEventListener("offline", syncMultiAvailability);
    }

    const urlParams = new URLSearchParams(window.location.search);
    applyFilter(urlParams.get("filtre") || "all", false);
  }

  /* ---------------------------------------------------------
     Paramètres d'affichage (délais avant disparition)
     --------------------------------------------------------- */
  const SETTINGS_KEY = "quiz-display-settings";
  const SETTINGS_DEFAULTS = { correctDelay: 1100, wrongDelay: 3200 };
  const DELAY_MIN_MS = 0;
  const DELAY_MAX_MS = 15000;

  function loadDisplaySettings() {
    try {
      const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "null");
      if (!raw || typeof raw !== "object") return { ...SETTINGS_DEFAULTS };
      const correct = Number(raw.correctDelay);
      const wrong = Number(raw.wrongDelay);
      return {
        correctDelay:
          Number.isFinite(correct) && correct >= DELAY_MIN_MS && correct <= DELAY_MAX_MS
            ? correct
            : SETTINGS_DEFAULTS.correctDelay,
        wrongDelay:
          Number.isFinite(wrong) && wrong >= DELAY_MIN_MS && wrong <= DELAY_MAX_MS
            ? wrong
            : SETTINGS_DEFAULTS.wrongDelay
      };
    } catch (e) {
      return { ...SETTINGS_DEFAULTS };
    }
  }

  function saveDisplaySettings(settings) {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch (e) {}
  }

  function initSettingsModal() {
    const modal = document.getElementById("settings-modal");
    const openBtn = document.getElementById("settings-toggle");
    if (!modal || !openBtn) return;

    const correctInput = document.getElementById("delay-correct");
    const wrongInput = document.getElementById("delay-wrong");
    const correctValue = document.getElementById("delay-correct-value");
    const wrongValue = document.getElementById("delay-wrong-value");
    const saveBtn = document.getElementById("settings-save");
    const resetBtn = document.getElementById("settings-reset");

    const formatDelay = (ms) =>
      ms <= 0 ? "Manuel" : (ms / 1000).toFixed(1).replace(".", ",") + " s";

    function refreshLabels() {
      correctValue.textContent = formatDelay(Math.round(parseFloat(correctInput.value) * 1000));
      wrongValue.textContent = formatDelay(Math.round(parseFloat(wrongInput.value) * 1000));
    }

    function fillForm() {
      const s = loadDisplaySettings();
      correctInput.value = (s.correctDelay / 1000).toFixed(1);
      wrongInput.value = (s.wrongDelay / 1000).toFixed(1);
      refreshLabels();
    }

    function open() {
      fillForm();
      modal.classList.remove("hidden");
      document.documentElement.style.overflow = "hidden";
    }

    function close() {
      modal.classList.add("hidden");
      document.documentElement.style.overflow = "";
    }

    openBtn.addEventListener("click", open);
    modal.querySelectorAll("[data-settings-close]").forEach((el) => {
      el.addEventListener("click", close);
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !modal.classList.contains("hidden")) close();
    });

    correctInput.addEventListener("input", refreshLabels);
    wrongInput.addEventListener("input", refreshLabels);

    resetBtn.addEventListener("click", () => {
      correctInput.value = (SETTINGS_DEFAULTS.correctDelay / 1000).toFixed(1);
      wrongInput.value = (SETTINGS_DEFAULTS.wrongDelay / 1000).toFixed(1);
      refreshLabels();
    });

    saveBtn.addEventListener("click", () => {
      const settings = {
        correctDelay: Math.max(DELAY_MIN_MS, Math.min(DELAY_MAX_MS, Math.round(parseFloat(correctInput.value) * 1000) || 0)),
        wrongDelay: Math.max(DELAY_MIN_MS, Math.min(DELAY_MAX_MS, Math.round(parseFloat(wrongInput.value) * 1000) || 0))
      };
      saveDisplaySettings(settings);
      if (window.__analytics) {
        window.__analytics.track("portal_settings_save", {
          correct_delay_ms: settings.correctDelay,
          wrong_delay_ms: settings.wrongDelay
        });
      }
      close();
    });
  }

  initSettingsModal();

  // Nettoyage proactif de l'ancien stockage lourd eventuel dans localStorage
  (function cleanupExcessiveStorage() {
    try {
      const toRemove = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && (k.startsWith("quiz-persistent-data-") || k.startsWith("quiz-performed-questions-"))) {
          toRemove.push(k);
        }
      }
      toRemove.forEach((k) => localStorage.removeItem(k));
    } catch (e) {}
  })();

  fetch("data/config.json")
    .then((res) => {
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json();
    })
    .then((config) => {
      buildPortal(config);
      if (window.__analytics) {
        window.__analytics.track("portal_page_view", {
          total_quizzes: (config.quizzes || []).length,
          total_subjects: (config.subjects || []).length,
          total_tools: (config.tools || []).length,
          referrer: document.referrer || "direct",
          is_pwa: isRunningAsPWA()
        });
        window.__analytics.setPage("portal");
      }
    })
    .catch((err) => {
      console.error("Erreur chargement config:", err);
      sectionsContainer.innerHTML =
        '<p style="color:red;text-align:center;">Erreur lors du chargement de la configuration.</p>';
    });

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.addEventListener("message", (event) => {
      if (!cachingIndicator) return;
      const { type, completed, total, downloaded, unchanged, failed } = event.data || {};
      if (type === "caching-start") {
        cachingIndicator.style.display = "block";
        cachingIndicator.textContent = "Vérification... 0%";
      } else if (type === "caching-progress") {
        if (typeof completed === "number" && typeof total === "number") {
          const pct = Math.floor((completed / total) * 100);
          cachingIndicator.textContent = "Vérification... " + pct + "%";
        }
      } else if (type === "caching-complete") {
        if (typeof failed === "number" && failed > 0) {
          cachingIndicator.textContent = failed + " fichier(s) non mis en cache";
        } else if (typeof downloaded === "number" && downloaded > 0) {
          cachingIndicator.textContent = downloaded + " mis à jour";
        } else {
          cachingIndicator.textContent = "Tout est à jour";
        }
        setTimeout(() => { cachingIndicator.style.display = "none"; }, 2000);
      }
    });

    window.addEventListener("load", () => {
      const hadController = !!navigator.serviceWorker.controller;
      let refreshing = false;
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        // Premiere visite : le SW prend le controle, inutile de recharger.
        // On ne recharge que si une mise a jour remplace un controleur existant.
        if (!hadController || refreshing) return;
        refreshing = true;
        window.location.reload();
      });
      navigator.serviceWorker
        .register("service-worker.js", { scope: "./" })
        .then((reg) => {
          if (navigator.onLine && reg.active) {
            reg.active.postMessage({ type: "cache-assets" });
          }
        })
        .catch((err) => console.warn("Erreur SW:", err));
    });

    window.addEventListener("online", () => {
      if (navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({ type: "cache-assets" });
      }
    });
  }

  const scrollBtn = document.getElementById("scrollToTopBtn");
  window.addEventListener("scroll", () => {
    if (window.scrollY > 300) {
      scrollBtn.style.display = "block";
    } else {
      scrollBtn.style.display = "none";
    }
  });
  scrollBtn.addEventListener("click", () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
})();
