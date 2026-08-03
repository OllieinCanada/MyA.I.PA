const CACHE_NAME = "myaipa-v4-20260803-refresh";
const APP_SHELL = ["/manifest.json", "/MyAIPA_logo.png"];

function freshRequest(request) {
  return new Request(request, { cache: "no-store" });
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL.map((url) => new Request(url, { cache: "reload" }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
      .then(() => self.clients.matchAll({ type: "window", includeUncontrolled: true }))
      .then((windows) =>
        Promise.all(
          windows.map((client) =>
            client.navigate(client.url).catch(() => undefined)
          )
        )
      )
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== self.location.origin) return;

  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(freshRequest(event.request))
        .then((response) => {
          if (response && response.ok) {
            const copy = response.clone();
            return caches
              .open(CACHE_NAME)
              .then((cache) => cache.put("/index.html", copy))
              .then(() => response);
          }
          return response;
        })
        .catch(() => caches.match("/index.html"))
    );
    return;
  }

  if (requestUrl.pathname.startsWith("/static/")) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((response) => {
          if (response && response.ok) {
            const copy = response.clone();
            return caches
              .open(CACHE_NAME)
              .then((cache) => cache.put(event.request, copy))
              .then(() => response);
          }
          return response;
        });
      })
    );
    return;
  }

  event.respondWith(
    fetch(freshRequest(event.request))
      .then((response) => {
        if (response && response.ok) {
          const copy = response.clone();
          return caches
            .open(CACHE_NAME)
            .then((cache) => cache.put(event.request, copy))
            .then(() => response);
        }
        return response;
      })
      .catch(() =>
        caches.match(event.request).then((cached) => {
          if (cached) return cached;
          return undefined;
        })
      )
  );
});
