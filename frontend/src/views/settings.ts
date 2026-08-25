import { api } from "../api";
import { enablePushNotifications } from "../push-setup";

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
      await api.logout();
      onLogout();
    });
    account.appendChild(logout);
    root.appendChild(account);

    const cadenceCard = document.createElement("div");
    cadenceCard.className = "card";
    cadenceCard.innerHTML = `<h3>Check-in times</h3>`;
    const form = document.createElement("div");
    form.className = "form";

    const block1Label = document.createElement("label");
    block1Label.className = "muted";
    block1Label.textContent = "Morning block";
    const block1Input = document.createElement("input");
    block1Input.type = "time";
    block1Input.value = me.cadence.block1;

    const block2Label = document.createElement("label");
    block2Label.className = "muted";
    block2Label.textContent = "Evening block";
    const block2Input = document.createElement("input");
    block2Input.type = "time";
    block2Input.value = me.cadence.block2;

    const save = document.createElement("button");
    save.className = "btn btn-primary";
    save.textContent = "Save";
    save.addEventListener("click", async () => {
      save.textContent = "Saving…";
      await api.updateCadence({
        block1: block1Input.value,
        block2: block2Input.value,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
      save.textContent = "Saved";
      setTimeout(() => (save.textContent = "Save"), 1200);
    });

    form.append(block1Label, block1Input, block2Label, block2Input, save);
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

    const testRow = document.createElement("div");
    testRow.className = "btn-row";
    const testStatus = document.createElement("p");
    testStatus.className = "muted";
    const testBtn = (label: string, block: "1" | "2") => {
      const btn = document.createElement("button");
      btn.className = "btn";
      btn.textContent = label;
      btn.addEventListener("click", async () => {
        testStatus.textContent = "Sending…";
        try {
          await api.sendTestPush(block);
          testStatus.textContent = "Sent — check your device.";
        } catch (err) {
          testStatus.textContent = err instanceof Error ? err.message : "Couldn't send test push.";
        }
      });
      return btn;
    };
    testRow.append(testBtn("Test morning", "1"), testBtn("Test evening", "2"));
    pushCard.appendChild(testRow);
    pushCard.appendChild(testStatus);

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
