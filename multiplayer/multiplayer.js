/* ============================================================
   multiplayer.js — Mode multijoueur temps réel (PeerJS).

   • 1 hôte crée la partie (ID de salle + QR code), N joueurs
     rejoignent par lien/QR : topologie en étoile, nombre de
     joueurs illimité, tout tourne côté client (aucun serveur
     applicatif : seul le broker PeerJS fait l'introduction).
   • Les questions sont lues dans les MÊMES fichiers JSON que le
     quiz solo (data/config.json + data/<matiere>/<slug>.json) et
     normalisées par QUIZ_CORE (exposé par js/quiz.js) : modifier
     un quiz met automatiquement à jour le multijoueur.
   • Deux modes :
     1. « Même question » : tous sur la même question, l'hôte voit
        qui a calqué quoi, avance (ou force le passage), classement
        en direct puis scores finaux.
     2. « Questions différentes » : chaque joueur reçoit sa propre
        question (sans doublon tant que possible), chacun joue à son
        rythme, classement en direct.
   • PeerJS + qrcode-generator sont chargés à la demande depuis un
     CDN (jamais dans le cache hors-ligne du service worker).
   ============================================================ */
(function () {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };

  var PEER_SOURCES = [
    "https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js",
    "https://cdn.jsdelivr.net/npm/peerjs@1.5.4/dist/peerjs.min.js"
  ];
  var QR_SOURCES = [
    "https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js",
    "https://unpkg.com/qrcode-generator@1.4.4/qrcode.js"
  ];

  var ROOM_PREFIX = "mp2-";
  var CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sans 0/O/1/I
  var HOST_PID = "_host"; // pid réservé à l'hôte quand il joue aussi

  // Config chargée pour les sélecteurs Matière → Questionnaire
  var CFG = { subjects: [], quizzes: [] };

  /* ============================================================
     Utilitaires
     ============================================================ */
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function showScreen(id) {
    ["screen-home", "screen-lobby", "screen-game", "screen-final"].forEach(function (x) {
      var el = $(x);
      if (el) el.classList.toggle("hidden", x !== id);
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function setStatus(el, msg, cls) {
    if (!el) return;
    el.textContent = msg || "";
    el.classList.remove("is-error", "is-ok");
    if (cls) el.classList.add(cls);
  }

  function updateNetStatus(state) {
    var el = $("net-status");
    if (!el) return;
    if (S.netMode === "lan") {
      el.textContent = "🏠 LAN direct";
      el.classList.remove("is-off");
      bumpClass(el);
      return;
    }
    if (!navigator.onLine) {
      el.textContent = "📴 Hors ligne";
      el.classList.add("is-off");
      return;
    }
    if (state === "reconnecting" || (S.peer && S.peer.disconnected)) {
      el.textContent = "🔄 Reconnexion serveur…";
      el.classList.remove("is-off");
    } else {
      el.textContent = "🌐 En ligne";
      el.classList.remove("is-off");
    }
    bumpClass(el);
  }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = src;
      s.onload = function () { resolve(); };
      s.onerror = function () {
        s.remove();
        reject(new Error("chargement impossible : " + src));
      };
      document.head.appendChild(s);
    });
  }

  function loadFirst(sources) {
    var i = 0;
    function attempt() {
      if (i >= sources.length) return Promise.reject(new Error("bibliothèque indisponible"));
      return loadScript(sources[i++]).catch(attempt);
    }
    return attempt();
  }

  function ensurePeer() {
    if (window.Peer) return Promise.resolve();
    return loadFirst(PEER_SOURCES);
  }

  function ensureQR() {
    if (window.qrcode) return Promise.resolve();
    return loadFirst(QR_SOURCES);
  }

  function track(action, props) {
    if (window.__analytics) window.__analytics.track(action, props || {});
  }

  function makeCode() {
    var out = "";
    var buf = new Uint32Array(5);
    (window.crypto || window.msCrypto).getRandomValues(buf);
    for (var i = 0; i < 5; i++) {
      out += CODE_ALPHABET[buf[i] % CODE_ALPHABET.length];
    }
    return out;
  }

  function sanitizeName(n) {
    n = String(n == null ? "" : n).trim().replace(/[<>]/g, "");
    if (!n) n = "Joueur";
    return n.slice(0, 15);
  }

  /* ============================================================
     Intégration des quiz (mêmes sources que le quiz solo)
     ============================================================ */
  var configCache = null;
  var quizCache = {};

  function coreReady() {
    return !!(window.QUIZ_CORE && window.QUIZ_CORE.normalizeQuiz);
  }

  function loadConfig() {
    if (configCache) return Promise.resolve(configCache);
    return fetch("../data/config.json")
      .then(function (r) { return r.json(); })
      .then(function (cfg) { configCache = cfg; return cfg; });
  }

  function loadQuizCats(quizId) {
    if (quizCache[quizId]) return Promise.resolve(quizCache[quizId]);
    return loadConfig().then(function (cfg) {
      var meta = (cfg.quizzes || []).find(function (q) { return q.id === quizId; });
      if (!meta) throw new Error("Questionnaire introuvable");
      return fetch("../" + meta.file)
        .then(function (r) { return r.json(); })
        .then(function (data) {
          var cats = window.QUIZ_CORE.normalizeQuiz(data, meta.title);
          quizCache[quizId] = { meta: meta, cats: cats };
          return quizCache[quizId];
        });
    });
  }

  /* ============================================================
     IMPORT QUIZMASTER — un HTML exporté par quizmaster.html
     embarque window.__EMBED_QUIZ__ = {title, categories:[...]}.
     ============================================================ */
  var IMPORTED_ID = "__imported__";
  var importedQuiz = null; // {title, cats}

  function countQuizQuestions(cats) {
    return (cats || []).reduce(function (n, c) { return n + (c.questions ? c.questions.length : 0); }, 0);
  }

  function importQuizHtml(file) {
    return new Promise(function (resolve, reject) {
      if (!window.QUIZ_CORE || !window.QUIZ_CORE.normalizeQuiz) {
        reject(new Error("Moteur de quiz indisponible."));
        return;
      }
      var reader = new FileReader();
      reader.onerror = function () { reject(new Error("Lecture du fichier impossible.")); };
      reader.onload = function (e) {
        try {
          var html = String(e.target.result || "");
          var m = html.match(/window\.__EMBED_QUIZ__\s*=\s*([\s\S]*?);?\s*<\/script>/);
          if (!m) {
            reject(new Error("Aucun quiz embarqué trouvé — utilise un fichier HTML exporté par QuizMaster."));
            return;
          }
          var data = JSON.parse(m[1]);
          if (!data || typeof data !== "object") throw new Error("Quiz embarqué illisible.");
          var title = data.title || file.name.replace(/\.html?$/i, "");
          var cats = window.QUIZ_CORE.normalizeQuiz(data, title);
          if (!cats.length) throw new Error("Aucune question valide dans ce fichier.");
          importedQuiz = { title: title, cats: cats };
          quizCache[IMPORTED_ID] = {
            meta: { id: IMPORTED_ID, title: title, subject: data.subject || "", file: "" },
            cats: cats
          };
          resolve(importedQuiz);
        } catch (err) {
          reject(err);
        }
      };
      reader.readAsText(file);
    });
  }

  function addImportedQuizOption(selectIt) {
    if (!importedQuiz) return;
    var count = countQuizQuestions(importedQuiz.cats);
    var existingIndex = (CFG.quizzes || []).findIndex(function (q) { return q.id === IMPORTED_ID; });
    var entry = {
      id: IMPORTED_ID,
      title: "📄 " + importedQuiz.title,
      subject: "__imported__",
      file: "",
      questionsCount: count,
      cats: importedQuiz.cats
    };
    if (existingIndex >= 0) {
      CFG.quizzes[existingIndex] = entry;
    } else {
      CFG.quizzes.unshift(entry);
    }
    if (selectIt) {
      selectedQuizIds.add(IMPORTED_ID);
    }
    renderQuizList();
  }

  /* ============================================================
     Helpers purs (mélange, attribution, jugement)
     ============================================================ */
  function shuffle(arr) {
    if (window.QUIZ_CORE) return window.QUIZ_CORE.shuffle(arr);
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  function normalizeText(v) {
    if (window.QUIZ_CORE) return window.QUIZ_CORE.normalizeText(v);
    return String(v == null ? "" : v).toLowerCase().replace(/\s+/g, "").replace(/,/g, ".");
  }

  // Mode 2 : distribution sans doublon tant qu'il y a assez de questions,
  // avec doublons uniquement s'il y a plus de joueurs que de questions.
  function assignQuestions(pool, nPlayers) {
    var res = [];
    var i;
    for (i = 0; i < nPlayers; i++) res.push([]);
    if (nPlayers === 0 || pool.length === 0) return res;
    if (pool.length >= nPlayers) {
      for (i = 0; i < pool.length; i++) res[i % nPlayers].push(pool[i]);
    } else {
      // Plus de joueurs que de questions : chacun en fait au moins une (doublons autorisés)
      for (i = 0; i < nPlayers; i++) res[i].push(pool[i % pool.length]);
    }
    return res;
  }

  function judge(q, a) {
    if (!q) return false;
    if (q.type === "text") {
      var v = normalizeText(a);
      return (q.accepted || []).some(function (acc) {
        return normalizeText(acc) === v;
      });
    }
    return typeof a === "number" && a === q.correctIndex;
  }

  function correctLabel(q) {
    if (!q) return "";
    if (q.type === "text") return (q.accepted && q.accepted[0]) || "";
    return (q.options && q.options[q.correctIndex]) || "";
  }

  function answerLabel(q, a) {
    if (a == null) return null;
    if (q.type === "text") return String(a);
    return (q.options && q.options[a]) != null ? q.options[a] : String(a);
  }

  // Copie « publique » d'une question : PAS de correctIndex/accepted/solution
  // envoyée aux joueurs (l'hôte reste seul juge).
  function publicQ(q) {
    return {
      text: q.text,
      type: q.type,
      options: q.options || [],
      image: q.image || ""
    };
  }

  /* ============================================================
     État global
     ============================================================ */
  var S = {
    role: null,          // "host" | "client"
    mode: 1,             // 1 = même question, 2 = questions différentes
    netMode: "cloud",    // "cloud" | "lan"
    lanHost: "",         // URL / IP personnalisée pour le serveur LAN
    totalAvailable: 0,   // Nombre total de questions disponibles dans les quiz sélectionnés
    peer: null,
    relay: null,         // relais réseau universel
    code: null,
    joinUrl: null,
    started: false,
    hostAsPlayer: false, // l'hôte participe aussi au quiz
    hostName: "Hôte",    // pseudo affiché pour l'hôte (lobby + classement)
    // hôte
    players: [],         // [{pid, n, conn, gone}]
    nextPid: 1,
    quizId: null,
    catScope: "all",
    limit: 20,
    quizTitle: "",
    catLabel: "",
    pool: [],
    round: 0,
    phase: "idle",       // answering | reveal  (mode 1)
    fastScoring: true,   // 1 pt + 1/rang (bonne réponse) ; 0 si mauvaise
    correctByR: {},      // r -> nb de bonnes réponses (mode 2, rang par étape)
    answers: {},         // pid -> {a, ok, t, pts} (mode 1)
    scores: {},          // pid -> {score, done}
    assigns: {},         // pid -> [q...]         (mode 2)
    assignLen: {},       // pid -> n              (mode 2)
    cursor: {},          // pid -> prochain index (mode 2)
    curQ: {},            // pid -> {q, r, answered} (mode 2)
    lbPrev: {},          // pid -> dernier score connu (flash classement)
    // client
    myPid: null,
    myName: "",
    lastProg: "0/0",
    clientQ: null,       // {r, n, q, submitted}
    clientDone: false
  };

  /* ============================================================
     ANIMATIONS — petites aides partagées
     ============================================================ */
  function prefersReducedMotion() {
    return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }

  function bumpClass(el) {
    if (!el) return;
    el.classList.remove("mp-bump");
    void el.offsetWidth; // relance l'animation
    el.classList.add("mp-bump");
  }

  // Formate un score (entier ou décimal à 2 chiffres) pour l'affichage.
  function fmtScore(n) {
    n = Math.round((Number(n) || 0) * 100) / 100;
    return String(n);
  }

  // Points pour une réponse : 1 pt si bonne + 1/rang de rapidité (rang parmi
  // les bonnes réponses à la même question) ; 0 si mauvaise réponse.
  // Bonus désactivé → 1 point par bonne réponse.
  function answerPoints(ok, rank) {
    if (!ok) return 0;
    if (!S.fastScoring) return 1;
    return 1 + 1 / (rank || 1);
  }

  function countUp(el, to, suffix) {
    if (!el) return;
    suffix = suffix || "";
    var isInt = Number.isInteger(to);
    function fmt(v) {
      var r = isInt ? Math.round(v) : Math.round(v * 100) / 100;
      return r + suffix;
    }
    if (prefersReducedMotion()) {
      el.textContent = fmt(to);
      return;
    }
    var dur = 900;
    var t0 = null;
    function step(ts) {
      if (t0 === null) t0 = ts;
      var p = Math.min(1, (ts - t0) / dur);
      var eased = 1 - Math.pow(1 - p, 3);
      el.textContent = fmt(to * eased);
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  function beep() {
    try {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      var ac = new Ctx();
      var osc = ac.createOscillator();
      var gain = ac.createGain();
      osc.type = "sine";
      osc.frequency.value = 880;
      osc.connect(gain);
      gain.connect(ac.destination);
      gain.gain.setValueAtTime(0.12, ac.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.25);
      osc.start();
      osc.stop(ac.currentTime + 0.25);
      osc.onended = function () { try { ac.close(); } catch (e) {} };
    } catch (e) {}
  }

  // Pluie de confettis sur l'écran final (canvas maison, sans dépendance).
  function confettiBurst() {
    if (prefersReducedMotion()) return;
    var old = document.getElementById("mp-confetti");
    if (old && old.parentNode) old.parentNode.removeChild(old);

    var canvas = document.createElement("canvas");
    canvas.id = "mp-confetti";
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    document.body.appendChild(canvas);
    var ctx = canvas.getContext("2d");
    var colors = ["#22c55e", "#3b82f6", "#fbbf24", "#a855f7", "#f97316", "#14b8a6"];
    var parts = [];
    var running = true;

    function spawn(n, power) {
      for (var i = 0; i < n; i++) {
        parts.push({
          x: canvas.width * (0.2 + Math.random() * 0.6),
          y: canvas.height * 0.25 + Math.random() * 40,
          vx: (Math.random() - 0.5) * power,
          vy: -Math.random() * power * 0.85 - 2,
          g: 0.14 + Math.random() * 0.1,
          rot: Math.random() * Math.PI,
          vr: (Math.random() - 0.5) * 0.3,
          w: 5 + Math.random() * 6,
          h: 4 + Math.random() * 5,
          color: colors[(Math.random() * colors.length) | 0],
          life: 0
        });
      }
    }

    spawn(70, 7);
    var wave2 = setTimeout(function () { spawn(55, 8); }, 650);

    function frame() {
      if (!running) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (var i = parts.length - 1; i >= 0; i--) {
        var p = parts[i];
        p.life++;
        p.vy += p.g;
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.vr;
        p.vx *= 0.99;
        if (p.y > canvas.height + 30 || p.life > 320) {
          parts.splice(i, 1);
          continue;
        }
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.globalAlpha = Math.max(0, 1 - p.life / 320);
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      }
      if (parts.length > 0) {
        requestAnimationFrame(frame);
      } else {
        running = false;
        clearTimeout(wave2);
        if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
      }
    }
    requestAnimationFrame(frame);
    // filet de sécurité : suppression au bout de 6 s
    setTimeout(function () {
      running = false;
      if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
    }, 6000);
  }

  function activePlayers() {
    return S.players.filter(function (p) { return !p.gone; });
  }

  function scoreOf(pid) {
    if (!S.scores[pid]) S.scores[pid] = { score: 0, done: 0 };
    return S.scores[pid];
  }

  function buildLeaderboard() {
    var entries = S.players.map(function (p) {
      var sc = S.scores[p.pid] || { score: 0, done: 0 };
      return {
        pid: p.pid,
        n: p.n,
        score: sc.score,
        done: sc.done,
        total: S.assignLen[p.pid] || S.pool.length,
        out: !!p.gone
      };
    });
    entries.sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;
      if (b.done !== a.done) return b.done - a.done;
      return a.n.localeCompare(b.n);
    });
    return entries;
  }

  /* ============================================================
     RENDU — partagé hôte/joueur
     ============================================================ */
  function renderPlayers() {
    var list = $("player-list");
    if (!list) return;
    var hostLabel = esc(S.hostName || "Hôte");
    var hostChip = S.hostAsPlayer
      ? '<span class="mp-player-chip is-host is-playing">🎛️ ' + hostLabel + ' <span class="mp-chip">joueur</span></span>'
      : '<span class="mp-player-chip is-host">🎛️ ' + hostLabel + '</span>';
    var html = hostChip;
    S.players.forEach(function (p) {
      if (p.isHost) return; // déjà affiché par le chip hôte
      var cls = "mp-player-chip";
      if (S.role === "client" && p.pid === S.myPid) cls += " is-me";
      if (p.gone) cls += " is-out";
      html += '<span class="' + cls + '">🎮 ' + esc(p.n) + "</span>";
    });
    list.innerHTML = html;
    var countEl = $("player-count");
    if (countEl) {
      var n = String(activePlayers().length);
      if (countEl.textContent !== n) {
        countEl.textContent = n;
        bumpClass(countEl);
      }
    }
    var startBtn = $("btn-start");
    if (startBtn && S.role === "host") {
      startBtn.disabled = !S.started ? activePlayers().length < 1 : true;
      startBtn.textContent = S.started ? "Partie en cours…" : "🚀 Lancer la partie";
    }
  }

  function renderLb(entries) {
    var box = $("g-lb");
    if (!box) return;
    if (!entries || entries.length === 0) {
      box.innerHTML = '<p class="mp-dim">Le classement s\'affichera ici.</p>';
      S.lbPrev = {};
      return;
    }

    // FLIP : on mémorise les positions avant réaffichage
    var oldPos = {};
    box.querySelectorAll(".mp-lb-row[data-pid]").forEach(function (r) {
      oldPos[r.getAttribute("data-pid")] = r.getBoundingClientRect().top;
    });

    var medals = ["🥇", "🥈", "🥉"];
    var html = "";
    entries.forEach(function (e, i) {
      var cls = "mp-lb-row" + (i < 3 ? " top" + (i + 1) : "");
      if ((S.role === "client" && e.pid === S.myPid) ||
          (S.role === "host" && e.pid === HOST_PID)) cls += " is-me";
      if (e.out) cls += " is-out";
      var rank = i < 3 ? medals[i] : String(i + 1);
      html +=
        '<div class="' + cls + '" data-pid="' + esc(String(e.pid)) +
          '" data-score="' + e.score + '">' +
          '<span class="rank">' + rank + "</span>" +
          '<span class="name">' + esc(e.n) + (e.out ? " 🔌" : "") + "</span>" +
          '<span class="prog">' + e.done + "/" + e.total + "</span>" +
          '<span class="pts">' + fmtScore(e.score) + " pts</span>" +
        "</div>";
    });
    box.innerHTML = html;

    // Animations post-rendu : pop des nouveaux, flash des scores en hausse,
    // glissement FLIP des réordonnancements, compteurs animés.
    box.querySelectorAll(".mp-lb-row[data-pid]").forEach(function (r) {
      var pid = r.getAttribute("data-pid");
      var now = Number(r.getAttribute("data-score")) || 0;
      var prev = S.lbPrev[pid];
      var ptsEl = r.querySelector(".pts");

      if (prev === undefined) {
        r.classList.add("is-enter");
      } else if (now > prev) {
        r.classList.add("is-up");
        countUp(ptsEl, now, " pts");
      }

      var top = oldPos[pid];
      if (top !== undefined) {
        var delta = top - r.getBoundingClientRect().top;
        if (Math.abs(delta) > 1) {
          r.style.transition = "none";
          r.style.transform = "translateY(" + delta + "px)";
          requestAnimationFrame(function () {
            r.style.transition = "";
            r.style.transform = "";
          });
        }
      }
    });

    var next = {};
    entries.forEach(function (e) { next[e.pid] = e.score; });
    S.lbPrev = next;
  }

  function setMainBtn(opts) {
    // opts: {which:"submit"|"next"|"none", label, cls, disabled, onclick, coexist}
    var submit = $("g-submit");
    var next = $("g-next");
    // Hôte-joueur : « Valider la réponse » et « Forcer le passage » (ou
    // « Question suivante ») doivent coexister, on ne masque donc jamais
    // l'autre bouton tant que l'hôte participe.
    var coexist = opts && S.hostAsPlayer && opts.which !== "none";
    if (opts && opts.which === "submit") {
      if (!coexist) next.classList.add("hidden");
    } else if (opts && opts.which === "next") {
      if (!coexist) submit.classList.add("hidden");
    } else {
      submit.classList.add("hidden");
      next.classList.add("hidden");
    }
    if (opts && opts.which !== "submit") next.classList.remove("is-force", "is-final");
    if (!opts || opts.which === "none") return;
    var btn = opts.which === "submit" ? submit : next;
    btn.classList.remove("hidden");
    btn.textContent = opts.label || "";
    if (opts.cls) btn.classList.add(opts.cls);
    btn.disabled = !!opts.disabled;
    btn.onclick = opts.onclick || null;
    if (!opts.cls) {
      // pop d'entrée (sauf force/final qui ont leur propre pulse)
      btn.classList.remove("mp-pop");
      void btn.offsetWidth;
      btn.classList.add("mp-pop");
    }
  }

  function renderQuestionInto(q, interactive) {
    var card = $("g-question");
    var fb = $("g-feedback");
    fb.classList.add("hidden");
    fb.classList.remove("feedback-correct", "feedback-incorrect");
    fb.innerHTML = "";

    var html = '<p class="question-text">' + q.text + "</p>";
    if (q.image) {
      html += '<div class="image-area"><img src="' + esc(q.image) + '" alt="Illustration" loading="lazy"></div>';
    }
    if (q.type === "text") {
      html +=
        '<div class="input-area"><input type="text" id="mp-text-answer" class="text-answer" ' +
        'placeholder="Ta réponse..." autocomplete="off" spellcheck="false"></div>';
    } else {
      html += '<div id="mp-options" class="options-container"></div>';
    }
    card.innerHTML = html;
    card.classList.remove("hidden");

    if (q.type !== "text") {
      var wrap = card.querySelector("#mp-options");
      if (interactive) {
        setMainBtn({ which: "submit", label: "Valider la Réponse", disabled: true, onclick: playerSubmit, coexist: true });
      }
      (q.options || []).forEach(function (opt, i) {
        var b = document.createElement("button");
        b.type = "button";
        b.className = "answer-btn";
        b.innerHTML = opt;
        b.dataset.i = String(i);
        b.style.animationDelay = (i * 70 + 80) + "ms"; // cascade d'entrée
        if (interactive) {
          b.onclick = function () {
            wrap.querySelectorAll(".answer-btn").forEach(function (x) {
              x.classList.remove("selected");
            });
            b.classList.add("selected");
            setMainBtn({ which: "submit", label: "Valider la Réponse", onclick: playerSubmit, coexist: true });
          };
        } else {
          b.disabled = true;
        }
        wrap.appendChild(b);
      });
    } else if (interactive) {
      var input = $("mp-text-answer");
      input.addEventListener("input", function () {
        setMainBtn({
          which: "submit",
          label: "Valider la Réponse",
          disabled: input.value.trim() === "",
          onclick: playerSubmit,
          coexist: true
        });
      });
      setMainBtn({ which: "submit", label: "Valider la Réponse", disabled: true, onclick: playerSubmit, coexist: true });
      setTimeout(function () { input.focus(); }, 150);
    }
  }

  function lockQuestionUI() {
    var card = $("g-question");
    card.querySelectorAll(".answer-btn").forEach(function (b) { b.disabled = true; });
    var input = $("mp-text-answer");
    if (input) input.disabled = true;
  }

  function renderReveal(data) {
    // data: {rows:[{n, ans, ok, pts}], correct, solution}
    var box = $("g-reveal");
    var html = "<h4>📋 Qui a calqué quoi ?</h4>";
    html += '<table class="mp-table"><tr><th>Joueur</th><th>Réponse</th><th></th><th>Points</th></tr>';
    (data.rows || []).forEach(function (r) {
      html +=
        "<tr><td>" + esc(r.n) + "</td>" +
        "<td>" + (r.ans == null ? '<span class="muted">Pas de réponse</span>' : esc(r.ans)) + "</td>" +
        '<td class="' + (r.ans == null ? "muted" : r.ok ? "ok" : "ko") + '">' +
        (r.ans == null ? "—" : '<span class="mp-ico">' + (r.ok ? "✅" : "❌") + "</span>") + "</td>" +
        '<td class="' + (r.pts > 0 ? "ok" : "muted") + '">' +
        (r.ans == null ? "—" : "+" + fmtScore(r.pts)) + "</td></tr>";
    });
    html += "</table>";
    if (data.correct) {
      html += '<div class="mp-correct-answer">✅ Bonne réponse : ' + esc(data.correct) + "</div>";
    }
    if (data.solution) {
      html += '<div class="solution">' + data.solution + "</div>";
    }
    if (S.role === "client") {
      html += '<p class="mp-dim" style="margin:.7rem 0 0">⏳ En attente de l\'hôte pour la question suivante…</p>';
    }
    box.innerHTML = html;
    box.classList.remove("hidden");
  }

  function resetQuestionUI() {
    $("g-question").classList.add("hidden");
    $("g-question").innerHTML = "";
    var fb = $("g-feedback");
    fb.classList.add("hidden");
    fb.classList.remove("feedback-correct", "feedback-incorrect");
    fb.innerHTML = "";
    $("g-reveal").classList.add("hidden");
    $("g-reveal").innerHTML = "";
    $("g-wait").classList.add("hidden");
    $("g-wait").innerHTML = "";
    setMainBtn({ which: "none" });
  }

  function renderFeedback(ok, correct, solution) {
    var fb = $("g-feedback");
    fb.classList.remove("hidden", "feedback-correct", "feedback-incorrect");
    var sol = solution ? '<div class="solution">' + solution + "</div>" : "";
    if (ok) {
      fb.innerHTML = '<div class="feedback-title">✅ Bravo !</div>' + sol;
      fb.classList.add("feedback-correct");
    } else {
      fb.innerHTML =
        '<div class="feedback-title">❌ Faux.</div>' +
        (correct ? '<div class="feedback-answer">Bonne réponse : ' + esc(correct) + "</div>" : "") +
        sol;
      fb.classList.add("feedback-incorrect");
    }
  }

  function updateRoundLabel(text) {
    var el = $("g-round");
    el.textContent = text || "";
    if (text) bumpClass(el);
  }

  function updateSubInfo(text) {
    $("g-subinfo").textContent = text || "";
  }

  function updateProgress(pct) {
    $("g-progress").style.width = Math.max(0, Math.min(100, pct)) + "%";
  }

  /* ============================================================
     HOST — création de la partie
     ============================================================ */
  function hostCreate() {
    if (!navigator.onLine && S.netMode !== "lan") {
      setStatus($("home-status"), "Connexion Internet requise en mode Internet. Pour jouer hors-ligne, sélectionne 'Réseau Local (LAN)'.", "is-error");
      return;
    }
    if (!coreReady()) {
      setStatus($("home-status"), "Chargement du moteur de quiz impossible (js/quiz.js).", "is-error");
      return;
    }
    setStatus($("home-status"), "Création de la partie…");
    $("btn-create").disabled = true;

    var code = makeCode();
    S.code = code;
    S.role = "host";
    S.players = [];
    S.started = false;
    S.joinUrl = joinUrlFor(code);

    if (S.relay) { try { S.relay.destroy(); } catch (e) {} }
    S.relay = createHostRelay(code);

    $("btn-create").disabled = false;
    showScreen("screen-lobby");
    $("host-setup").classList.remove("hidden");
    $("client-wait").classList.add("hidden");
    $("qr-holder").classList.remove("hidden");
    $("btn-copy").classList.remove("hidden");
    $("lobby-title").textContent = "Partie créée !";
    $("room-code").textContent = S.code;

    // Badge réseau dans le lobby
    var netBadge = $("lobby-net-badge");
    if (netBadge) {
      if (S.netMode === "lan") {
        netBadge.textContent = "🏠 Mode Réseau Local (LAN)";
        netBadge.style.color = "var(--accent, #3b82f6)";
      } else {
        netBadge.textContent = "🌐 Mode Internet";
        netBadge.style.color = "var(--success, #10b981)";
      }
    }

    var lanNotice = $("lan-ip-notice");
    if (lanNotice) {
      if (S.netMode === "lan" && (location.hostname === "localhost" || location.hostname === "127.0.0.1")) {
        lanNotice.innerHTML = "💡 <strong>Conseil Wi-Fi :</strong> Vous êtes sur 'localhost'. Pour que les smartphones se connectent en Wi-Fi, ouvrez cette page sur l'adresse IP locale de votre machine ou utilisez le QR code.";
        lanNotice.classList.remove("hidden");
      } else {
        lanNotice.classList.add("hidden");
      }
    }

    setStatus($("home-status"), "");
    setStatus($("lobby-status"), "En attente des joueurs… scanne le QR code !");
    setStatus($("setup-status"), "Chargement des questionnaires…");
    renderQR();
    track("multiplayer_host_create", { netMode: S.netMode });

    loadConfig()
      .then(function (cfg) {
        populateQuizSelect(cfg);
        setStatus($("setup-status"), "");
        renderPlayers();
      })
      .catch(function (err) {
        $("btn-create").disabled = false;
        setStatus($("home-status"), "Impossible de créer la partie : " + err.message, "is-error");
      });
  }

  /* ============================================================
     Relais réseau universel (100% JavaScript — aucun serveur Python)
     - Mode Internet : relais cloud JS haute vitesse, 100% gratuit
     - Mode LAN : fonctionne directement sur le site web en JavaScript
       OU avec le serveur Node.js (node server.js) si exécuté en local
     - Inter-onglets : BroadcastChannel instantané (0 ms de latence)
     ============================================================ */
  var RELAY_BASE = "https://ntfy.sh";
  var RELAY_WS_BASE = "wss://ntfy.sh";

  function getActiveRelayConfig() {
    if (S.netMode === "lan") {
      // 1. Si une URL de serveur local a été spécifiée
      if (S.lanHost && S.lanHost.trim()) {
        var customBase = S.lanHost.trim().replace(/\/+$/, "");
        if (!customBase.endsWith("/api/relay")) customBase += "/api/relay";
        return {
          mode: "lan_local",
          base: customBase,
          wsBase: customBase.replace(/^http/, "ws"),
          isLan: true
        };
      }
      // 2. Si on tourne sur un serveur Node.js local (localhost / IP LAN)
      var host = location.hostname || "";
      var isLocalHost = host === "localhost" || host === "127.0.0.1" || /^192\.168\./.test(host) || /^10\./.test(host);
      if (isLocalHost && location.protocol.startsWith("http")) {
        var localBase = location.origin + "/api/relay";
        return {
          mode: "lan_local",
          base: localBase,
          wsBase: localBase.replace(/^http/, "ws"),
          isLan: true
        };
      }
      // 3. Directement sur le site web : serveur JS web direct (0 Python nécessaire)
      return {
        mode: "lan_web",
        base: RELAY_BASE,
        wsBase: RELAY_WS_BASE,
        isLan: true
      };
    }
    return {
      mode: "cloud",
      base: RELAY_BASE,
      wsBase: RELAY_WS_BASE,
      isLan: false
    };
  }

  function getRelayTopic(code) {
    var prefix = S.netMode === "lan" ? "qfr2_lan_" : "qfr2_";
    return prefix + String(code || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  }

  var activeBc = null;
  function getBroadcastChannel(topic) {
    if (typeof BroadcastChannel === "undefined") return null;
    try {
      if (!activeBc || activeBc.name !== "qfr2_" + topic) {
        if (activeBc) { try { activeBc.close(); } catch (e) {} }
        activeBc = new BroadcastChannel("qfr2_" + topic);
      }
      return activeBc;
    } catch (e) {
      return null;
    }
  }

  function relayPublish(topic, msgObj) {
    if (!msgObj) return Promise.resolve();
    if (!msgObj._mid) {
      msgObj._mid = Math.random().toString(36).slice(2, 9) + Date.now().toString(36);
    }

    // 1. Relais local instantané sur la même machine
    var bc = getBroadcastChannel(topic);
    if (bc) {
      try { bc.postMessage(msgObj); } catch (e) {}
    }

    // 2. Relais réseau (LAN ou Cloud)
    var cfg = getActiveRelayConfig();
    return fetch(cfg.base + "/" + topic, {
      method: "POST",
      headers: { "Content-Type": "text/plain; charset=utf-8" },
      body: JSON.stringify(msgObj)
    }).catch(function (err) {
      console.warn("Relay publish error:", err);
    });
  }

  function relaySubscribe(topic, onMessage, onError) {
    var ws = null;
    var sse = null;
    var pollTimer = null;
    var closed = false;
    var seenIds = new Set();
    var seenMids = new Set();
    var cfg = getActiveRelayConfig();

    function handlePayload(payload) {
      if (!payload) return;
      if (payload._mid) {
        if (seenMids.has(payload._mid)) return;
        seenMids.add(payload._mid);
        if (seenMids.size > 200) {
          var first = seenMids.values().next().value;
          seenMids.delete(first);
        }
      }
      onMessage(payload);
    }

    // 1. Écoute locale inter-onglets
    var bc = getBroadcastChannel(topic);
    if (bc) {
      bc.onmessage = function (e) {
        if (e.data && typeof e.data === "object") {
          handlePayload(e.data);
        }
      };
    }

    function handleRaw(rawStr) {
      try {
        var raw = JSON.parse(rawStr);
        if (raw.event === "message" && raw.message) {
          if (raw.id) {
            if (seenIds.has(raw.id)) return;
            seenIds.add(raw.id);
            if (seenIds.size > 200) {
              var first = seenIds.values().next().value;
              seenIds.delete(first);
            }
          }
          var payload = typeof raw.message === "string" ? JSON.parse(raw.message) : raw.message;
          handlePayload(payload);
        }
      } catch (e) {}
    }

    // 2. Écoute réseau
    if (cfg.mode === "lan_local") {
      var lastPollId = 0;
      function startLanSse() {
        if (closed) return;
        try {
          sse = new EventSource(cfg.base + "/" + topic + "/sse");
          sse.onmessage = function (e) {
            handleRaw(e.data);
          };
          sse.onerror = function () {
            if (closed) return;
            try { sse.close(); } catch (err) {}
            sse = null;
            startLanPolling();
          };
        } catch (e) {
          startLanPolling();
        }
      }

      function startLanPolling() {
        if (closed || pollTimer) return;
        function poll() {
          if (closed) return;
          fetch(cfg.base + "/" + topic + "?since=" + lastPollId)
            .then(function (r) { return r.json(); })
            .then(function (data) {
              if (data && data.messages && data.messages.length) {
                data.messages.forEach(function (m) {
                  lastPollId = Math.max(lastPollId, parseInt(m.id, 10) || 0);
                  try {
                    var payload = JSON.parse(m.message);
                    handlePayload(payload);
                  } catch (err) {}
                });
              }
            })
            .catch(function () {})
            .then(function () {
              if (!closed) pollTimer = setTimeout(poll, 350);
            });
        }
        poll();
      }

      startLanSse();
    } else {
      function startWs() {
        if (closed) return;
        try {
          ws = new WebSocket(cfg.wsBase + "/" + topic + "/ws?since=2m");
          ws.onmessage = function (e) {
            handleRaw(e.data);
          };
          ws.onerror = function () {
            if (!closed && !sse) startSse();
          };
          ws.onclose = function () {
            if (!closed && !sse) {
              setTimeout(startWs, 1500);
            }
          };
        } catch (e) {
          startSse();
        }
      }

      function startSse() {
        if (closed || sse) return;
        try {
          sse = new EventSource(cfg.base + "/" + topic + "/sse?since=2m");
          sse.onmessage = function (e) {
            handleRaw(e.data);
          };
          sse.onerror = function () {
            if (onError) onError();
          };
        } catch (e) {}
      }

      startWs();
    }

    return {
      close: function () {
        closed = true;
        if (ws) { try { ws.close(); } catch (e) {} ws = null; }
        if (sse) { try { sse.close(); } catch (e) {} sse = null; }
        if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
      }
    };
  }

  function createHostRelay(code) {
    var topic = getRelayTopic(code);
    var virtualConns = new Map();

    var sub = relaySubscribe(topic, function (env) {
      if (!env || env.from === "host") return;
      if (env.to !== "host" && env.to !== "*") return;

      var fromId = env.from;
      var vConn = virtualConns.get(fromId);

      if (!vConn) {
        var handlers = { data: [], close: [], error: [], open: [] };
        vConn = {
          open: true,
          peer: fromId,
          send: function (payload) {
            relayPublish(topic, { from: "host", to: fromId, p: payload });
          },
          on: function (evt, fn) {
            if (!handlers[evt]) handlers[evt] = [];
            handlers[evt].push(fn);
            if (evt === "open") setTimeout(fn, 10);
          },
          close: function () {
            vConn.open = false;
            virtualConns.delete(fromId);
            if (handlers.close) handlers.close.forEach(function (f) { f(); });
          },
          _trigger: function (evt, arg) {
            if (handlers[evt]) handlers[evt].forEach(function (f) { f(arg); });
          }
        };
        virtualConns.set(fromId, vConn);
        hostOnConnection(vConn);
      }

      if (env.p) {
        vConn._trigger("data", env.p);
      }
    });

    return {
      topic: topic,
      broadcast: function (payload) {
        relayPublish(topic, { from: "host", to: "*", p: payload });
      },
      destroy: function () {
        sub.close();
        virtualConns.forEach(function (c) { c.close(); });
        virtualConns.clear();
      }
    };
  }

  function createPlayerRelay(code, myName) {
    var topic = getRelayTopic(code);
    var myId = "p_" + Math.random().toString(36).slice(2, 9);
    var handlers = { data: [], close: [], error: [], open: [] };

    var sub = relaySubscribe(topic, function (env) {
      if (!env || env.from === myId) return;
      if (env.to === myId || env.to === "*") {
        if (env.p) {
          if (env.p.t === "host_left") {
            if (handlers.close) handlers.close.forEach(function (f) { f(); });
            return;
          }
          if (handlers.data) {
            handlers.data.forEach(function (f) { f(env.p); });
          }
        }
      }
    });

    var conn = {
      open: true,
      peer: "host",
      send: function (payload) {
        relayPublish(topic, { from: myId, to: "host", p: payload });
      },
      on: function (evt, fn) {
        if (!handlers[evt]) handlers[evt] = [];
        handlers[evt].push(fn);
        if (evt === "open") setTimeout(fn, 50);
      },
      close: function () {
        conn.open = false;
        sub.close();
        if (handlers.close) handlers.close.forEach(function (f) { f(); });
      }
    };

    return conn;
  }

  function joinUrlFor(code) {
    var base = location.href.split("?")[0].split("#")[0].replace(/index\.html$/, "");
    if (!base.endsWith("/")) base += "/";
    var params = ["room=" + encodeURIComponent(code)];
    if (S.netMode === "lan") {
      params.push("net=lan");
      if (S.lanHost) params.push("lan_host=" + encodeURIComponent(S.lanHost));
    }
    return base + "?" + params.join("&");
  }

  function renderQR() {
    ensureQR()
      .then(function () {
        var qr = window.qrcode(0, "M");
        qr.addData(S.joinUrl);
        qr.make();
        $("qr-holder").innerHTML = qr.createImgTag(5, 8);
      })
      .catch(function () {
        $("qr-holder").innerHTML =
          '<span class="mp-dim">QR code indisponible — partage le code : <strong>' +
          esc(S.code) + "</strong></span>";
      });
  }

  function hostOnConnection(conn) {
    if (S.started) {
      conn.on("open", function () {
        conn.send({ t: "e", m: "La partie a déjà commencé." });
        setTimeout(function () { try { conn.close(); } catch (e) {} }, 500);
      });
      return;
    }
    var joined = null;
    conn.on("open", function () { /* attend le message « j » */ });
    conn.on("data", function (msg) {
      if (!msg || typeof msg !== "object") return;
      if (msg.t === "j" && !joined) {
        joined = {
          pid: S.nextPid++,
          n: sanitizeName(msg.n),
          conn: conn,
          gone: false
        };
        S.players.push(joined);
        try { conn.send({ t: "W", pid: joined.pid }); } catch (e) {}
        broadcastLobby();
        setStatus($("lobby-status"), joined.n + " a rejoint la partie !", "is-ok");
        track("multiplayer_player_join", { players: activePlayers().length });
      } else if (msg.t === "A" && joined) {
        hostOnAnswer(joined.pid, msg.a);
      } else if (msg.t === "N" && joined) {
        hostNextFor(joined.pid);
      } else if (msg.t === "U" && joined) {
        // Mise à jour du pseudo tant que la partie n'a pas commencé.
        if (!S.started) {
          joined.n = sanitizeName(msg.n);
          broadcastLobby();
          setStatus($("lobby-status"), joined.n + " a changé de pseudo.", "is-ok");
        }
      }
    });
    function drop() {
      if (!joined) return;
      if (S.started) {
        joined.gone = true;
        if (S.mode === 1 && S.phase === "answering") {
          if (!S.answers[joined.pid]) maybeAutoReveal();
          if (S.phase === "answering") refreshForceBtn();
        }
        broadcast({ t: "B", lb: buildLeaderboard() });
        renderLb(buildLeaderboard());
        updateHostAggregates();
      } else {
        S.players = S.players.filter(function (p) { return p.pid !== joined.pid; });
        broadcastLobby();
      }
      renderPlayers();
    }
    conn.on("close", drop);
    conn.on("error", drop);
  }

  function broadcast(msg) {
    if (S.relay) {
      S.relay.broadcast(msg);
      return;
    }
    S.players.forEach(function (p) {
      if (p.gone || !p.conn || !p.conn.open) return;
      try { p.conn.send(msg); } catch (e) {}
    });
  }

  function sendTo(pid, msg) {
    var p = S.players.find(function (x) { return x.pid === pid; });
    if (!p || p.gone || !p.conn || !p.conn.open) return;
    try { p.conn.send(msg); } catch (e) {}
  }

  function broadcastLobby() {
    broadcast({
      t: "L",
      hostPlays: S.hostAsPlayer,
      hostName: S.hostName || "Hôte",
      players: S.players
        .filter(function (p) { return !p.isHost; })
        .map(function (p) { return { pid: p.pid, n: p.n, gone: p.gone }; })
    });
    renderPlayers();
  }

  /* ============================================================
     HOST — sélection multiple des quiz & réglages
     ============================================================ */
  var selectedQuizIds = new Set();

  function getSelectedQuizIds() {
    return Array.from(selectedQuizIds);
  }

  function populateQuizSelect(cfg) {
    CFG.subjects = cfg.subjects || [];
    CFG.quizzes = cfg.quizzes || [];

    // Matières disponibles
    var bySubject = {};
    CFG.quizzes.forEach(function (q) {
      if (!bySubject[q.subject]) bySubject[q.subject] = [];
      bySubject[q.subject].push(q);
    });
    var matSel = $("setup-matiere");
    if (matSel) {
      var matHtml = '<option value="__all__">🌍 Toutes les matières</option>';
      CFG.subjects.forEach(function (s) {
        if (!bySubject[s.id]) return;
        matHtml += '<option value="' + esc(s.id) + '">' +
          esc((s.icon || "📁") + " " + s.name) + " (" + bySubject[s.id].length + ")</option>";
      });
      matSel.innerHTML = matHtml;
      matSel.onchange = renderQuizList;
    }

    // Par défaut, si aucun quiz sélectionné, sélectionner le premier quiz
    if (selectedQuizIds.size === 0 && CFG.quizzes.length > 0) {
      selectedQuizIds.add(CFG.quizzes[0].id);
    }

    // Recherche
    var searchInput = $("setup-quiz-search");
    if (searchInput) {
      searchInput.oninput = renderQuizList;
    }

    // Boutons tout cocher / tout décocher
    var btnSelectAll = $("btn-select-all-quizzes");
    if (btnSelectAll) {
      btnSelectAll.onclick = function () {
        getCurrentlyFilteredQuizzes().forEach(function (q) {
          selectedQuizIds.add(q.id);
        });
        renderQuizList();
      };
    }
    var btnDeselectAll = $("btn-deselect-all-quizzes");
    if (btnDeselectAll) {
      btnDeselectAll.onclick = function () {
        getCurrentlyFilteredQuizzes().forEach(function (q) {
          selectedQuizIds.delete(q.id);
        });
        renderQuizList();
      };
    }

    // Rendu initial
    renderQuizList();
  }

  function getCurrentlyFilteredQuizzes() {
    var matSel = $("setup-matiere");
    var activeMat = matSel ? matSel.value : "__all__";
    var searchInput = $("setup-quiz-search");
    var query = searchInput ? searchInput.value.trim().toLowerCase() : "";

    var subjectsById = {};
    (CFG.subjects || []).forEach(function (s) { subjectsById[s.id] = s; });

    return (CFG.quizzes || []).filter(function (q) {
      if (activeMat !== "__all__" && q.subject !== activeMat) return false;
      if (query) {
        var t = (q.title || "").toLowerCase();
        var sName = subjectsById[q.subject] ? subjectsById[q.subject].name.toLowerCase() : "";
        if (!t.includes(query) && !sName.includes(query)) return false;
      }
      return true;
    });
  }

  function renderQuizList() {
    var container = $("setup-quizzes-list");
    if (!container) return;

    var subjectsById = {};
    (CFG.subjects || []).forEach(function (s) { subjectsById[s.id] = s; });

    var list = getCurrentlyFilteredQuizzes();

    if (list.length === 0) {
      container.innerHTML = '<div class="mp-dim" style="padding:0.8rem;text-align:center;">Aucun questionnaire trouvé.</div>';
    } else {
      var html = "";
      list.forEach(function (q) {
        var s = subjectsById[q.subject];
        var icon = (s && s.icon) ? s.icon : "📁";
        var isChecked = selectedQuizIds.has(q.id);
        var count = q.questionsCount || (q.cats ? countQuizQuestions(q.cats) : "?");
        var subName = s ? s.name : (q.subject === "__imported__" ? "Quiz importé" : q.subject || "Général");
        html += '<label class="mp-quiz-item' + (isChecked ? " is-checked" : "") + '" data-quiz-id="' + esc(q.id) + '">' +
          '<input type="checkbox" class="mp-quiz-checkbox" value="' + esc(q.id) + '"' + (isChecked ? " checked" : "") + ' />' +
          '<span class="mp-quiz-item-icon">' + esc(icon) + '</span>' +
          '<div class="mp-quiz-item-info">' +
            '<div class="mp-quiz-item-title">' + esc(q.title) + '</div>' +
            '<div class="mp-quiz-item-sub">' + esc(subName) + ' · ' + count + ' questions</div>' +
          '</div>' +
          '<span class="mp-quiz-badge">' + count + ' q</span>' +
        '</label>';
      });
      container.innerHTML = html;
    }

    container.querySelectorAll(".mp-quiz-checkbox").forEach(function (cb) {
      cb.onchange = function () {
        var id = cb.value;
        if (cb.checked) {
          selectedQuizIds.add(id);
        } else {
          selectedQuizIds.delete(id);
        }
        var item = cb.closest(".mp-quiz-item");
        if (item) item.classList.toggle("is-checked", cb.checked);
        updateQuizSummary();
      };
    });

    updateQuizSummary();
  }

  function updateQuizSummary() {
    var countEl = $("setup-quizzes-count");
    var totalEl = $("setup-quizzes-total-questions");
    var catField = $("setup-cat-field");
    var nSelected = selectedQuizIds.size;

    if (countEl) {
      countEl.textContent = nSelected + " questionnaire" + (nSelected > 1 ? "s" : "") + " sélectionné" + (nSelected > 1 ? "s" : "");
    }

    var totalQuestions = 0;
    var selectedList = (CFG.quizzes || []).filter(function (q) { return selectedQuizIds.has(q.id); });
    selectedList.forEach(function (q) {
      totalQuestions += (q.questionsCount || (q.cats ? countQuizQuestions(q.cats) : 0));
    });
    S.totalAvailable = totalQuestions;

    if (totalEl) {
      totalEl.textContent = "(" + totalQuestions + " question" + (totalQuestions > 1 ? "s" : "") + " au total)";
    }

    // Gestion du champ catégorie
    if (nSelected === 1) {
      if (catField) catField.classList.remove("hidden");
      populateCatSelectFor(selectedList[0].id);
    } else {
      if (catField) {
        var catSel = $("setup-cat");
        if (nSelected > 1) {
          catField.classList.remove("hidden");
          if (catSel) catSel.innerHTML = '<option value="all">🎲 Toutes les catégories de tous les quiz sélectionnés</option>';
        } else {
          catField.classList.add("hidden");
        }
      }
    }

    updateLimitHint();

    var btnStart = $("btn-start");
    if (btnStart) {
      btnStart.disabled = (nSelected === 0 || activePlayers().length < 1);
    }
  }

  function populateCatSelectFor(quizId) {
    var catSel = $("setup-cat");
    if (!catSel || !quizId) return;
    catSel.innerHTML = '<option value="all">⏳ Chargement des catégories…</option>';
    loadQuizCats(quizId)
      .then(function (entry) {
        var html = '<option value="all">🎲 Toutes les catégories (mélange)</option>';
        entry.cats.forEach(function (c, i) {
          html += '<option value="' + i + '">' + esc(c.name) + " (" + c.questions.length + " q)</option>";
        });
        catSel.innerHTML = html;
        setStatus($("setup-status"), "");
      })
      .catch(function (err) {
        catSel.innerHTML = '<option value="all">Toutes les catégories</option>';
      });
  }

  function updateLimitHint() {
    var hint = $("setup-limit-hint");
    var input = $("setup-limit-input");
    if (!hint || !input) return;
    var total = S.totalAvailable || 0;
    var currentVal = parseInt(input.value, 10);

    if (isNaN(currentVal) || currentVal <= 0) {
      hint.textContent = "Toutes les questions seront jouées (total : " + total + " questions).";
    } else if (currentVal > total && total > 0) {
      hint.textContent = "Tu as demandé " + currentVal + " questions, mais seulement " + total + " sont disponibles : toutes les " + total + " seront jouées.";
    } else {
      hint.textContent = "Exactement " + currentVal + " question" + (currentVal > 1 ? "s seront tirées" : " sera tirée") + " au hasard parmi les " + total + " disponibles.";
    }

    document.querySelectorAll(".mp-preset-btn").forEach(function (btn) {
      var val = btn.dataset.val;
      if (val === "all" || val === "max") {
        btn.classList.toggle("active", currentVal >= total && total > 0);
      } else {
        btn.classList.toggle("active", Number(val) === currentVal);
      }
    });
  }

  function buildPool() {
    var quizIds = getSelectedQuizIds();
    if (!quizIds || quizIds.length === 0) {
      return Promise.reject(new Error("Choisis au moins un questionnaire."));
    }
    var scope = $("setup-cat") ? $("setup-cat").value : "all";
    var limitInput = $("setup-limit-input");
    var limit = limitInput ? parseInt(limitInput.value, 10) : 20;
    if (isNaN(limit) || limit <= 0) limit = 0; // 0 = toutes

    return Promise.all(quizIds.map(function (qid) {
      return loadQuizCats(qid);
    })).then(function (entries) {
      var allQs = [];
      var titles = [];

      entries.forEach(function (entry) {
        titles.push(entry.meta.title);
        if (entries.length === 1 && scope !== "all") {
          var catIndex = Number(scope);
          if (entry.cats[catIndex] && entry.cats[catIndex].questions) {
            allQs = allQs.concat(entry.cats[catIndex].questions);
          }
        } else {
          entry.cats.forEach(function (c) {
            if (c.questions) allQs = allQs.concat(c.questions);
          });
        }
      });

      if (allQs.length === 0) {
        throw new Error("Aucune question dans la sélection.");
      }

      var shuffled = shuffle(allQs.slice());
      if (limit > 0 && shuffled.length > limit) {
        shuffled = shuffled.slice(0, limit);
      }

      var summaryTitle = "";
      if (entries.length === 1) {
        summaryTitle = entries[0].meta.title;
      } else {
        summaryTitle = entries.length + " questionnaires combinés";
      }

      var catLabel = "";
      if (entries.length === 1 && scope !== "all") {
        var catIndex = Number(scope);
        catLabel = entries[0].cats[catIndex] ? entries[0].cats[catIndex].name : "Catégorie";
      } else if (entries.length === 1) {
        catLabel = "Toutes les catégories";
      } else {
        catLabel = entries.length + " quiz (" + shuffled.length + " questions)";
      }

      return {
        pool: shuffled,
        meta: { title: summaryTitle },
        catLabel: catLabel
      };
    });
  }

  function setHostAsPlayer(on) {
    if (S.started) return;
    S.hostAsPlayer = on;
    var exists = S.players.some(function (p) { return p.pid === HOST_PID; });
    if (on && !exists) {
      S.players.push({ pid: HOST_PID, n: S.hostName || "Hôte", conn: null, gone: false, isHost: true });
    } else if (!on && exists) {
      S.players = S.players.filter(function (p) { return p.pid !== HOST_PID; });
    }
    renderPlayers();
    broadcastLobby();
  }

  function hostStart() {
    if (S.started) return;
    var act = activePlayers();
    if (act.length < 1) {
      setStatus($("setup-status"), "Il faut au moins 1 joueur pour lancer.", "is-error");
      return;
    }
    setStatus($("setup-status"), "Préparation de la partie…");
    $("btn-start").disabled = true;

    buildPool()
      .then(function (built) {
        S.started = true;
        S.mode = Number(document.querySelector(".mp-mode.active").dataset.mode);
        S.quizTitle = built.meta.title;
        S.catLabel = built.catLabel;
        S.pool = built.pool;
        S.round = 0;
        S.phase = "answering";
        S.answers = {};
        S.correctByR = {};
        S.scores = {};
        S.assigns = {};
        S.assignLen = {};
        S.cursor = {};
        S.curQ = {};
        S.lbPrev = {};
        act.forEach(function (p) { scoreOf(p.pid); });

        if (S.mode === 2) {
          var lists = assignQuestions(S.pool, act.length);
          act.forEach(function (p, i) {
            S.assigns[p.pid] = lists[i];
            S.assignLen[p.pid] = lists[i].length;
            S.cursor[p.pid] = 0;
          });
        }

        // Message de démarrage (total propre à chaque joueur en mode 2)
        if (S.mode === 1) {
          broadcast({
            t: "S",
            mode: S.mode,
            title: S.quizTitle,
            catLabel: S.catLabel,
            total: S.pool.length
          });
        } else {
          act.forEach(function (p) {
            sendTo(p.pid, {
              t: "S",
              mode: S.mode,
              title: S.quizTitle,
              catLabel: S.catLabel,
              total: S.assignLen[p.pid]
            });
          });
        }

        showScreen("screen-game");
        $("g-quiz").textContent = S.quizTitle + " · " + S.catLabel;
        $("g-mode").textContent = S.mode === 1 ? "🙋 Même question" : "🔀 Questions différentes";
        $("g-host-note").classList.toggle("hidden", S.hostAsPlayer);
        $("g-side-note").classList.toggle("hidden", S.mode !== 2);
        resetQuestionUI();

        setTimeout(function () {
          if (S.mode === 1) {
            hostSendSharedQuestion();
          } else {
            if (!S.hostAsPlayer) {
              setMainBtn({
                which: "next",
                label: "🏆 Afficher les scores finaux",
                cls: "is-final",
                onclick: hostFinish
              });
              updateRoundLabel("");
            }
            act.forEach(function (p) { hostSendNextQuestion(p.pid); });
            updateHostAggregates();
            renderLb(buildLeaderboard());
            broadcast({ t: "B", lb: buildLeaderboard() });
          }
        }, 150);
        setStatus($("setup-status"), "");
        track("multiplayer_start", { mode: S.mode, questions: S.pool.length, players: act.length });
      })
      .catch(function (err) {
        $("btn-start").disabled = false;
        setStatus($("setup-status"), err.message, "is-error");
      });
  }

  /* ============================================================
     HOST — mode 1 : même question
     ============================================================ */
  function hostSendSharedQuestion() {
    var q = S.pool[S.round];
    S.answers = {};
    S.phase = "answering";
    resetQuestionUI();
    updateRoundLabel("Question " + (S.round + 1) + " / " + S.pool.length);
    updateProgress(0);
    renderQuestionInto(publicQ(q), S.hostAsPlayer);
    updateSubInfo("Réponses reçues : 0 / " + activePlayers().length);
    broadcast({
      t: "Q",
      r: S.round,
      n: S.pool.length,
      q: publicQ(q),
      title: S.quizTitle,
      catLabel: S.catLabel,
      mode: S.mode
    });
    setMainBtn({
      which: "next",
      label: "Forcer le passage ▶ (0/" + activePlayers().length + ")",
      cls: "is-force",
      onclick: function () { hostReveal(); }
    });
    var lb0 = buildLeaderboard();
    renderLb(lb0);
  }

  function hostOnAnswer(pid, a) {
    if (S.mode === 1) {
      if (S.phase !== "answering" || S.answers[pid]) return;
      var q = S.pool[S.round];
      S.answers[pid] = { a: a, ok: judge(q, a), t: Date.now() };
      var act = activePlayers();
      var done = act.filter(function (p) { return S.answers[p.pid]; }).length;
      broadcast({ t: "P", d: done, total: act.length });
      updateSubInfo("Réponses reçues : " + done + " / " + act.length);
      updateProgress(act.length ? (done / act.length) * 100 : 0);
      setMainBtn({
        which: "next",
        label: "Forcer le passage ▶ (" + done + "/" + act.length + ")",
        cls: "is-force",
        onclick: function () { hostReveal(); }
      });
      maybeAutoReveal();
    } else {
      var cq = S.curQ[pid];
      if (!cq || cq.answered) return;
      cq.answered = true;
      var ok = judge(cq.q, a);
      var sc = scoreOf(pid);
      // Rang de rapidité par étape (r) : les bonnes réponses à la même
      // question partagent le même groupe de classement.
      var rank = 1;
      if (ok) {
        rank = (S.correctByR[cq.r] || 0) + 1;
        S.correctByR[cq.r] = rank;
      }
      sc.score += answerPoints(ok, rank);
      sc.done = cq.r + 1;
      var more = cq.r + 1 < (S.assignLen[pid] || 0);
      if (pid === HOST_PID) {
        // Hôte-joueur : feedback + bouton suivant en local.
        renderFeedback(ok, correctLabel(cq.q), cq.q.solution || "");
        if (more) {
          setMainBtn({
            which: "next",
            label: "Question suivante ▶",
            onclick: function () { hostNextFor(HOST_PID); }
          });
        } else {
          setMainBtn({
            which: "next",
            label: "🏆 Afficher les scores finaux",
            cls: "is-final",
            onclick: hostFinish
          });
        }
      } else {
        sendTo(pid, {
          t: "J",
          ok: ok,
          correct: correctLabel(cq.q),
          solution: cq.q.solution || "",
          score: sc.score,
          more: more
        });
      }
      var lb = buildLeaderboard();
      broadcast({ t: "B", lb: lb });
      renderLb(lb);
      updateHostAggregates();
      var act2 = activePlayers();
      var allDone = act2.length > 0 && act2.every(function (p) {
        return (S.scores[p.pid] || { done: 0 }).done >= (S.assignLen[p.pid] || 0);
      });
      if (allDone) hostFinish();
    }
  }

  function refreshForceBtn() {
    if (S.mode !== 1 || S.phase !== "answering") return;
    var act = activePlayers();
    var done = act.filter(function (p) { return S.answers[p.pid]; }).length;
    updateSubInfo("Réponses reçues : " + done + " / " + act.length);
    setMainBtn({
      which: "next",
      label: "Forcer le passage ▶ (" + done + "/" + act.length + ")",
      cls: "is-force",
      onclick: function () { hostReveal(); }
    });
  }

  function maybeAutoReveal() {
    var act = activePlayers();
    if (S.phase !== "answering" || act.length === 0) return;
    var all = act.every(function (p) { return !!S.answers[p.pid]; });
    if (all) hostReveal();
  }

  function hostReveal() {
    if (S.phase !== "answering") return;
    S.phase = "reveal";
    var q = S.pool[S.round];
    var act = activePlayers();
    // Rang de rapidité : 1er arrivé parmi les bonnes réponses.
    var correctOrder = act
      .filter(function (p) { return S.answers[p.pid] && S.answers[p.pid].ok; })
      .sort(function (a, b) { return S.answers[a.pid].t - S.answers[b.pid].t; });
    var rankOf = {};
    correctOrder.forEach(function (p, i) { rankOf[p.pid] = i + 1; });
    var rows = [];
    act.forEach(function (p) {
      var ans = S.answers[p.pid];
      if (ans) {
        ans.pts = answerPoints(ans.ok, rankOf[p.pid]);
        scoreOf(p.pid).score += ans.pts;
        scoreOf(p.pid).done++;
      }
      rows.push({
        n: p.n,
        ans: ans ? answerLabel(q, ans.a) : null,
        ok: ans ? ans.ok : false,
        pts: ans ? ans.pts : 0
      });
    });
    var lb = buildLeaderboard();
    var payload = { rows: rows, correct: correctLabel(q), solution: q.solution || "", lb: lb };
    renderReveal(payload);
    renderLb(lb);
    lockQuestionUI();
    $("g-submit").classList.add("hidden");
    $("g-wait").classList.add("hidden");
    broadcast({ t: "V", rows: rows, correct: payload.correct, solution: payload.solution, lb: lb });
    updateSubInfo("Résultats de la question " + (S.round + 1) + " / " + S.pool.length);
    updateProgress(100);
    var last = S.round + 1 >= S.pool.length;
    setMainBtn({
      which: "next",
      label: last ? "🏆 Afficher les scores finaux" : "Question suivante ▶",
      cls: last ? "is-final" : "",
      onclick: last ? hostFinish : hostNextQuestion
    });
    track("multiplayer_reveal", { round: S.round + 1 });
  }

  function hostNextQuestion() {
    if (S.mode !== 1) return;
    S.round++;
    if (S.round >= S.pool.length) { hostFinish(); return; }
    hostSendSharedQuestion();
    renderLb(buildLeaderboard());
    broadcast({ t: "B", lb: buildLeaderboard() });
  }

  /* ============================================================
     HOST — mode 2 : questions différentes
     ============================================================ */
  function hostSendNextQuestion(pid) {
    var list = S.assigns[pid] || [];
    var idx = S.cursor[pid] || 0;
    if (idx >= list.length) return;
    var q = list[idx];
    S.cursor[pid] = idx + 1;
    S.curQ[pid] = { q: q, r: idx, answered: false };
    if (pid === HOST_PID) {
      // Question de l'hôte-joueur : rendu local, interactive.
      resetQuestionUI();
      updateRoundLabel("Ta question " + (idx + 1) + " / " + list.length);
      renderQuestionInto(publicQ(q), true);
      updateSubInfo("");
      return;
    }
    sendTo(pid, {
      t: "Q",
      r: idx,
      n: list.length,
      q: publicQ(q),
      title: S.quizTitle,
      catLabel: S.catLabel,
      mode: S.mode
    });
  }

  function hostNextFor(pid) {
    if (S.mode !== 2 || !S.started) return;
    var cq = S.curQ[pid];
    if (cq && !cq.answered) return;   // doit d'abord répondre
    if (cq && cq.answered && S.cursor[pid] > cq.r + 1) return; // déjà envoyé
    hostSendNextQuestion(pid);
  }

  function updateHostAggregates() {
    if (S.mode !== 2 || !S.started) return;
    var act = activePlayers();
    var done = 0, total = 0, lines = "";
    act.forEach(function (p) {
      var sc = S.scores[p.pid] || { score: 0, done: 0 };
      var t = S.assignLen[p.pid] || 0;
      done += sc.done;
      total += t;
      lines +=
        '<div class="mp-lb-row"><span class="name">' + esc(p.n) + "</span>" +
        '<span class="prog">' + sc.done + "/" + t + "</span>" +
        '<span class="pts">' + fmtScore(sc.score) + " pts</span></div>";
    });
    updateSubInfo(
      act.length + " joueur" + (act.length > 1 ? "s" : "") +
      " en cours — " + done + " / " + total + " réponses données"
    );
    updateProgress(total ? (done / total) * 100 : 0);
    var note = $("g-side-note");
    note.innerHTML = "<strong>Progression</strong>" + lines;
  }

  /* ============================================================
     HOST — finale & sortie
     ============================================================ */
  function hostFinish() {
    if (!S.started) return;
    var lb = buildLeaderboard();
    broadcast({ t: "F", lb: lb });
    renderFinal(lb);
    track("multiplayer_finish", { mode: S.mode, players: activePlayers().length });
  }

  function renderFinal(lb) {
    showScreen("screen-final");
    $("final-sub").textContent =
      S.quizTitle + " · " + S.catLabel + " · " +
      (S.mode === 1 ? "mode même question" : "mode questions différentes");

    var medals = ["🥇", "🥈", "🥉"];
    var classes = ["first", "second", "third"];
    var podium = "";
    lb.slice(0, 3).forEach(function (e, i) {
      podium +=
        '<div class="pod ' + classes[i] + '">' +
          '<span class="medal">' + medals[i] + "</span>" +
          '<span class="who">' + esc(e.n) + "</span>" +
          '<span class="pts" data-score="' + e.score + '">0 pts</span>' +
          '<span class="extra">' + e.done + "/" + e.total + " réponses" + (e.out ? " · déconnecté" : "") + "</span>" +
        "</div>";
    });
    $("podium").innerHTML = podium;

    var html = '<table class="mp-table"><tr><th>Rang</th><th>Joueur</th><th>Score</th><th>Progression</th></tr>';
    lb.forEach(function (e, i) {
      html +=
        "<tr><td>" + (i < 3 ? medals[i] : i + 1) + "</td>" +
        "<td>" + esc(e.n) + (e.out ? " 🔌" : "") + "</td>" +
        '<td><strong class="mp-score" data-score="' + e.score + '">0 pts</strong></td>' +
        "<td>" + e.done + " / " + e.total + "</td></tr>";
    });
    html += "</table>";
    $("final-table").innerHTML = html;

    // Compteurs animés (podium + tableau) puis confettis
    $("podium").querySelectorAll(".pts[data-score]").forEach(function (el) {
      countUp(el, Number(el.getAttribute("data-score")) || 0, " pts");
    });
    $("final-table").querySelectorAll(".mp-score[data-score]").forEach(function (el) {
      countUp(el, Number(el.getAttribute("data-score")) || 0, " pts");
    });
    confettiBurst();
    track("multiplayer_final_anim");
  }

  function hostResetToLobby() {
    S.started = false;
    S.round = 0;
    S.phase = "idle";
    S.answers = {};
    S.correctByR = {};
    S.scores = {};
    S.assigns = {};
    S.assignLen = {};
    S.cursor = {};
    S.curQ = {};
    broadcast({ t: "R" });
    showScreen("screen-lobby");
    $("btn-start").disabled = activePlayers().length < 1;
    $("btn-start").textContent = "🚀 Lancer la partie";
    setStatus($("lobby-status"), "Partie terminée — réglage d'une nouvelle partie.");
    renderPlayers();
  }

  function leaveParty() {
    try { if (S.peer) S.peer.destroy(); } catch (e) {}
    S.peer = null;
    S.role = null;
    S.started = false;
    S.players = [];
    S.code = null;
    S.myPid = null;
    showScreen("screen-home");
    setStatus($("home-status"), "");
  }

  /* ============================================================
     CLIENT
     ============================================================ */
  function clientJoin() {
    if (!navigator.onLine && S.netMode !== "lan") {
      setStatus($("home-status"), "Connexion Internet requise en mode Internet. Pour jouer hors-ligne, sélectionne 'Réseau Local (LAN)'.", "is-error");
      return;
    }
    if (!coreReady()) {
      setStatus($("home-status"), "Chargement du moteur de quiz impossible (js/quiz.js).", "is-error");
      return;
    }
    var code = $("join-code").value.trim().toUpperCase();
    var name = sanitizeName($("join-name").value);
    if (code.length !== 5) {
      setStatus($("home-status"), "Le code comporte 5 caractères.", "is-error");
      return;
    }
    $("btn-join").disabled = true;
    var netNote = S.netMode === "lan" ? "en LAN" : "";
    setStatus($("home-status"), "Connexion à la partie " + code + " " + netNote + "…");
    track("multiplayer_join_attempt", { netMode: S.netMode });

    if (S.conn) { try { S.conn.close(); } catch (e) {} }
    var conn = createPlayerRelay(code, name);
    S.conn = conn;

    var settled = false;
    var timer = setTimeout(function () {
      if (!settled) {
        settled = true;
        try { conn.close(); } catch (e) {}
        S.conn = null;
        $("btn-join").disabled = false;
        setStatus($("home-status"), "Timeout : la partie est introuvable ou fermée.", "is-error");
      }
    }, 12000);

    conn.on("open", function () {
      conn.send({ t: "j", n: name });
    });

    conn.on("data", function (msg) {
      if (msg && msg.t === "W") {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          S.role = "client";
          S.myName = name;
          $("btn-join").disabled = false;
          setStatus($("home-status"), "");
          showScreen("screen-lobby");
          $("host-setup").classList.add("hidden");
          $("client-wait").classList.remove("hidden");
          $("qr-holder").classList.add("hidden");
          $("btn-copy").classList.add("hidden");
          $("lobby-title").textContent = "Connecté à la partie !";
          $("room-code").textContent = code;
          $("player-list").innerHTML = '<span class="mp-player-chip is-host">🎛️ Hôte</span>';
          $("player-count").textContent = "…";
          setStatus($("lobby-status"), "En attente de l'hôte pour le début de la partie…");
          track("multiplayer_join_ok");
        }
      }
      onServerMsg(msg);
    });

    conn.on("close", function () {
      if (S.role === "client") {
        resetToHome("L'hôte a quitté la partie.");
      }
    });

    conn.on("error", function () {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        try { conn.close(); } catch (e) {}
        S.conn = null;
        $("btn-join").disabled = false;
        setStatus($("home-status"), "Impossible de joindre la partie.", "is-error");
      } else {
        resetToHome("Connexion perdue.");
      }
    });
  }

  function resetToHome(msg) {
    stopScanner();
    if (S.relay && S.role === "host") {
      try { S.relay.broadcast({ t: "host_left" }); } catch (e) {}
      try { S.relay.destroy(); } catch (e) {}
      S.relay = null;
    }
    if (S.conn) {
      try { S.conn.close(); } catch (e) {}
      S.conn = null;
    }
    try { if (S.peer) S.peer.destroy(); } catch (e) {}
    S.peer = null;
    S.role = null;
    S.started = false;
    S.myPid = null;
    closeRename();
    showScreen("screen-home");
    setStatus($("home-status"), msg || "", msg ? "is-error" : "");
  }

  function backToLobbyWait() {
    S.started = false;
    S.clientQ = null;
    closeRename();
    showScreen("screen-lobby");
    $("client-wait").classList.remove("hidden");
    setStatus($("lobby-status"), "L'hôte prépare une nouvelle partie…");
  }

  /* Modification du pseudo depuis l'écran d'attente du joueur. */
  function openRename() {
    var form = $("rename-form");
    var input = $("rename-input");
    if (!form || !input) return;
    input.value = S.myName || "";
    form.classList.remove("hidden");
    $("btn-rename").classList.add("hidden");
    input.focus();
    input.select();
  }

  function closeRename() {
    var form = $("rename-form");
    var btn = $("btn-rename");
    if (form) form.classList.add("hidden");
    if (btn) btn.classList.remove("hidden");
  }

  function applyRename() {
    var input = $("rename-input");
    if (!input) return;
    var name = sanitizeName(input.value);
    S.myName = name;
    if (S.conn && S.conn.open) S.conn.send({ t: "U", n: name });
    closeRename();
    setStatus($("lobby-status"), "Pseudo changé en « " + name + " ».", "is-ok");
    track("multiplayer_rename");
  }

  function onServerMsg(msg) {
    if (!msg || typeof msg !== "object") return;
    switch (msg.t) {
      case "W":
        S.myPid = msg.pid;
        break;

      case "e":
        resetToHome(msg.m);
        break;

      case "L": {
        var hostLabel = esc(msg.hostName || "Hôte");
        var hostChip = msg.hostPlays
          ? '<span class="mp-player-chip is-host is-playing">🎛️ ' + hostLabel + ' <span class="mp-chip">joueur</span></span>'
          : '<span class="mp-player-chip is-host">🎛️ ' + hostLabel + '</span>';
        var html = hostChip;
        (msg.players || []).forEach(function (p) {
          var cls = "mp-player-chip";
          if (p.pid === S.myPid) cls += " is-me";
          if (p.gone) cls += " is-out";
          html += '<span class="' + cls + '">🎮 ' + esc(p.n) + "</span>";
        });
        $("player-list").innerHTML = html;
        var alive = (msg.players || []).filter(function (p) { return !p.gone; }).length +
          (msg.hostPlays ? 1 : 0);
        $("player-count").textContent = String(alive);
        break;
      }

      case "S": {
        S.started = true;
        S.mode = msg.mode;
        S.quizTitle = msg.title;
        S.catLabel = msg.catLabel;
        showScreen("screen-game");
        if (msg.title) $("g-quiz").textContent = msg.title + (msg.catLabel ? " · " + msg.catLabel : "");
        if (msg.mode) $("g-mode").textContent = S.mode === 1 ? "🙋 Même question" : "🔀 Questions différentes";
        $("g-host-note").classList.add("hidden");
        $("g-side-note").classList.add("hidden");
        // Si une question est déjà arrivée et affichée, ne pas la détruire !
        if (!S.clientQ) {
          S.clientQ = null;
          S.clientDone = false;
          S.lastProg = "0/0";
          S.lbPrev = {};
          resetQuestionUI();
          updateProgress(0);
        }
        $("g-lb").innerHTML = '<p class="mp-dim">Le classement s\'affichera ici.</p>';
        break;
      }

      case "Q": {
        S.started = true;
        showScreen("screen-game");
        if (msg.title) S.quizTitle = msg.title;
        if (msg.catLabel) S.catLabel = msg.catLabel;
        if (msg.mode) S.mode = msg.mode;
        if (S.quizTitle) $("g-quiz").textContent = S.quizTitle + (S.catLabel ? " · " + S.catLabel : "");
        if (S.mode) $("g-mode").textContent = S.mode === 1 ? "🙋 Même question" : "🔀 Questions différentes";
        $("g-host-note").classList.add("hidden");
        $("g-side-note").classList.add("hidden");

        S.clientQ = { r: msg.r, n: msg.n, q: msg.q, submitted: false };
        S.clientDone = false;
        resetQuestionUI();
        updateRoundLabel(
          S.mode === 1
            ? "Question " + (msg.r + 1) + " / " + msg.n
            : "Ta question " + (msg.r + 1) + " / " + msg.n
        );
        updateSubInfo(S.mode === 1 ? "Réponds puis attends les autres joueurs." : "");
        updateProgress(msg.n ? ((msg.r) / msg.n) * 100 : 0);
        renderQuestionInto(msg.q, true);
        break;
      }

      case "P":
        S.lastProg = msg.d + "/" + (msg.total != null ? msg.total : msg.t);
        if (S.clientQ && S.clientQ.submitted) {
          $("g-wait").textContent =
            "✅ Réponse envoyée ! En attente des autres joueurs… (" + S.lastProg + ")";
        }
        break;

      case "V":
        if (S.clientQ) S.clientQ.submitted = true;
        lockQuestionUI();
        setMainBtn({ which: "none" });
        $("g-wait").classList.add("hidden");
        renderReveal(msg);
        if (msg.lb) renderLb(msg.lb);
        break;

      case "J": {
        $("g-wait").classList.add("hidden");
        renderFeedback(msg.ok, msg.correct, msg.solution);
        updateProgress(S.clientQ && S.clientQ.n
          ? ((S.clientQ.r + 1) / S.clientQ.n) * 100 : 100);
        if (msg.more) {
          setMainBtn({
            which: "next",
            label: "Question suivante ▶",
            onclick: function () {
              setMainBtn({ which: "none" });
              $("g-wait").textContent = "⏳ Chargement de ta question suivante…";
              $("g-wait").classList.remove("hidden");
              if (S.conn && S.conn.open) S.conn.send({ t: "N" });
            }
          });
        } else {
          S.clientDone = true;
          setMainBtn({ which: "none" });
          $("g-wait").textContent =
            "🏁 Terminé ! Score : " + fmtScore(msg.score) + " pts — en attente des autres joueurs…";
          $("g-wait").classList.remove("hidden");
        }
        break;
      }

      case "B":
        if (msg.lb) renderLb(msg.lb);
        break;

      case "F":
        S.started = false;
        renderFinal(msg.lb || []);
        break;

      case "R":
        backToLobbyWait();
        break;

      case "X":
        resetToHome("La partie a été fermée par l'hôte.");
        break;
    }
  }

  /* ============================================================
     Actions joueur
     ============================================================ */
  function readAnswerFromUI() {
    var sel = document.querySelector("#mp-options .answer-btn.selected");
    if (sel) return Number(sel.dataset.i);
    var input = $("mp-text-answer");
    if (input && input.value.trim()) return input.value.trim();
    return null;
  }

  // L'hôte qui joue soumet sa réponse localement (pas de S.conn).
  function hostSubmitAnswer() {
    var a = readAnswerFromUI();
    if (a === null) return;
    lockQuestionUI();
    setMainBtn({ which: "none" });
    hostOnAnswer(HOST_PID, a);
    if (S.mode === 1) {
      // si tout le monde a répondu, hostOnAnswer a déjà révélé ; sinon on attend
      if (S.phase === "answering") {
        $("g-wait").textContent = "✅ Ta réponse est enregistrée ! En attente des autres…";
        $("g-wait").classList.remove("hidden");
      }
    }
  }

  function playerSubmit() {
    if (S.role === "host") hostSubmitAnswer();
    else submitAnswer();
  }

  function submitAnswer() {
    var cq = S.clientQ;
    if (!cq || cq.submitted || !S.conn || !S.conn.open) return;
    var a = readAnswerFromUI();
    if (a === null) return;
    cq.submitted = true;
    lockQuestionUI();
    setMainBtn({ which: "none" });
    S.conn.send({ t: "A", a: a });
    $("g-wait").textContent =
      S.mode === 1
        ? "✅ Réponse envoyée ! En attente des autres joueurs… (" + S.lastProg + ")"
        : "✅ Réponse envoyée ! Correction…";
    $("g-wait").classList.remove("hidden");
  }

  /* ============================================================
     SCANNER QR — rejoindre une partie en scannant le QR de l'hôte.
     BarcodeDetector (natif, Chrome/Android) si dispo, sinon jsQR (CDN).
     ============================================================ */
  var scan = { stream: null, raf: 0, timer: 0, detector: null, canvas: null, ctx: null, active: false };

  function scanStatus(msg, cls) {
    var el = $("scan-status");
    if (!el) return;
    el.textContent = msg;
    el.className = "mp-status" + (cls ? " " + cls : "");
  }

  function loadJsQR() {
    if (window.jsQR) return Promise.resolve(window.jsQR);
    var urls = [
      "https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js",
      "https://unpkg.com/jsqr@1.4.0/dist/jsQR.js"
    ];
    return new Promise(function (resolve, reject) {
      function tryLoad(i) {
        if (i >= urls.length) {
          reject(new Error("Scanner indisponible — saisis le code manuellement."));
          return;
        }
        var s = document.createElement("script");
        s.src = urls[i];
        s.onload = function () {
          if (window.jsQR) resolve(window.jsQR);
          else tryLoad(i + 1);
        };
        s.onerror = function () { tryLoad(i + 1); };
        document.head.appendChild(s);
      }
      tryLoad(0);
    });
  }

  function stopScanner() {
    scan.active = false;
    if (scan.raf) cancelAnimationFrame(scan.raf);
    if (scan.timer) clearTimeout(scan.timer);
    scan.raf = 0;
    scan.timer = 0;
    scan.detector = null;
    if (scan.stream) {
      scan.stream.getTracks().forEach(function (t) { t.stop(); });
      scan.stream = null;
    }
    var v = $("scan-video");
    if (v) v.srcObject = null;
  }

  function closeScanner() {
    stopScanner();
    var ov = $("scan-overlay");
    if (ov) ov.classList.add("hidden");
    scanStatus("Ouverture de la caméra…");
  }

  function tickDetector() {
    if (!scan.stream || !scan.detector) return;
    var video = $("scan-video");
    scan.detector.detect(video)
      .then(function (codes) {
        if (!scan.stream) return;
        if (codes && codes.length && handleScanResult(codes[0].rawValue)) return;
        scan.raf = requestAnimationFrame(tickDetector);
      })
      .catch(function () {
        if (!scan.stream) return;
        scan.raf = requestAnimationFrame(tickDetector);
      });
  }

  function tickJsQR() {
    if (!scan.stream) return;
    var video = $("scan-video");
    var w = video.videoWidth;
    var h = video.videoHeight;
    if (!w || !h) {
      scan.timer = setTimeout(tickJsQR, 200);
      return;
    }
    if (!scan.canvas) {
      scan.canvas = document.createElement("canvas");
      scan.ctx = scan.canvas.getContext("2d", { willReadFrequently: true });
    }
    scan.canvas.width = w;
    scan.canvas.height = h;
    try {
      scan.ctx.drawImage(video, 0, 0, w, h);
      var img = scan.ctx.getImageData(0, 0, w, h);
      var code = window.jsQR(img.data, w, h, { inversionAttempts: "dontInvert" });
      if (code && code.data && handleScanResult(code.data)) return;
    } catch (e) { /* image pas prête, on retentera */ }
    scan.timer = setTimeout(tickJsQR, 150);
  }

  // Renvoie true si le QR contenait bien un code de partie (→ scan stoppé).
  function handleScanResult(raw) {
    if (!raw) return false;
    raw = String(raw).trim();
    var room = null;
    try {
      var u = new URL(raw);
      room = new URLSearchParams(u.search).get("room");
    } catch (e) {
      // pas une URL : accepter un code brut à 5 caractères
      if (/^[A-Za-z2-9]{5}$/.test(raw)) room = raw;
    }
    if (!room || !/^[A-Za-z2-9]{5}$/.test(room)) {
      scanStatus("QR non reconnu — scanne le QR de la partie.", "is-error");
      return false;
    }
    room = room.toUpperCase();
    closeScanner();
    beep();
    if (navigator.vibrate) { try { navigator.vibrate(80); } catch (e) {} }
    $("join-code").value = room;
    if (!$("join-name").value.trim()) {
      setStatus($("home-status"), "QR scanné ! Entre ton pseudo puis appuie sur « Rejoindre ».", "is-ok");
      $("join-name").focus();
    } else {
      clientJoin();
    }
    return true;
  }

  function openScanner() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setStatus($("home-status"), "Ce navigateur ne gère pas la caméra — saisis le code manuellement.", "is-error");
      return;
    }
    $("scan-overlay").classList.remove("hidden");
    scan.active = true;
    scanStatus("Ouverture de la caméra…");
    track("multiplayer_scan_open");
    navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } })
      .then(function (stream) {
        // L'utilisateur a ferme l'overlay avant l'autorisation : on libere
        // immediatement la camera au lieu de la laisser allumee en arriere-plan.
        if (!scan.active) {
          stream.getTracks().forEach(function (t) { t.stop(); });
          return;
        }
        scan.stream = stream;
        var video = $("scan-video");
        video.srcObject = stream;
        return video.play();
      })
      .then(function () {
        if (!scan.active) return;
        if ("BarcodeDetector" in window) {
          try {
            scan.detector = new window.BarcodeDetector({ formats: ["qr_code"] });
            scanStatus("Scanne le QR code…");
            tickDetector();
            return;
          } catch (e) { /* repli jsQR */ }
        }
        scanStatus("Chargement du scanner…");
        loadJsQR().then(function () {
          if (!scan.stream) return;
          scanStatus("Scanne le QR code…");
          tickJsQR();
        }).catch(function (err) {
          scanStatus(err.message, "is-error");
          stopScanner();
        });
      })
      .catch(function (err) {
        var msg =
          err && err.name === "NotAllowedError"
            ? "Caméra refusée — autorise la caméra ou saisis le code."
            : err && (err.name === "NotFoundError" || err.name === "OverconstrainedError")
              ? "Aucune caméra trouvée — saisis le code manuellement."
              : "Impossible d'ouvrir la caméra.";
        scanStatus(msg, "is-error");
      });
  }

  /* ============================================================
     Interface : câblage des écrans
     ============================================================ */
  function wireUI() {
    $("btn-create").onclick = hostCreate;
    $("btn-join").onclick = clientJoin;
    $("join-code").addEventListener("keydown", function (e) {
      if (e.key === "Enter") clientJoin();
    });
    $("join-name").addEventListener("keydown", function (e) {
      if (e.key === "Enter") clientJoin();
    });

    // Modes (hôte)
    document.querySelectorAll(".mp-mode").forEach(function (btn) {
      btn.onclick = function () {
        document.querySelectorAll(".mp-mode").forEach(function (b) { b.classList.remove("active"); });
        btn.classList.add("active");
        S.mode = Number(btn.dataset.mode);
      };
    });

    $("btn-start").onclick = hostStart;

    var hostPlaysCb = $("host-plays");
    if (hostPlaysCb) {
      hostPlaysCb.onchange = function () { setHostAsPlayer(hostPlaysCb.checked); };
    }

    var fastScoringCb = $("fast-scoring");
    if (fastScoringCb) {
      fastScoringCb.checked = S.fastScoring;
      fastScoringCb.onchange = function () { S.fastScoring = fastScoringCb.checked; };
    }

    var hostNameInput = $("host-name");
    if (hostNameInput) {
      hostNameInput.addEventListener("input", function () {
        if (S.started) return;
        S.hostName = sanitizeName(hostNameInput.value) || "Hôte";
        var hp = S.players.find(function (p) { return p.pid === HOST_PID; });
        if (hp) hp.n = S.hostName;
        renderPlayers();
        broadcastLobby();
      });
    }

    var importInput = $("import-quiz");
    if (importInput) {
      importInput.addEventListener("change", function () {
        var file = importInput.files && importInput.files[0];
        if (!file) return;
        var st = $("import-status");
        if (st) { st.textContent = "Import en cours…"; st.className = "mp-hint"; }
        importQuizHtml(file)
          .then(function (imp) {
            addImportedQuizOption(true);
            populateCatSelect();
            var n = countQuizQuestions(imp.cats);
            if (st) {
              st.textContent = "✅ « " + imp.title + " » importé (" + n + " questions). Sélectionne une catégorie puis lance la partie !";
              st.className = "mp-hint is-ok";
            }
            track("multiplayer_import_quiz", { questions: n });
          })
          .catch(function (err) {
            if (st) {
              st.textContent = "❌ " + err.message;
              st.className = "mp-hint is-error";
            }
          })
          .then(function () { importInput.value = ""; });
      });
    }

    var renameBtn = $("btn-rename");
    if (renameBtn) renameBtn.onclick = openRename;
    var renameOk = $("btn-rename-ok");
    if (renameOk) renameOk.onclick = applyRename;
    var renameInput = $("rename-input");
    if (renameInput) {
      renameInput.addEventListener("keydown", function (e) {
        if (e.key === "Enter") { e.preventDefault(); applyRename(); }
        else if (e.key === "Escape") closeRename();
      });
    }

    $("btn-copy").onclick = function () {
      if (!S.joinUrl) return;
      var done = function () { setStatus($("lobby-status"), "Lien copié !", "is-ok"); };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(S.joinUrl).then(done, function () {
          setStatus($("lobby-status"), "Copie impossible : " + S.joinUrl, "is-error");
        });
      } else {
        setStatus($("lobby-status"), S.joinUrl);
      }
    };

    $("btn-lobby-back").onclick = function () {
      if (S.role === "host") {
        broadcast({ t: "X" });
        leaveParty();
      } else {
        leaveParty();
      }
    };

    // Scanner QR
    $("btn-scan").onclick = openScanner;
    $("scan-close").onclick = closeScanner;
    $("scan-overlay").addEventListener("click", function (e) {
      if (e.target === $("scan-overlay")) closeScanner();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !$("scan-overlay").classList.contains("hidden")) {
        closeScanner();
      }
    });

    // Sélecteur Mode Réseau (Internet vs LAN)
    var tabCloud = $("tab-net-cloud");
    var tabLan = $("tab-net-lan");
    var lanPanel = $("lan-config-panel");

    function setNetMode(mode) {
      S.netMode = mode;
      try { localStorage.setItem("mp_net_mode", mode); } catch (e) {}
      if (tabCloud) {
        tabCloud.classList.toggle("active", mode === "cloud");
        tabCloud.setAttribute("aria-selected", mode === "cloud" ? "true" : "false");
      }
      if (tabLan) {
        tabLan.classList.toggle("active", mode === "lan");
        tabLan.setAttribute("aria-selected", mode === "lan" ? "true" : "false");
      }
      if (lanPanel) {
        lanPanel.classList.toggle("hidden", mode !== "lan");
      }
      updateNetStatus();
    }

    if (tabCloud) {
      tabCloud.onclick = function () { setNetMode("cloud"); };
    }
    if (tabLan) {
      tabLan.onclick = function () { setNetMode("lan"); };
    }

    var lanServerInput = $("lan-server-input");
    if (lanServerInput) {
      var savedLan = "";
      try { savedLan = localStorage.getItem("mp_lan_server") || ""; } catch (e) {}
      if (!savedLan && location.protocol.startsWith("http")) {
        savedLan = location.origin;
      }
      lanServerInput.value = savedLan;
      S.lanHost = savedLan;

      var btnLanApply = $("btn-lan-apply");
      if (btnLanApply) {
        btnLanApply.onclick = function () {
          var val = lanServerInput.value.trim().replace(/\/+$/, "");
          S.lanHost = val;
          try { localStorage.setItem("mp_lan_server", val); } catch (e) {}
          setStatus($("lan-test-status"), "✅ Adresse LAN enregistrée : " + val, "is-ok");
        };
      }

      var btnLanTest = $("btn-lan-test");
      if (btnLanTest) {
        btnLanTest.onclick = function () {
          var val = (lanServerInput.value.trim().replace(/\/+$/, "")) || location.origin;
          setStatus($("lan-test-status"), "Test de connexion au serveur LAN…");
          fetch(val + "/api/relay/ping", { mode: "cors" })
            .then(function (r) { return r.json(); })
            .then(function (data) {
              if (data && data.ok) {
                setStatus($("lan-test-status"), "✅ Serveur LAN actif et connecté !", "is-ok");
              } else {
                setStatus($("lan-test-status"), "⚠️ Réponse inattendue du serveur LAN.", "is-error");
              }
            })
            .catch(function (err) {
              setStatus($("lan-test-status"), "❌ Serveur LAN injoignable (" + err.message + "). Lancez node server.js si vous utilisez un serveur local.", "is-error");
            });
        };
      }
    }

    // Réglage nombre de questions libre
    var limitInput = $("setup-limit-input");
    if (limitInput) {
      limitInput.addEventListener("input", function () {
        updateLimitHint();
      });
    }

    var btnLimitAll = $("btn-limit-all");
    if (btnLimitAll) {
      btnLimitAll.onclick = function () {
        if (limitInput) {
          limitInput.value = S.totalAvailable > 0 ? S.totalAvailable : 20;
          updateLimitHint();
        }
      };
    }

    document.querySelectorAll(".mp-preset-btn").forEach(function (btn) {
      btn.onclick = function () {
        if (!limitInput) return;
        var val = btn.dataset.val;
        if (val === "all" || val === "max") {
          limitInput.value = S.totalAvailable > 0 ? S.totalAvailable : 20;
        } else {
          limitInput.value = Number(val);
        }
        updateLimitHint();
      };
    });

    $("btn-again").onclick = function () {
      if (S.role === "host") hostResetToLobby();
      else backToLobbyWait();
    };

    // Réseau & Reconnexion
    function syncNet() {
      updateNetStatus();
      if (!navigator.onLine && S.netMode !== "lan") {
        setStatus($("home-status"), "Hors ligne : le mode Internet nécessite une connexion.", "is-error");
      }
    }
    window.addEventListener("online", syncNet);
    window.addEventListener("offline", syncNet);
    syncNet();

    function handleWake() {
      if (S.peer && !S.peer.destroyed && S.peer.disconnected) {
        console.log("[Peer] Réveil de l'onglet/fenêtre détecté, reconnexion au serveur de signalement...");
        updateNetStatus("reconnecting");
        try { S.peer.reconnect(); } catch (e) {}
      }
    }
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "visible") handleWake();
    });
    window.addEventListener("focus", handleWake);

    // Initialisation du mode réseau (détection automatique ou URL)
    var urlParams = new URLSearchParams(window.location.search);
    var urlNet = urlParams.get("net");
    var urlLanHost = urlParams.get("lan_host");
    if (urlLanHost) {
      S.lanHost = decodeURIComponent(urlLanHost);
      if (lanServerInput) lanServerInput.value = S.lanHost;
    }

    var host = location.hostname || "";
    var isPrivateLan = host === "localhost" || host === "127.0.0.1" ||
      /^192\.168\./.test(host) || /^10\./.test(host) || /^172\.(1[6-9]|2\d|3[0-1])\./.test(host) || /\.local$/.test(host);

    var initialMode = "cloud";
    if (urlNet === "lan") {
      initialMode = "lan";
    } else if (urlNet === "cloud") {
      initialMode = "cloud";
    } else {
      var savedMode = "";
      try { savedMode = localStorage.getItem("mp_net_mode"); } catch (e) {}
      if (savedMode === "lan" || savedMode === "cloud") {
        initialMode = savedMode;
      } else if (isPrivateLan) {
        initialMode = "lan";
      }
    }
    setNetMode(initialMode);

    // Lien de rejoignage direct ?room=CODE (depuis le QR code)
    var room = urlParams.get("room");
    if (room) {
      $("join-code").value = room.toUpperCase();
      setTimeout(function () { $("join-name").focus(); }, 250);
    }
  }

  /* ============================================================
     Init
     ============================================================ */
  function init() {
    if (!coreReady()) {
      setStatus($("home-status"), "js/quiz.js n'a pas pu être chargé.", "is-error");
    }
    wireUI();
    showScreen("screen-home");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
