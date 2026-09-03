import { Capacitor } from "@capacitor/core";
import { api, ApiError } from "../api";
import { enablePushNotifications } from "../push-setup";
import { currentBlockForCadence } from "./today";

export async function renderSettings(root: HTMLElement, onLogout: () => void): Promise<void> {
  root.innerHTML = `<h2>Settings</h2><div class="card">Loading…</div>`;
  try {
    const me = await api.me();
    root.innerHTML = "";

    const heading = document.createElement("h2");
    heading.textContent = "Settings";
    root.appendChild(heading);

    const account = document.createElement("div");
    account.className = "card";
    account.innerHTML = `<p class="muted">Signed in as</p><h3>${escapeHtml(me.email)}</h3>`;
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

    const pushCard = document.createElement("div");
    pushCard.className = "card";
    pushCard.innerHTML = `<h3>Notifications</h3><p>${
      me.pushSubscriptionCount > 0 ? "Push notifications are on for this device." : "Get a nudge at your check-in times."
    }</p>`;
    const enableBtn = document.createElement("button");
    enableBtn.className = "btn";
    enableBtn.textContent = me.pushSubscriptionCount > 0 ? "Re-enable on this device" : "Enable notifications";
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

const HTML_ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c] ?? c);
}
