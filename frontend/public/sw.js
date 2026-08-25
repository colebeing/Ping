const CACHE_NAME = "ping-shell-v2";
const SHELL_FILES = ["./manifest.webmanifest", "./icon.svg"];

// public/ files aren't processed by Vite, so this can't read VITE_API_BASE —
// keep in sync with frontend/.env.example / the deploy workflow's VITE_API_BASE.
const API_BASE = "https://ping-backend.colebeing.workers.dev";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return; // never intercept API calls to the Worker

  // Network-first for navigations (the HTML document) and hashed build
  // assets: Vite renames JS/CSS files on every build, so a cached HTML
  // shell can end up pointing at a filename that no longer exists once a
  // new version is deployed. Only truly static files (manifest/icon) are
  // cache-first. Falls back to cache only when there's no network at all.
  if (event.request.mode === "navigate" || url.pathname.includes("/assets/")) {
    event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
    return;
  }

  event.respondWith(caches.match(event.request).then((cached) => cached ?? fetch(event.request)));
});

self.addEventListener("push", (event) => {
  let payload = { title: "Ping", body: "Did today go how you wanted?" };
  if (event.data) {
    try {
      payload = { ...payload, ...event.data.json() };
    } catch {
      payload.body = event.data.text();
    }
  }

  const options = { body: payload.body, icon: "./icon.svg", badge: "./icon.svg" };
  if (payload.block) {
    // Two is the practical ceiling for notification actions across browsers,
    // which is exactly enough for yes/no. The 4-way follow-up categories
    // can't fit as actions, so those still need the app open — see below.
    options.tag = `block-${payload.block}`;
    options.data = { block: payload.block };
    options.actions = [
      { action: `answer-${payload.block}-yes`, title: "Yes" },
      { action: `answer-${payload.block}-no`, title: "No" },
    ];
  }

  event.waitUntil(self.registration.showNotification(payload.title, options));
});

self.addEventListener("notificationclick", (event) => {
  const action = event.action;
  event.notification.close();

  if (action.startsWith("answer-")) {
    const [, block, answer] = action.split("-");
    event.waitUntil(answerFromNotification(block, answer));
    return;
  }

  event.waitUntil(focusOrOpenApp());
});

async function answerFromNotification(block, answer) {
  try {
    await fetch(`${API_BASE}/api/answer`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ block, answer }),
    });
  } catch (err) {
    console.error("quick-answer failed", err);
  }
  // Whether or not the fetch succeeded (e.g. session expired), opening the
  // app is the right fallback — it'll show the real state, including login
  // if needed.
  await focusOrOpenApp({ type: "ping:go-to-today" });
}

async function focusOrOpenApp(message) {
  const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  const existing = clients[0];
  if (existing) {
    if (message) existing.postMessage(message);
    return existing.focus();
  }
  return self.clients.openWindow("./");
}
