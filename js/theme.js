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

  var ICON = {
    dark: "☀️",
    light: "🌙"
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
      if (icon) icon.textContent = ICON[theme] || "";
      if (label) label.textContent = LABEL[theme] || "";
      else btn.textContent = ICON[theme] || "";
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
