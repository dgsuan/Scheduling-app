// Service worker for the installable web app.
//  • App shell works offline: pages are network-first with a cached fallback.
//  • Hashed build assets and fonts are cache-first (their URLs change when they do).
//  • Clicking a reminder notification focuses the app (or opens it).
//  • Push messages from the "reminders" Edge Function become notifications,
//    so reminders arrive while the app is closed (when turned on in Settings).

const CACHE = "campus-schedule-v1";
const SCOPE = new URL(self.registration.scope);
const SHELL = SCOPE.href;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll([SHELL, new URL("manifest.webmanifest", SCOPE).href]))
      .catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok && url.href === SHELL) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(SHELL, copy));
          }
          return res;
        })
        .catch(() => caches.match(SHELL))
    );
    return;
  }

  const sameOrigin = url.origin === self.location.origin;
  const cacheable =
    (sameOrigin && (url.pathname.includes("/_expo/static/") || /\.(png|ico|webmanifest|ttf)$/.test(url.pathname))) ||
    url.host === "fonts.googleapis.com" ||
    url.host === "fonts.gstatic.com";
  if (!cacheable) return;

  event.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok || res.type === "opaque") {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
    )
  );
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: event.data ? event.data.text() : "" };
  }
  const text = (v, max) => (typeof v === "string" ? v.slice(0, max) : "");
  const title = text(data.title, 120) || "Reminder";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: text(data.body, 240),
      tag: text(data.tag, 200) || undefined,
      icon: new URL("icons/icon-192.png", SCOPE).href,
      data: { path: text(data.path, 40) },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const raw = (event.notification.data && event.notification.data.path) || "";
  // Only simple in-app paths (e.g. "tasks"); never a full URL.
  const path = /^[a-z0-9/?=&-]*$/i.test(raw) ? raw : "";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      const open = clients.find((c) => c.url.startsWith(SCOPE.href));
      if (open) return open.focus();
      return self.clients.openWindow(SCOPE.href + path);
    })
  );
});
