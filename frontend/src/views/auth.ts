import { api, ApiError } from "../api";

export function renderAuth(root: HTMLElement, onAuthed: () => void): void {
  let mode: "login" | "signup" = "login";

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
        if (mode === "login") await api.login(email.value, password.value);
        else await api.signup(email.value, password.value);
        onAuthed();
      } catch (err) {
        errorEl.textContent = err instanceof ApiError ? err.message : "Something went wrong";
        submit.removeAttribute("disabled");
      }
    });

    const toggle = document.createElement("button");
    toggle.className = "btn";
    toggle.textContent = mode === "login" ? "Need an account? Sign up" : "Have an account? Log in";
    toggle.addEventListener("click", () => {
      mode = mode === "login" ? "signup" : "login";
      paint();
    });

    form.append(email, password, errorEl, submit, toggle);
    card.appendChild(form);
    root.appendChild(card);
  };

  paint();
}
