import { Capacitor } from "@capacitor/core";
import { api, ApiError, LIVE_BLOCKS, type LiveBlockId } from "../api";
import { enablePushNotifications } from "../push-setup";
import { currentBlockForCadence } from "./today";
import { CHEVRON_LEFT_SVG, HOME_ICON_SVG } from "../icons";
import { getNativeGoogleIdToken } from "../googleSignIn";
import { BLOCK_LABEL } from "../blockCard";

/** Shared by the Log out button and the claim card's "Sign in" link — both need the exact same
 * teardown (Ping's own session, plus the native Google account picker's separately-cached Firebase
 * session) so the next "Sign in with Google" tap prompts fresh instead of hitting a stale one. */
async function endSession(): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    try {
      const { FirebaseAuthentication } = await import("@capacitor-firebase/authentication");
      await FirebaseAuthentication.signOut();
    } catch (err) {
      console.error("[ping] firebase sign-out failed", err);
    }
  }
  await api.logout();
}

export async function renderSettings(root: HTMLElement, onHome: () => void, onLogout: () => void): Promise<void> {
  root.innerHTML = `<h2>Settings</h2><div class="card">Loading…</div>`;
  try {
    const me = await api.me();
    root.innerHTML = "";

    const header = document.createElement("div");
    header.className = "view-header";

    const back = document.createElement("button");
    back.className = "header-back";
    back.innerHTML = `${CHEVRON_LEFT_SVG}<span>Back</span>`;
    back.addEventListener("click", onHome);

    const heading = document.createElement("h2");
    heading.textContent = "Settings";

    const homeBtn = document.createElement("button");
    homeBtn.className = "header-icon-btn";
    homeBtn.setAttribute("aria-label", "Home");
    homeBtn.innerHTML = HOME_ICON_SVG;
    homeBtn.addEventListener("click", onHome);

    header.append(back, heading, homeBtn);
    root.appendChild(header);

    const account = document.createElement("div");
    account.className = "card";
    account.innerHTML =
      me.email !== null
        ? `<p class="muted">Signed in as</p><h3>${escapeHtml(me.email)}</h3>`
        : `<p class="muted">Using Ping without an account</p><h3>Not saved yet</h3>`;
    const logout = document.createElement("button");
    logout.className = "btn";
    logout.textContent = "Log out";
    logout.addEventListener("click", async () => {
      await endSession();
      onLogout();
    });
    account.appendChild(logout);
    root.appendChild(account);

    if (me.email === null) {
      root.appendChild(
        renderClaimCard(
          () => void renderSettings(root, onHome, onLogout),
          async () => {
            await endSession();
            onLogout();
          },
        ),
      );
    }

    const cadenceCard = document.createElement("div");
    cadenceCard.className = "card";

    const cadenceHeading = document.createElement("h3");
    cadenceHeading.textContent = "Check-in times";
    cadenceCard.appendChild(cadenceHeading);

    const form = document.createElement("div");
    form.style.marginTop = "10px";

    const timeInputs = {} as Record<LiveBlockId, HTMLInputElement>;
    const skipChecks = {} as Record<LiveBlockId, HTMLInputElement>;

    for (const block of LIVE_BLOCKS) {
      const row = document.createElement("div");
      row.style.display = "flex";
      row.style.alignItems = "center";
      row.style.gap = "10px";
      row.style.marginBottom = "10px";

      const check = document.createElement("input");
      check.type = "checkbox";
      check.checked = !me.cadence.skippedBlocks.includes(block);
      skipChecks[block] = check;

      const label = document.createElement("label");
      label.className = "muted";
      label.textContent = BLOCK_LABEL[block];
      label.style.minWidth = "70px";

      const time = document.createElement("input");
      time.type = "time";
      time.value = me.cadence.times[block];
      time.style.marginBottom = "0";
      time.disabled = !check.checked;
      timeInputs[block] = time;

      check.addEventListener("change", () => (time.disabled = !check.checked));

      row.append(check, label, time);
      form.appendChild(row);
    }

    const cadenceStatus = document.createElement("p");
    cadenceStatus.className = "muted";

    const MIN_GAP_MINUTES = 120;
    const minutesOf = (hhmm: string) => {
      const [hh, mm] = hhmm.split(":").map(Number);
      return (hh % 24) * 60 + (mm || 0);
    };
    // Times must run in increasing order through the day, and every pair (including
    // wrapping past midnight) must be at least MIN_GAP_MINUTES apart. Only checked among
    // the blocks currently enabled — a skipped block's stored time is inert.
    const checkInTimesError = (times: string[]): string | null => {
      const minutes = times.map(minutesOf);
      for (let i = 1; i < minutes.length; i++) {
        if (minutes[i] <= minutes[i - 1]) return "Check-in times must be in order, earliest to latest.";
      }
      for (let i = 0; i < minutes.length; i++) {
        for (let j = i + 1; j < minutes.length; j++) {
          const diff = Math.abs(minutes[i] - minutes[j]);
          if (Math.min(diff, 1440 - diff) < MIN_GAP_MINUTES) return "Check-in times must each be at least two hours apart.";
        }
      }
      return null;
    };

    const save = document.createElement("button");
    save.className = "btn btn-primary";
    save.textContent = "Save";
    save.addEventListener("click", async () => {
      cadenceStatus.textContent = "";
      const skippedBlocks = LIVE_BLOCKS.filter((b) => !skipChecks[b].checked);
      if (skippedBlocks.length === LIVE_BLOCKS.length) {
        cadenceStatus.textContent = "At least one check-in must stay on.";
        return;
      }
      const activeTimes = LIVE_BLOCKS.filter((b) => !skippedBlocks.includes(b)).map((b) => timeInputs[b].value);
      const timesError = checkInTimesError(activeTimes);
      if (timesError) {
        cadenceStatus.textContent = timesError;
        return;
      }
      save.textContent = "Saving…";
      try {
        const times = Object.fromEntries(LIVE_BLOCKS.map((b) => [b, timeInputs[b].value])) as Record<LiveBlockId, string>;
        await api.updateCadence({
          times,
          skippedBlocks,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        });
        save.textContent = "Saved";
      } catch (err) {
        cadenceStatus.textContent = err instanceof ApiError ? err.message : "Couldn't save.";
        save.textContent = "Save";
        return;
      }
      setTimeout(() => (save.textContent = "Save"), 1200);
    });

    form.append(save, cadenceStatus);
    cadenceCard.appendChild(form);
    root.appendChild(cadenceCard);

    const pushEnabled = me.pushSubscriptionCount > 0 || me.fcmTokenCount > 0;
    const pushCard = document.createElement("div");
    pushCard.className = "card";
    pushCard.innerHTML = `<h3>Notifications</h3><p>${
      pushEnabled ? "Push notifications are on for this device." : "Get a nudge at your check-in times."
    }</p>`;
    const enableBtn = document.createElement("button");
    enableBtn.className = "btn";
    enableBtn.textContent = pushEnabled ? "Re-enable on this device" : "Enable notifications";
    enableBtn.addEventListener("click", async () => {
      enableBtn.textContent = "Enabling…";
      const result = await enablePushNotifications();
      enableBtn.textContent = result.ok ? "Enabled" : result.reason ?? "Couldn't enable";
    });
    pushCard.appendChild(enableBtn);

    if (me.isAdmin) {
      const testRow = document.createElement("div");
      testRow.className = "btn-row";
      const testStatus = document.createElement("p");
      testStatus.className = "muted";
      const testBtn = document.createElement("button");
      testBtn.className = "btn";
      testBtn.textContent = "Test notification";
      testBtn.addEventListener("click", async () => {
        testStatus.textContent = "Sending…";
        try {
          await api.sendTestPush(currentBlockForCadence(me.cadence));
          testStatus.textContent = "Sent — check your device.";
        } catch (err) {
          testStatus.textContent = err instanceof Error ? err.message : "Couldn't send test push.";
        }
      });
      testRow.append(testBtn);
      pushCard.appendChild(testRow);
      pushCard.appendChild(testStatus);
    }

    root.appendChild(pushCard);
  } catch (err) {
    root.innerHTML = `<div class="card error">Couldn't load settings.</div>`;
    console.error(err);
  }
}

/** Shown only for an unclaimed anonymous account — a quiet, always-available option, never a
 * proactive nag (Home carries the one-time nudge for that; this card is just where it points to).
 * Google leads when it's available; email sign-in sits one tap further away behind a plain link,
 * matching the same pattern the sign-in screen uses. */
function renderClaimCard(onClaimed: () => void, onSignIn: () => void): HTMLElement {
  const card = document.createElement("div");
  card.className = "card";
  card.innerHTML = `<h3>Save your account</h3><p>So you can return on another device.</p>`;

  const errorEl = document.createElement("div");
  errorEl.className = "error";

  // Web's Google button is a full-page redirect that never hands back an ID token to claim with —
  // password claim covers web; native gets the extra option since it can hand one over directly.
  if (Capacitor.isNativePlatform()) {
    const google = document.createElement("button");
    google.className = "btn btn-primary";
    google.textContent = "Continue with Google";
    google.addEventListener("click", async () => {
      errorEl.textContent = "";
      google.setAttribute("disabled", "true");
      try {
        const idToken = await getNativeGoogleIdToken();
        await api.claimWithGoogleIdToken(idToken);
        // The old device token (minted for the anonymous id) is now stale — re-registering mints a
        // fresh one under the newly-claimed id so background notification actions keep working.
        await enablePushNotifications().catch(() => undefined);
        onClaimed();
      } catch (err) {
        errorEl.textContent = err instanceof ApiError ? err.message : "Couldn't save your account.";
        google.removeAttribute("disabled");
      }
    });
    card.append(google, errorEl);
  } else {
    card.appendChild(errorEl);
  }

  const emailGroup = document.createElement("div");
  emailGroup.style.display = "none";

  const emailLabel = document.createElement("p");
  emailLabel.className = "link-btn";
  emailLabel.style.cursor = "default";
  emailLabel.textContent = "Save with email";

  const email = document.createElement("input");
  email.type = "email";
  email.placeholder = "Email";
  email.autocomplete = "email";

  const password = document.createElement("input");
  password.type = "password";
  password.placeholder = "Password";
  password.autocomplete = "new-password";

  const save = document.createElement("button");
  save.className = "btn btn-primary";
  save.textContent = "Save account";
  save.addEventListener("click", async () => {
    errorEl.textContent = "";
    save.setAttribute("disabled", "true");
    try {
      await api.claimWithPassword(email.value, password.value);
      onClaimed();
    } catch (err) {
      errorEl.textContent = err instanceof ApiError ? err.message : "Couldn't save your account.";
      save.removeAttribute("disabled");
    }
  });

  emailGroup.append(emailLabel, email, password, save);

  const showEmail = document.createElement("button");
  showEmail.className = "link-btn";
  showEmail.textContent = "Save with email";
  showEmail.addEventListener("click", () => {
    showEmail.style.display = "none";
    emailGroup.style.display = "block";
  });

  card.append(showEmail, emailGroup);

  const signIn = document.createElement("button");
  signIn.className = "link-btn";
  signIn.textContent = "Already have an account? Sign in";
  signIn.addEventListener("click", onSignIn);
  card.appendChild(signIn);

  return card;
}

const HTML_ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c] ?? c);
}
