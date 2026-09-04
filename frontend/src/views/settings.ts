import { Capacitor } from "@capacitor/core";
import { api, ApiError } from "../api";
import { enablePushNotifications } from "../push-setup";
import { currentBlockForCadence } from "./today";
import { CHEVRON_LEFT_SVG, HOME_ICON_SVG } from "../icons";
import { getNativeGoogleIdToken } from "../googleSignIn";

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
      // Ping's own session is separate from the native Google account picker's cached
      // session — without this, the next "Sign in with Google" tap hits an already
      // signed-in Firebase Auth state and fails instead of prompting fresh.
      if (Capacitor.isNativePlatform()) {
        try {
          const { FirebaseAuthentication } = await import("@capacitor-firebase/authentication");
          await FirebaseAuthentication.signOut();
        } catch (err) {
          console.error("[ping] firebase sign-out failed", err);
        }
      }
      await api.logout();
      onLogout();
    });
    account.appendChild(logout);
    root.appendChild(account);

    if (me.email === null) {
      root.appendChild(renderClaimCard(() => void renderSettings(root, onHome, onLogout)));
    }

    const cadenceCard = document.createElement("div");
    cadenceCard.className = "card";

    const cadenceHeader = document.createElement("div");
    cadenceHeader.style.display = "flex";
    cadenceHeader.style.alignItems = "center";
    cadenceHeader.style.justifyContent = "space-between";
    cadenceHeader.style.gap = "10px";
    const cadenceHeading = document.createElement("h3");
    cadenceHeading.style.margin = "0";
    cadenceHeading.textContent = "Check-in times";
    const frequencySelect = document.createElement("select");
    for (const [value, label] of [["twice", "Twice Daily"], ["once", "Once Daily"], ["four", "4x Daily"]] as const) {
      const opt = document.createElement("option");
      opt.value = value;
      opt.textContent = label;
      frequencySelect.appendChild(opt);
    }
    frequencySelect.value = me.cadence.frequency;
    cadenceHeader.append(cadenceHeading, frequencySelect);
    cadenceCard.appendChild(cadenceHeader);

    const form = document.createElement("div");
    form.className = "form";
    form.style.marginTop = "10px";

    const block1Label = document.createElement("label");
    block1Label.className = "muted";
    const block1Input = document.createElement("input");
    block1Input.type = "time";
    block1Input.value = me.cadence.block1;

    const block2Label = document.createElement("label");
    block2Label.className = "muted";
    block2Label.textContent = "Evening block";
    const block2Input = document.createElement("input");
    block2Input.type = "time";
    block2Input.value = me.cadence.block2;

    const block3Label = document.createElement("label");
    block3Label.className = "muted";
    block3Label.textContent = "Afternoon";
    const block3Input = document.createElement("input");
    block3Input.type = "time";
    block3Input.value = me.cadence.block3 ?? "14:00";

    const block4Label = document.createElement("label");
    block4Label.className = "muted";
    block4Label.textContent = "Evening";
    const block4Input = document.createElement("input");
    block4Input.type = "time";
    block4Input.value = me.cadence.block4 ?? "18:00";

    const cadenceStatus = document.createElement("p");
    cadenceStatus.className = "muted";

    const updateLabelsForFrequency = () => {
      const freq = frequencySelect.value;
      block1Label.textContent = freq === "once" ? "Check-in time" : freq === "four" ? "Morning" : "Morning block";
      block2Label.textContent = freq === "four" ? "Midday" : "Evening block";
      const showBlock2 = freq !== "once";
      block2Label.style.display = showBlock2 ? "block" : "none";
      block2Input.style.display = showBlock2 ? "block" : "none";
      const showQuad = freq === "four";
      block3Label.style.display = showQuad ? "block" : "none";
      block3Input.style.display = showQuad ? "block" : "none";
      block4Label.style.display = showQuad ? "block" : "none";
      block4Input.style.display = showQuad ? "block" : "none";
    };
    frequencySelect.addEventListener("change", updateLabelsForFrequency);
    updateLabelsForFrequency();

    const MIN_GAP_MINUTES = 120;
    const minutesOf = (hhmm: string) => {
      const [hh, mm] = hhmm.split(":").map(Number);
      return (hh % 24) * 60 + (mm || 0);
    };
    // Times must run in increasing order through the day, and every pair (including
    // wrapping past midnight) must be at least MIN_GAP_MINUTES apart.
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
      const times =
        frequencySelect.value === "four"
          ? [block1Input.value, block2Input.value, block3Input.value, block4Input.value]
          : frequencySelect.value === "twice"
            ? [block1Input.value, block2Input.value]
            : [];
      const timesError = times.length > 0 ? checkInTimesError(times) : null;
      if (timesError) {
        cadenceStatus.textContent = timesError;
        return;
      }
      save.textContent = "Saving…";
      try {
        await api.updateCadence({
          block1: block1Input.value,
          block2: block2Input.value,
          block3: block3Input.value,
          block4: block4Input.value,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          frequency: frequencySelect.value === "once" || frequencySelect.value === "four" ? frequencySelect.value : "twice",
        });
        save.textContent = "Saved";
      } catch (err) {
        cadenceStatus.textContent = err instanceof ApiError ? err.message : "Couldn't save.";
        save.textContent = "Save";
        return;
      }
      setTimeout(() => (save.textContent = "Save"), 1200);
    });

    form.append(block1Label, block1Input, block2Label, block2Input, block3Label, block3Input, block4Label, block4Input, save, cadenceStatus);
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
 * proactive nag (Home carries the one-time nudge for that; this card is just where it points to). */
function renderClaimCard(onClaimed: () => void): HTMLElement {
  const card = document.createElement("div");
  card.className = "card";
  card.innerHTML = `<h3>Save your account</h3><p>Add an email so you can get back in on another device — nothing changes about how Ping works.</p>`;

  const email = document.createElement("input");
  email.type = "email";
  email.placeholder = "Email";
  email.autocomplete = "email";

  const password = document.createElement("input");
  password.type = "password";
  password.placeholder = "Password";
  password.autocomplete = "new-password";

  const errorEl = document.createElement("div");
  errorEl.className = "error";

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

  card.append(email, password, errorEl, save);

  // Web's Google button is a full-page redirect that never hands back an ID token to claim with —
  // password claim covers web; native gets the extra option since it can hand one over directly.
  if (Capacitor.isNativePlatform()) {
    const google = document.createElement("button");
    google.className = "btn";
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
    card.appendChild(google);
  }

  return card;
}

const HTML_ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c] ?? c);
}
