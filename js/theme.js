/* ============================================================
   theme.js - Automatic light / dark theme manager
   - Detects system preference (prefers-color-scheme)
   - Persists the user's choice in localStorage
   - Syncs across tabs (storage event)
   - Updates <meta name="theme-color"> and toggle buttons
   ============================================================ */
(function () {
  "use strict";

  var STORAGE_KEY = "theme-preference";
  var DARK = "dark";
  var LIGHT = "light";
  var root = document.documentElement;

  var THEME_COLOR = {
    dark: "#0b1020",
    light: "#eef2f7"
  };

  var LABEL = {
    /* label shown = the theme the button will SWITCH TO */
    dark: "Thème clair",
    light: "Thème sombre"
  };

  /* Papicons SVG (https://icons.papillon.bzh/) */
  var ICON = {
    dark: '<svg class="papicon" viewBox="0 0 24 25" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M15 12.8572C15 14.514 13.6569 15.8572 12 15.8572C10.3431 15.8572 9 14.514 9 12.8572C9 11.2003 10.3431 9.85718 12 9.85718C13.6569 9.85718 15 11.2003 15 12.8572Z"/><path fill-rule="evenodd" clip-rule="evenodd" d="M12.224 2.71279C13.1976 2.82269 13.8745 3.93342 15.2279 6.1542C17.808 5.82774 19.0985 5.66373 19.7914 6.35635C19.9909 6.70791 20.1456 8.75872 19.2533 11.2011C21.1171 13.0146 22.0492 13.9219 21.9399 14.8954C21.5165 16.2576 20.283 16.6707 17.8168 17.496C17.561 20.084 17.4324 21.3779 16.6029 21.8993C15.2748 22.4171 14.1824 21.7104 11.9994 20.2968C9.81658 21.7103 8.72506 22.4171 7.80021 22.0937C6.56669 21.3778 6.43883 20.0837 6.18303 17.496C3.71676 16.6707 2.48338 16.2576 2.15959 15.3329C1.95064 13.9218 2.88271 13.0146 4.7465 11.2011C3.8542 8.75861 3.40816 7.53759 3.92912 6.70791C4.9014 5.66383 6.19193 5.82775 8.77189 6.1542C10.1253 3.93342 10.8022 2.82269 11.7758 2.71279C12.0751 2.69599 12.224 2.71279 12.224 2.71279ZM11.9994 7.85732C9.23819 7.85754 6.99943 10.096 6.99943 12.8573C6.99959 15.6185 9.23829 17.8571 11.9994 17.8573C14.7608 17.8573 16.9993 15.6186 16.9994 12.8573C16.9994 10.0959 14.7609 7.85732 11.9994 7.85732Z"/></svg>',
    light: '<svg class="papicon" viewBox="0 0 24 25" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M11 3.85718C11.7891 3.85718 12.0004 5.04248 11.4641 5.62132C10.5555 6.60206 10 7.91462 10 9.35718C10 12.3947 12.4624 14.8572 15.5 14.8572C16.9423 14.8572 18.2542 14.3018 19.2346 13.3934C19.8136 12.8568 20.9996 13.0677 21 13.8572C21.0027 18.8277 16.9706 21.8572 12 21.8572C7.02944 21.8572 3 17.8277 3 12.8572C3 7.88661 6.02944 3.85718 11 3.85718Z"/></svg>'
  };

  function systemTheme() {
    try {
      return window.matchMedia("(prefers-color-scheme: dark)").matches
        ? DARK
        : LIGHT;
    } catch (e) {
      return DARK;
    }
  }

  function savedTheme() {
    try {
      var value = localStorage.getItem(STORAGE_KEY);
      return value === DARK || value === LIGHT ? value : null;
    } catch (e) {
      return null;
    }
  }

  function effectiveTheme() {
    return savedTheme() || systemTheme();
  }

  function updateMeta(theme) {
    var color = THEME_COLOR[theme] || THEME_COLOR.dark;
    var metas = document.querySelectorAll('meta[name="theme-color"]');
    if (metas.length === 0) {
      var meta = document.createElement("meta");
      meta.setAttribute("name", "theme-color");
      document.head.appendChild(meta);
      metas = [meta];
    }
    metas.forEach(function (m) {
      m.setAttribute("content", color);
    });
  }

  function updateToggles(theme) {
    var toggles = document.querySelectorAll("[data-theme-toggle]");
    toggles.forEach(function (btn) {
      btn.setAttribute("data-mode", theme);
      btn.setAttribute(
        "aria-label",
        theme === DARK ? "Activer le thème clair" : "Activer le thème sombre"
      );
      btn.setAttribute("title", LABEL[theme] || "");
      var icon = btn.querySelector(".theme-toggle-icon");
      var label = btn.querySelector(".theme-toggle-label");
      if (icon) icon.innerHTML = ICON[theme] || "";
      if (label) label.textContent = LABEL[theme] || "";
      else btn.innerHTML = ICON[theme] || "";
    });
  }

  function applyTheme(theme, persist) {
    root.setAttribute("data-theme", theme);
    root.style.colorScheme = theme;
    updateToggles(theme);
    updateMeta(theme);
    if (persist) {
      try {
        localStorage.setItem(STORAGE_KEY, theme);
      } catch (e) {}
    }
  }

  function toggleTheme() {
    var current = root.getAttribute("data-theme") || effectiveTheme();
    applyTheme(current === DARK ? LIGHT : DARK, true);
  }

  /* ---- Public API ---- */
  window.Theme = {
    get: function () {
      return root.getAttribute("data-theme") || effectiveTheme();
    },
    set: function (theme) {
      if (theme === DARK || theme === LIGHT) applyTheme(theme, true);
    },
    toggle: toggleTheme,
    reset: function () {
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch (e) {}
      applyTheme(systemTheme(), false);
    }
  };

  /* ---- Bind toggle buttons (delegated so late-added nodes work) ---- */
  document.addEventListener("click", function (event) {
    var btn = event.target.closest("[data-theme-toggle]");
    if (!btn) return;
    event.preventDefault();
    toggleTheme();
  });

  /* ---- React to system preference changes when no manual choice ---- */
  try {
    var media = window.matchMedia("(prefers-color-scheme: dark)");
    var onChange = function () {
      if (!savedTheme()) applyTheme(systemTheme(), false);
    };
    if (media.addEventListener) media.addEventListener("change", onChange);
    else if (media.addListener) media.addListener(onChange);
  } catch (e) {}

  /* ---- Sync across tabs ---- */
  window.addEventListener("storage", function (event) {
    if (event.key !== STORAGE_KEY) return;
    applyTheme(effectiveTheme(), false);
  });

  /* ---- Apply immediately (markup already has data-theme from the
     inline boot script to avoid any flash) ---- */
  applyTheme(root.getAttribute("data-theme") || effectiveTheme(), false);

  /* Re-sync toggle labels/icons once the DOM is ready */
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      applyTheme(root.getAttribute("data-theme") || effectiveTheme(), false);
    });
  }
})();
