/* ---------------------------------------------------------
   analytics.js — PostHog analytics wrapper
   Remplace PH_API_KEY par ta cle PostHog dans le init().
   --------------------------------------------------------- */
(function () {
  "use strict";

  var PH_KEY = "phc_xa8HpshuaLbaviE2c7pKoAwe7DfwcsgveTnDRDTxWcRV";
  var PH_HOST = "https://us.i.posthog.com";
  var PH_PROXY = "https://posthog-proxy.rrraattrruuee.workers.dev";

  /* ---------------------------------------------------------
     PostHog loader
     --------------------------------------------------------- */
  function loadPostHog(callback) {
    if (window.posthog && window.posthog.__loaded) {
      callback();
      return;
    }

    var host = PH_PROXY || PH_HOST;
    var assetsHost = PH_PROXY
      ? PH_PROXY
      : PH_HOST.replace(".i.posthog.com", "-assets.i.posthog.com");

    var script = document.createElement("script");
    script.type = "text/javascript";
    script.crossOrigin = "anonymous";
    script.async = true;
    script.src = assetsHost + "/static/array.js";

    var firstScript = document.getElementsByTagName("script")[0];
    firstScript.parentNode.insertBefore(script, firstScript);

    script.onload = function () {
      if (window.posthog) {
        window.posthog.init(PH_KEY, {
          api_host: host,
          capture_pageview: false,
          capture_pageleave: false,
          autocapture: false,
          capture_network_errors: false,
          disable_session_recording: true,
          advanced_disable_decide: true,
          persistence: "localStorage+cookie",
          loaded: function () {
            window.posthog.__loaded = true;
            if (callback) callback();
          }
        });
      }
    };

    script.onerror = function () {
      console.warn("PostHog: impossible de charger le script.");
    };
  }

  /* ---------------------------------------------------------
     Tracking helpers — fonctionnent meme si PostHog n'est pas charge
     --------------------------------------------------------- */
  var queue = [];

  function track(eventName, properties) {
    properties = properties || {};
    properties.timestamp = new Date().toISOString();
    properties.page_url = window.location.href;
    properties.is_embed = !!window.__EMBED_QUIZ__;

    if (window.posthog && window.posthog.__loaded) {
      window.posthog.capture(eventName, properties);
    } else {
      queue.push({ event: eventName, props: properties });
    }
  }

  function flushQueue() {
    if (window.posthog && window.posthog.__loaded && queue.length > 0) {
      queue.forEach(function (item) {
        window.posthog.capture(item.event, item.props);
      });
      queue = [];
    }
  }

  function identify(distinctId) {
    if (window.posthog && window.posthog.__loaded) {
      window.posthog.identify(distinctId);
    }
  }

  function reset() {
    if (window.posthog && window.posthog.__loaded) {
      window.posthog.reset();
    }
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
        category_name: _lastQuizState.categoryName,
        category_index: _lastQuizState.categoryIndex,
        question_index: _lastQuizState.questionIndex,
        question_text: _lastQuizState.questionText,
        question_type: _lastQuizState.questionType,
        score: _lastQuizState.score,
        answered_count: _lastQuizState.answeredCount,
        total_questions: _lastQuizState.totalQuestions,
        completion_pct: _lastQuizState.totalQuestions
          ? Math.round((_lastQuizState.answeredCount / _lastQuizState.totalQuestions) * 100)
          : 0
      });
    }
  });

  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden" && _lastQuizState && _lastQuizState.inProgress) {
      track("quiz_visibility_hidden", {
        quiz_id: _lastQuizState.quizId,
        quiz_title: _lastQuizState.quizTitle,
        category_name: _lastQuizState.categoryName,
        category_index: _lastQuizState.categoryIndex,
        question_index: _lastQuizState.questionIndex,
        question_text: _lastQuizState.questionText,
        question_type: _lastQuizState.questionType,
        score: _lastQuizState.score,
        answered_count: _lastQuizState.answeredCount,
        total_questions: _lastQuizState.totalQuestions
      });
    }
  });

  /* ---------------------------------------------------------
     Expose API globale
     --------------------------------------------------------- */
  window.__analytics = {
    load: loadPostHog,
    track: track,
    flushQueue: flushQueue,
    identify: identify,
    reset: reset,
    setQuizState: setQuizState
  };

  /* Auto-load au chargement de la page */
  loadPostHog(flushQueue);
})();
