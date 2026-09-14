// BEGIN_ASSETS
const STATIC_ASSETS = [
  "./css/portal.css",
  "./css/quiz.css",
  "./css/theme.css",
  "./data/config.json",
  "./data/francais/outils-analyse-litteraire.json",
  "./data/italien/presentare-una-persona.json",
  "./index.html",
  "./js/portal.js",
  "./js/quiz.js",
  "./js/theme.js",
  "./manifest.json",
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

const CACHE_NAME = "quiz-cache-0fe866a";

function notifyClients(msg) {
  return self.clients.matchAll({ includeUncontrolled: true }).then((clients) => {
    clients.forEach((c) => c.postMessage(msg));
  });
}

function cacheAllAssets() {
  return caches.open(CACHE_NAME).then((cache) => {
    const total = STATIC_ASSETS.length;
    let completed = 0;

    notifyClients({ type: "caching-start", total });

    return Promise.all(
      STATIC_ASSETS.map((url) =>
        fetch(url, { cache: "no-cache" })
          .then((res) => {
            if (res.ok) return cache.put(url, res);
          })
          .catch(() => {})
          .finally(() => {
            completed++;
            notifyClients({ type: "caching-progress", completed, total });
          })
      )
    ).then(() => {
      notifyClients({ type: "caching-complete" });
    });
  });
}

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(cacheAllAssets());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "cache-assets") {
    cacheAllAssets();
  }
});

self.addEventListener("online", () => {
  cacheAllAssets();
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
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      })
      .catch(() => {
        return caches.match(request).then((cached) => {
          if (cached) return cached;
          if (request.mode === "navigate") {
            return caches.match("./index.html").then((index) => {
              return index || caches.match("./offline.html");
            });
          }
          return caches.match("./offline.html");
        });
      })
  );
});
