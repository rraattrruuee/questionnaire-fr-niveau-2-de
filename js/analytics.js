/* ---------------------------------------------------------
   analytics.js — PostHog HTTP API (sans loader JS externe)
   Envoie les evenements directement via fetch, pas de script
   tiers charge = pas de probleme CORS/Brave.
   --------------------------------------------------------- */
(function () {
  "use strict";

  var PH_KEY = "phc_xa8HpshuaLbaviE2c7pKoAwe7DfwcsgveTnDRDTxWcRV";
  var PH_HOST = "https://posthog-proxy.rrraattrruuee.workers.dev";

  // Genere un ID stable par appareil (localStorage)
  function getDistinctId() {
    var id = null;
    try { id = localStorage.getItem("ph_distinct_id"); } catch (e) {}
    if (!id) {
      id = "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
        var r = Math.random() * 16 | 0;
        return (c === "x" ? r : (r & 0x3 | 0x8)).toString(16);
      });
      try { localStorage.setItem("ph_distinct_id", id); } catch (e) {}
    }
    return id;
  }

  /* ---------------------------------------------------------
     Tracking via HTTP POST direct vers PostHog /capture
     --------------------------------------------------------- */
  var queue = [];
  var ready = false;

  function flushQueue() {
    if (!ready || queue.length === 0) return;
    var batch = queue.splice(0, queue.length);
    var did = getDistinctId();
    var payload = {
      api_key: PH_KEY,
      batch: batch.map(function (item) {
        return {
          event: item.event,
          properties: item.props,
          distinct_id: did,
          timestamp: item.timestamp
        };
      })
    };

    fetch(PH_HOST + "/batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    }).catch(function () {
      // Remet en queue en cas d'echec
      batch.forEach(function (item) { queue.push(item); });
    });
  }

  function track(eventName, properties) {
    properties = properties || {};
    properties.page_url = window.location.href;
    properties.is_embed = !!window.__EMBED_QUIZ__;

    var item = {
      event: eventName,
      props: properties,
      timestamp: new Date().toISOString()
    };

    queue.push(item);
    // Envoie apres un petit delay pour batcher les appels proches
    clearTimeout(track._timer);
    track._timer = setTimeout(flushQueue, 500);
  }

  /* ---------------------------------------------------------
     Page leave tracking
     --------------------------------------------------------- */
  var _lastQuizState = null;

  function setQuizState(state) {
    _lastQuizState = state;
  }

  window.addEventListener("beforeunload", function () {
    if (_lastQuizState && _lastQuizState.inProgress) {
      track("quiz_abandon_page", {
        quiz_id: _lastQuizState.quizId,
        quiz_title: _lastQuizState.quizTitle,
        subject_name: _lastQuizState.subjectName,
        category_name: _lastQuizState.categoryName,
        category_index: _lastQuizState.categoryIndex,
        question_index: _lastQuizState.questionIndex,
        question_text: _lastQuizState.questionText,
        question_type: _lastQuizState.questionType,
        question_location: _lastQuizState.questionLocation,
        score: _lastQuizState.score,
        answered_count: _lastQuizState.answeredCount,
        total_questions: _lastQuizState.totalQuestions,
        completion_pct: _lastQuizState.totalQuestions
          ? Math.round((_lastQuizState.answeredCount / _lastQuizState.totalQuestions) * 100)
          : 0
      });
      // Envoie immediatement avant fermeture
      flushQueue();
    }
  });

  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden" && _lastQuizState && _lastQuizState.inProgress) {
      track("quiz_visibility_hidden", {
        quiz_id: _lastQuizState.quizId,
        quiz_title: _lastQuizState.quizTitle,
        subject_name: _lastQuizState.subjectName,
        category_name: _lastQuizState.categoryName,
        category_index: _lastQuizState.categoryIndex,
        question_index: _lastQuizState.questionIndex,
        question_text: _lastQuizState.questionText,
        question_type: _lastQuizState.questionType,
        question_location: _lastQuizState.questionLocation,
        score: _lastQuizState.score,
        answered_count: _lastQuizState.answeredCount,
        total_questions: _lastQuizState.totalQuestions
      });
      flushQueue();
    }
  });

  /* ---------------------------------------------------------
     Expose API globale
     --------------------------------------------------------- */
  window.__analytics = {
    track: track,
    flushQueue: flushQueue,
    setQuizState: setQuizState
  };

  ready = true;
})();
