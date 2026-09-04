import { Capacitor } from "@capacitor/core";
import { api, ApiError } from "../api";
import { getNativeGoogleIdToken } from "../googleSignIn";

type Mode = "start" | "forgot" | "forgot-sent" | "reset" | "reset-done";

const OAUTH_ERROR_MESSAGES: Record<string, string> = {
  "google-auth-failed": "Google sign-in didn't work. Try again?",
  "google-auth-expired": "That sign-in attempt expired. Try again.",
  "google-email-unverified": "That Google account's email isn't verified.",
};

export function renderAuth(root: HTMLElement, onAuthed: () => void): void {
  const params = new URLSearchParams(window.location.search);
  const resetToken = params.get("reset");
  let oauthError = params.get("error");

  let mode: Mode = resetToken ? "reset" : "start";
  // Email sign-in is deliberately one tap further away than Google — collapsed by default so
  // Google reads as the lead option, not just the first one in a list.
  let emailExpanded = false;

  const goToStart = () => {
    mode = "start";
    emailExpanded = false;
    paint();
  };

  const paint = () => {
    root.innerHTML = "";

    const heading = document.createElement("h1");
    heading.textContent = "Ping";
    const sub = document.createElement("p");
    sub.textContent = "Did today go how you wanted?";
    root.append(heading, sub);

    const card = document.createElement("div");
    card.className = "card";
    const form = document.createElement("div");
    form.className = "form";
    const errorEl = document.createElement("div");
    errorEl.className = "error";

    if (mode === "reset") {
      renderResetForm(form, errorEl);
    } else if (mode === "reset-done") {
      const p = document.createElement("p");
      p.textContent = "Password updated. Sign in with your new password.";
      const back = button("Back to sign in", "btn btn-primary", goToStart);
      form.append(p, back);
    } else if (mode === "forgot") {
      renderForgotForm(form, errorEl);
    } else if (mode === "forgot-sent") {
      const p = document.createElement("p");
      p.textContent = "If that email has an account, a reset link is on its way.";
      const back = button("Back to sign in", "btn", goToStart);
      form.append(p, back);
    } else {
      renderStart(form, errorEl);
    }

    card.appendChild(form);
    root.appendChild(card);
  };

  function renderStart(form: HTMLElement, errorEl: HTMLElement) {
    if (oauthError) {
      errorEl.textContent = OAUTH_ERROR_MESSAGES[oauthError] ?? "Something went wrong signing in with Google.";
      oauthError = null;
    }

    const google = button("Sign in with Google", "btn btn-primary", async () => {
      // The web redirect flow (window.location.href to Google's consent page) doesn't work inside
      // the native app's WebView — Google blocks completing sign-in in an embedded browser, so
      // Android just kicks the flow out to a real browser with no way back into the app. Native
      // Google Sign-In (the OS's own account picker, no browser at all) sidesteps that entirely.
      if (!Capacitor.isNativePlatform()) {
        window.location.href = api.googleSignInUrl();
        return;
      }
      errorEl.textContent = "";
      google.setAttribute("disabled", "true");
      try {
        const idToken = await getNativeGoogleIdToken();
        await api.loginWithGoogleIdToken(idToken);
        onAuthed();
      } catch (err) {
        console.error("[ping] native google sign-in failed", err);
        // Surface whatever the plugin/backend actually said instead of a static
        // fallback — a silent generic message is what made this class of bug
        // (e.g. a stale native session after logout) hard to diagnose from a report alone.
        const detail = err instanceof ApiError ? err.message : err instanceof Error ? err.message : null;
        errorEl.textContent = detail ? `Google sign-in didn't work: ${detail}` : "Google sign-in didn't work. Try again?";
        google.removeAttribute("disabled");
      }
    });
    form.append(google, errorEl);

    if (!emailExpanded) {
      const showEmail = button("Sign in with email", "link-btn", () => {
        emailExpanded = true;
        paint();
      });
      form.appendChild(showEmail);
      return;
    }

    const emailLabel = document.createElement("p");
    emailLabel.className = "link-btn";
    emailLabel.style.cursor = "default";
    emailLabel.textContent = "Sign in with email";
    form.appendChild(emailLabel);

    const email = document.createElement("input");
    email.type = "email";
    email.placeholder = "Email";
    email.autocomplete = "email";

    const password = document.createElement("input");
    password.type = "password";
    password.placeholder = "Password";
    password.autocomplete = "current-password";

    // Agnostic on purpose: a new email creates the account right here instead of a separate signup
    // form — signing up and signing in felt like the same action, so now they are one.
    const submit = document.createElement("button");
    submit.className = "btn btn-primary";
    submit.textContent = "Sign in";
    submit.addEventListener("click", async () => {
      errorEl.textContent = "";
      submit.setAttribute("disabled", "true");
      try {
        await api.login(email.value, password.value);
        onAuthed();
      } catch (err) {
        console.error("[ping] auth failed", err);
        errorEl.textContent = err instanceof ApiError ? err.message : "Something went wrong";
        submit.removeAttribute("disabled");
      }
    });

    const forgot = button("Forgot password?", "link-btn", () => {
      mode = "forgot";
      paint();
    });

    form.append(email, password, submit, forgot);
  }

  function renderForgotForm(form: HTMLElement, errorEl: HTMLElement) {
    const p = document.createElement("p");
    p.textContent = "Enter your email and we'll send a reset link.";
    const email = document.createElement("input");
    email.type = "email";
    email.placeholder = "Email";
    email.autocomplete = "email";

    const submit = document.createElement("button");
    submit.className = "btn btn-primary";
    submit.textContent = "Send reset link";
    submit.addEventListener("click", async () => {
      submit.setAttribute("disabled", "true");
      try {
        await api.requestPasswordReset(email.value);
      } catch {
        // Endpoint always returns ok; only network-level failures land here.
      }
      mode = "forgot-sent";
      paint();
    });

    const back = button("Back to sign in", "btn", goToStart);

    form.append(p, email, errorEl, submit, back);
  }

  function renderResetForm(form: HTMLElement, errorEl: HTMLElement) {
    const p = document.createElement("p");
    p.textContent = "Choose a new password.";
    const password = document.createElement("input");
    password.type = "password";
    password.placeholder = "New password";
    password.autocomplete = "new-password";

    const submit = document.createElement("button");
    submit.className = "btn btn-primary";
    submit.textContent = "Set new password";
    submit.addEventListener("click", async () => {
      errorEl.textContent = "";
      submit.setAttribute("disabled", "true");
      try {
        await api.confirmPasswordReset(resetToken as string, password.value);
        mode = "reset-done";
        paint();
      } catch (err) {
        errorEl.textContent = err instanceof ApiError ? err.message : "Something went wrong";
        submit.removeAttribute("disabled");
      }
    });

    form.append(p, password, errorEl, submit);
  }

  paint();
}

function button(text: string, className: string, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.className = className;
  btn.textContent = text;
  btn.addEventListener("click", onClick);
  return btn;
}
