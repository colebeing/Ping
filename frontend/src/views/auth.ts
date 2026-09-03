import { Capacitor } from "@capacitor/core";
import { api, ApiError } from "../api";

type Mode = "login" | "signup" | "forgot" | "forgot-sent" | "reset" | "reset-done";

const OAUTH_ERROR_MESSAGES: Record<string, string> = {
  "google-auth-failed": "Google sign-in didn't work. Try again?",
  "google-auth-expired": "That sign-in attempt expired. Try again.",
  "google-email-unverified": "That Google account's email isn't verified.",
};

export function renderAuth(root: HTMLElement, onAuthed: () => void): void {
  const params = new URLSearchParams(window.location.search);
  const resetToken = params.get("reset");
  let oauthError = params.get("error");

  let mode: Mode = resetToken ? "reset" : "login";

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
      p.textContent = "Password updated. Log in with your new password.";
      const back = button("Back to log in", "btn btn-primary", () => {
        mode = "login";
        paint();
      });
      form.append(p, back);
    } else if (mode === "forgot") {
      renderForgotForm(form, errorEl);
    } else if (mode === "forgot-sent") {
      const p = document.createElement("p");
      p.textContent = "If that email has an account, a reset link is on its way.";
      const back = button("Back to log in", "btn", () => {
        mode = "login";
        paint();
      });
      form.append(p, back);
    } else {
      renderLoginOrSignup(form, errorEl);
    }

    card.appendChild(form);
    root.appendChild(card);
  };

  function renderLoginOrSignup(form: HTMLElement, errorEl: HTMLElement) {
    if (oauthError) {
      errorEl.textContent = OAUTH_ERROR_MESSAGES[oauthError] ?? "Something went wrong signing in with Google.";
      oauthError = null;
    }

    const email = document.createElement("input");
    email.type = "email";
    email.placeholder = "Email";
    email.autocomplete = "email";

    const password = document.createElement("input");
    password.type = "password";
    password.placeholder = "Password";
    password.autocomplete = mode === "login" ? "current-password" : "new-password";

    const submit = document.createElement("button");
    submit.className = "btn btn-primary";
    submit.textContent = mode === "login" ? "Log in" : "Sign up";
    submit.addEventListener("click", async () => {
      errorEl.textContent = "";
      submit.setAttribute("disabled", "true");
      try {
        if (mode === "login") {
          await api.login(email.value, password.value);
        } else {
          await api.signup(email.value, password.value);
        }
        onAuthed();
      } catch (err) {
        console.error("[ping] auth failed", err);
        errorEl.textContent = err instanceof ApiError ? err.message : "Something went wrong";
        submit.removeAttribute("disabled");
      }
    });

    form.append(email, password, errorEl, submit);

    const google = button("Sign in with Google", "btn", async () => {
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
        const { FirebaseAuthentication } = await import("@capacitor-firebase/authentication");
        const result = await FirebaseAuthentication.signInWithGoogle();
        const idToken = result.credential?.idToken;
        if (!idToken) throw new Error("Google didn't return a usable sign-in token");
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
    form.appendChild(google);

    if (mode === "login") {
      const forgot = button("Forgot password?", "btn", () => {
        mode = "forgot";
        paint();
      });
      form.appendChild(forgot);
    }

    const toggle = button(mode === "login" ? "New here? Sign up" : "Have an account? Log in", "btn", () => {
      mode = mode === "login" ? "signup" : "login";
      paint();
    });
    form.appendChild(toggle);
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

    const back = button("Back to log in", "btn", () => {
      mode = "login";
      paint();
    });

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
