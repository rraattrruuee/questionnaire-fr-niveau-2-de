// BEGIN_ASSETS
const STATIC_ASSETS = [
  "./css/portal.css",
  "./css/quiz.css",
  "./css/theme.css",
  "./data/anglais/verbes-irreguliers.json",
  "./data/anglais/warriors-pacific.json",
  "./data/config.json",
  "./data/francais/methodologie-commentaire.json",
  "./data/francais/outils-analyse-litteraire.json",
  "./data/francais/versification-formes-fixes.json",
  "./data/histoire-geo/mediterranee-medievale.json",
  "./data/histoire-geo/periodes-athenes.json",
  "./data/histoire-geo/vocabulaire-essentiel.json",
  "./data/italien/carattere-hobby-segni.json",
  "./data/italien/esprimere-gusti-frequenza.json",
  "./data/italien/presentare-una-persona.json",
  "./data/italien/stile-presente.json",
  "./data/mathematiques/calcul-litteral-avance-pieges.json",
  "./data/mathematiques/calcul-litteral-numerique.json",
  "./data/physique-chimie/atomes-molecules.json",
  "./data/physique-chimie/noyau-atome-config-electronique.json",
  "./data/ses/introduction-chapitre1-eco1.json",
  "./data/svt/organes-microscope-matrice-extracellulaire.json",
  "./index.html",
  "./js/analytics.js",
  "./js/portal.js",
  "./js/quiz.js",
  "./js/theme.js",
  "./manifest.json",
  "./multiplayer/index.html",
  "./multiplayer/multiplayer.css",
  "./multiplayer/multiplayer.js",
  "./multiplayer/vendor/peerjs.min.js",
  "./multiplayer/vendor/qrcode.min.js",
  "./offline.html",
  "./quiz.html",
  "./quiz_icon-192.png",
  "./quiz_icon-512.png",
  "./quiz_icon.png",
  "./quiz_icon.svg",
  "./quizmaster.html",
  "./service-worker.js",
];
// END_ASSETS

const CACHE_PREFIX = "quiz-cache-";
const CACHE_NAME = "quiz-cache-1793828235";
const META_KEY = "__cache-meta__";

function notifyClients(msg) {
  return self.clients.matchAll({ includeUncontrolled: true }).then((clients) => {
    clients.forEach((c) => c.postMessage(msg));
  });
}

function getCacheMeta(cache) {
  return cache.match(META_KEY).then(function (r) {
    return r ? r.json() : {};
  });
}

function saveCacheMeta(cache, meta) {
  var blob = new Blob([JSON.stringify(meta)], { type: "application/json" });
  return cache.put(META_KEY, new Response(blob));
}

function cacheAllAssets(force) {
  return caches.open(CACHE_NAME).then(function (cache) {
    return getCacheMeta(cache).then(function (meta) {
      var toFetch = STATIC_ASSETS.map(function (url) {
        var abs = new URL(url, self.location.origin).href;
        var m = meta[abs];
        var headers = {};

        if (!force && m) {
          if (m.etag) headers["If-None-Match"] = m.etag;
          if (m.lastModified) headers["If-Modified-Since"] = m.lastModified;
        }

        return { url: url, abs: abs, headers: headers, hasMeta: !!m };
      });

      if (toFetch.length === 0) {
        notifyClients({ type: "caching-complete" });
        return Promise.resolve();
      }

      var total = toFetch.length;
      var completed = 0;
      var downloaded = 0;
      var unchanged = 0;
      var failed = 0;

      notifyClients({ type: "caching-start", total: total });

      return Promise.all(
        toFetch.map(function (item) {
          var fetchOpts = { cache: "no-store" };
          if (Object.keys(item.headers).length > 0) {
            fetchOpts.headers = item.headers;
          }

          return fetch(item.url, fetchOpts)
            .then(function (res) {
              if (res.status === 304) {
                unchanged++;
              } else if (res.ok) {
                downloaded++;
                var etag = res.headers.get("ETag") || "";
                var lm = res.headers.get("Last-Modified") || "";
                meta[item.abs] = { etag: etag, lastModified: lm };
                return cache.put(item.url, res);
              }
            })
            .catch(function () {
              failed++;
            })
            .finally(function () {
              completed++;
              notifyClients({ type: "caching-progress", completed: completed, total: total });
            });
        })
      ).then(function () {
        return saveCacheMeta(cache, meta);
      }).then(function () {
        notifyClients({
          type: "caching-complete",
          downloaded: downloaded,
          unchanged: unchanged,
          failed: failed
        });
      });
    });
  });
}

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(cacheAllAssets(true));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        // Ne supprimer que les anciennes versions de CE cache : les autres
        // projets heberges sur la meme origine (GitHub Pages) ont les leurs.
        Promise.all(
          keys
            .filter((k) => k.indexOf(CACHE_PREFIX) === 0 && k !== CACHE_NAME)
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "cache-assets") {
    event.waitUntil(cacheAllAssets(false));
  }
});

self.addEventListener("fetch", (event) => {
  const request = event.request;

  // On ne gere que les GET de notre propre origine
  if (request.method !== "GET") return;

  let url;
  try {
    url = new URL(request.url);
  } catch (e) {
    return;
  }
  if (url.origin !== self.location.origin) return;

  // Strategie "network-first" : toujours la derniere version en ligne,
  // et repli sur le cache si l'on est hors-ligne.
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response && response.ok) {
          const clone = response.clone();
          // On attend l'ecriture du cache : sinon le SW peut etre arrete
          // avant la fin et l'entree est perdue.
          return caches
            .open(CACHE_NAME)
            .then((cache) => cache.put(request, clone))
            .catch(() => {})
            .then(() => response);
        }
        return response;
      })
      .catch(() => {
        return caches.match(request).then((cached) => {
          if (cached) return cached;
          if (request.mode === "navigate") {
            // Une navigation vers un quiz avec ?id=... ne correspond pas a
            // l'entree precachee "./quiz.html" (la query string compte).
            // On renvoie donc la coquille du quiz, qui lit elle-meme l'id.
            if (/\/quiz\.html$/.test(url.pathname)) {
              return caches.match("./quiz.html").then((quiz) => {
                return quiz || caches.match("./offline.html");
              });
            }
            if (/\/$/.test(url.pathname) || /\/index\.html$/.test(url.pathname)) {
              return caches.match("./index.html").then((index) => {
                return index || caches.match("./offline.html");
              });
            }
            return caches.match("./offline.html");
          }
          return caches.match("./offline.html");
        });
      })
  );
});
