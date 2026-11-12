// BEGIN_ASSETS
const STATIC_ASSETS = [
  "./assets/images/ses/bourdieu-formes-de-capitaux.svg",
  "./assets/images/ses/calcul-variation-coeff-multiplicateur.svg",
  "./assets/images/ses/correlation-vs-causalite.svg",
  "./assets/images/ses/demarche-scientifique-ses.svg",
  "./assets/images/ses/indices-pib-nominal-et-reel.svg",
  "./assets/images/svt/adn-double-helice-nucleotides.svg",
  "./assets/images/svt/adn-expression-differenciation.svg",
  "./assets/images/svt/adn-sequence-et-diversite-genes.svg",
  "./assets/images/svt/adn-transgenese-meduse-souris.svg",
  "./assets/papicons/accessibility.svg",
  "./assets/papicons/add.svg",
  "./assets/papicons/alert-circle.svg",
  "./assets/papicons/alert.svg",
  "./assets/papicons/alert-triangle.svg",
  "./assets/papicons/apple.svg",
  "./assets/papicons/archive.svg",
  "./assets/papicons/arrow-down-box.svg",
  "./assets/papicons/arrow-down.svg",
  "./assets/papicons/arrow-left-box.svg",
  "./assets/papicons/arrow-left-down-box.svg",
  "./assets/papicons/arrow-left-down.svg",
  "./assets/papicons/arrow-left.svg",
  "./assets/papicons/arrow-left-up-box.svg",
  "./assets/papicons/arrow-left-up.svg",
  "./assets/papicons/arrow-right-box.svg",
  "./assets/papicons/arrow-right-down-box.svg",
  "./assets/papicons/arrow-right-down.svg",
  "./assets/papicons/arrow-right.svg",
  "./assets/papicons/arrow-right-up-box.svg",
  "./assets/papicons/arrow-right-up.svg",
  "./assets/papicons/arrow-up-box.svg",
  "./assets/papicons/arrow-up.svg",
  "./assets/papicons/bell.svg",
  "./assets/papicons/bold.svg",
  "./assets/papicons/bookmark.svg",
  "./assets/papicons/bus.svg",
  "./assets/papicons/butterfly.svg",
  "./assets/papicons/calendar.svg",
  "./assets/papicons/camera.svg",
  "./assets/papicons/card.svg",
  "./assets/papicons/car.svg",
  "./assets/papicons/chair.svg",
  "./assets/papicons/check.svg",
  "./assets/papicons/chevron-down.svg",
  "./assets/papicons/chevron-left.svg",
  "./assets/papicons/chevron-right.svg",
  "./assets/papicons/chevron-up.svg",
  "./assets/papicons/clock.svg",
  "./assets/papicons/code.svg",
  "./assets/papicons/coefficient.svg",
  "./assets/papicons/color-theme.svg",
  "./assets/papicons/cross.svg",
  "./assets/papicons/crown.svg",
  "./assets/papicons/cutlery.svg",
  "./assets/papicons/ecoledirecte.svg",
  "./assets/papicons/emoji.svg",
  "./assets/papicons/external-link.svg",
  "./assets/papicons/filter.svg",
  "./assets/papicons/folder.svg",
  "./assets/papicons/font.svg",
  "./assets/papicons/gallery.svg",
  "./assets/papicons/gears.svg",
  "./assets/papicons/ghost.svg",
  "./assets/papicons/globe-cross.svg",
  "./assets/papicons/globe.svg",
  "./assets/papicons/grades.svg",
  "./assets/papicons/graduation-hat.svg",
  "./assets/papicons/grid.svg",
  "./assets/papicons/heart.svg",
  "./assets/papicons/home.svg",
  "./assets/papicons/info-box.svg",
  "./assets/papicons/info.svg",
  "./assets/papicons/link.svg",
  "./assets/papicons/list.svg",
  "./assets/papicons/lock.svg",
  "./assets/papicons/login.svg",
  "./assets/papicons/logout.svg",
  "./assets/papicons/mail.svg",
  "./assets/papicons/map-pin.svg",
  "./assets/papicons/menu.svg",
  "./assets/papicons/metro.svg",
  "./assets/papicons/minus.svg",
  "./assets/papicons/moon.svg",
  "./assets/papicons/newspaper.svg",
  "./assets/papicons/palette.svg",
  "./assets/papicons/paper.svg",
  "./assets/papicons/papillon-app.svg",
  "./assets/papicons/papillon-icon.svg",
  "./assets/papicons/password.svg",
  "./assets/papicons/pause.svg",
  "./assets/papicons/pen-alt.svg",
  "./assets/papicons/pen.svg",
  "./assets/papicons/phone.svg",
  "./assets/papicons/pie.svg",
  "./assets/papicons/piggy-bank.svg",
  "./assets/papicons/pillar.svg",
  "./assets/papicons/placeholder.svg",
  "./assets/papicons/play.svg",
  "./assets/papicons/plus.svg",
  "./assets/papicons/private_papillon-app.svg",
  "./assets/papicons/private_papillon-icon.svg",
  "./assets/papicons/pronote.svg",
  "./assets/papicons/qr-code.svg",
  "./assets/papicons/search.svg",
  "./assets/papicons/skolengo.svg",
  "./assets/papicons/sparkles.svg",
  "./assets/papicons/sprite.svg",
  "./assets/papicons/star.svg",
  "./assets/papicons/sunrise.svg",
  "./assets/papicons/sun.svg",
  "./assets/papicons/tasks.svg",
  "./assets/papicons/text-bubble.svg",
  "./assets/papicons/trash.svg",
  "./assets/papicons/underline.svg",
  "./assets/papicons/unlock.svg",
  "./assets/papicons/user-cross.svg",
  "./assets/papicons/user.svg",
  "./assets/papicons/volume-cross.svg",
  "./assets/papicons/volume-half.svg",
  "./assets/papicons/volume-no.svg",
  "./assets/papicons/volume.svg",
  "./assets/papicons/walk.svg",
  "./css/portal.css",
  "./css/quiz.css",
  "./css/theme.css",
  "./data/anglais/verbes-irreguliers.json",
  "./data/anglais/warriors-pacific.json",
  "./data/config.json",
  "./data/francais/methodologie-commentaire.json",
  "./data/francais/outils-analyse-litteraire.json",
  "./data/francais/versification-formes-fixes.json",
  "./data/histoire-geo/empire-romain-brassage-cultures.json",
  "./data/histoire-geo/mediterranee-medievale.json",
  "./data/histoire-geo/mediterranee-reperes-chronologiques.json",
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
  "./data/ses/socialisation-demarche-outils.json",
  "./data/svt/adn-support-information-genetique.json",
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
  "./server.js",
  "./service-worker.js",
];
// END_ASSETS

const CACHE_PREFIX = "quiz-cache-";
const CACHE_NAME = "quiz-cache-1794479311";
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
