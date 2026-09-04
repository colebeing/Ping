import { api, ApiError } from "../api";
import { enablePushNotifications } from "../push-setup";

/**
 * The very first thing an unauthenticated visitor sees — one button, no typing, no account. Tapping
 * it mints an anonymous session (api.startAnonymous) and asks for notification permission; either
 * way the permission prompt resolves (granted or denied), it lands in the app — denial isn't a wall,
 * it just means Home keeps showing a reminder banner until it's turned on. Adding a real email or
 * Google account is something Settings offers later, never a requirement to get in.
 */
export function renderOnboarding(root: HTMLElement, onDone: () => void, onLogin: () => void): void {
  root.innerHTML = "";

  const heading = document.createElement("h1");
  heading.textContent = "Ping";
  const sub = document.createElement("p");
  sub.textContent = "Did today go how you wanted?";
  root.append(heading, sub);

  const card = document.createElement("div");
  card.className = "card";

  const blurb = document.createElement("p");
  blurb.textContent = "Ping nudges you to check in — turn on notifications to get started.";

  const errorEl = document.createElement("div");
  errorEl.className = "error";

  const start = document.createElement("button");
  start.className = "btn btn-primary";
  start.textContent = "Enable notifications";
  start.addEventListener("click", async () => {
    errorEl.textContent = "";
    start.setAttribute("disabled", "true");
    start.textContent = "Setting up…";
    try {
      await api.startAnonymous();
    } catch (err) {
      console.error("[ping] anonymous start failed", err);
      errorEl.textContent = err instanceof ApiError ? err.message : "Something went wrong. Try again?";
      start.removeAttribute("disabled");
      start.textContent = "Enable notifications";
      return;
    }
    // Denied or unsupported still lands in the app — Home's own reminder banner covers it from here.
    await enablePushNotifications().catch(() => undefined);
    onDone();
  });

  const login = document.createElement("button");
  login.className = "btn";
  login.textContent = "Already have an account? Log in";
  login.addEventListener("click", onLogin);

  card.append(blurb, errorEl, start, login);
  root.appendChild(card);
}
