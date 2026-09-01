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

  if (payload.block) {
    event.waitUntil(showYesNoNotifications(payload));
    return;
  }

  event.waitUntil(self.registration.showNotification(payload.title, { body: payload.body, icon: "./icon.svg", badge: "./icon.svg" }));
});

/**
 * Yes and No as two separate single-action notifications, not one
 * notification with two actions. On Android, Chrome collapses multiple
 * actions on the same notification to whichever was declared last,
 * regardless of which is tapped — confirmed via isolation testing (content,
 * array order, and action count all ruled in/out) and confirmed
 * Chrome-specific (Firefox on the identical device/OS doesn't have this
 * bug), so it's filed upstream rather than fixable here. A lone action
 * reports correctly, so this sidesteps it entirely at the cost of two tray
 * entries instead of one.
 */
async function showYesNoNotifications(payload) {
  const base = { body: payload.body, icon: "./icon.svg", badge: "./icon.svg", data: { block: payload.block } };
  await Promise.all([
    self.registration.showNotification(payload.title, { ...base, tag: `block-${payload.block}-yes`, actions: [{ action: "yes", title: "Yes" }] }),
    self.registration.showNotification(payload.title, { ...base, tag: `block-${payload.block}-no`, actions: [{ action: "no", title: "No" }] }),
  ]);
}

self.addEventListener("notificationclick", (event) => {
  const action = event.action;
  const block = event.notification.data?.block;
  event.notification.close();

  if (action === "yes" || action === "no") {
    event.waitUntil(answerFromNotification(block, action));
    return;
  }

  // Route to the specific block this notification was for — not just
  // whatever the app's own "current block" logic would pick — so tapping,
  // say, the morning notification always opens the morning check-in even if
  // the view has since moved on to evening.
  event.waitUntil(focusOrOpenApp(block ? { type: "ping:go-to-block", block } : undefined));
});

async function answerFromNotification(block, answer) {
  try {
    const res = await fetch(`${API_BASE}/api/answer`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ block, answer }),
    });
    // fetch() only rejects on a network-level failure, not an HTTP error
    // status — without this, a rejected request (e.g. an expired session)
    // would silently no-op instead of surfacing anywhere.
    if (!res.ok) console.error("quick-answer rejected", res.status);
  } catch (err) {
    console.error("quick-answer failed", err);
  }

  // Yes/No are two separate notifications now (see showYesNoNotifications) —
  // once one's been tapped, close the other so it can't be tapped afterward
  // and overwrite the answer just recorded.
  const siblingTag = `block-${block}-${answer === "yes" ? "no" : "yes"}`;
  const siblings = await self.registration.getNotifications({ tag: siblingTag });
  for (const n of siblings) n.close();

  // Whether or not the fetch succeeded (e.g. session expired), opening the
  // app is the right fallback — it'll show the real state, including login
  // if needed.
  await focusOrOpenApp({ type: "ping:go-to-block", block });
}

async function focusOrOpenApp(message) {
  const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  if (clients.length > 0) {
    // Every open tab needs to know, not just the one we're about to focus —
    // an un-refreshed stale tab still showing "Yes/No" could otherwise
    // overwrite a just-recorded answer if it's tapped later.
    if (message) for (const client of clients) client.postMessage(message);
    return clients[0].focus();
  }
  return self.clients.openWindow("./");
}
