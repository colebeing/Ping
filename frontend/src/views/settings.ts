import { api, ApiError } from "../api";
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

    const cadenceHeader = document.createElement("div");
    cadenceHeader.style.display = "flex";
    cadenceHeader.style.alignItems = "center";
    cadenceHeader.style.justifyContent = "space-between";
    cadenceHeader.style.gap = "10px";
    const cadenceHeading = document.createElement("h3");
    cadenceHeading.style.margin = "0";
    cadenceHeading.textContent = "Check-in times";
    const frequencySelect = document.createElement("select");
    for (const [value, label] of [["twice", "Twice Daily"], ["once", "Once Daily"]] as const) {
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

    const updateLabelsForFrequency = () => {
      const isOnce = frequencySelect.value === "once";
      block1Label.textContent = isOnce ? "Check-in time" : "Morning block";
      block2Label.style.display = isOnce ? "none" : "block";
      block2Input.style.display = isOnce ? "none" : "block";
    };
    frequencySelect.addEventListener("change", updateLabelsForFrequency);
    updateLabelsForFrequency();

    const save = document.createElement("button");
    save.className = "btn btn-primary";
    save.textContent = "Save";
    save.addEventListener("click", async () => {
      save.textContent = "Saving…";
      await api.updateCadence({
        block1: block1Input.value,
        block2: block2Input.value,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        frequency: frequencySelect.value === "once" ? "once" : "twice",
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
    const testBtn = (label: string, block: "1" | "2" | "combined") => {
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
    if (me.cadence.frequency === "once") {
      testRow.append(testBtn("Test check-in", "combined"));
    } else {
      testRow.append(testBtn("Test morning", "1"), testBtn("Test evening", "2"));
    }
    pushCard.appendChild(testRow);
    pushCard.appendChild(testStatus);

    root.appendChild(pushCard);

    const inviteCard = document.createElement("div");
    inviteCard.className = "card";
    inviteCard.innerHTML = `<h3>Invite someone</h3><p class="muted">Signing up needs an invite — send one to get someone else in.</p>`;
    const inviteForm = document.createElement("div");
    inviteForm.className = "form";
    const inviteEmail = document.createElement("input");
    inviteEmail.type = "email";
    inviteEmail.placeholder = "Their email";
    const inviteStatus = document.createElement("p");
    inviteStatus.className = "muted";
    const inviteBtn = document.createElement("button");
    inviteBtn.className = "btn btn-primary";
    inviteBtn.textContent = "Send invite";
    inviteBtn.addEventListener("click", async () => {
      inviteStatus.textContent = "Sending…";
      inviteBtn.setAttribute("disabled", "true");
      try {
        await api.sendInvite(inviteEmail.value);
        inviteStatus.textContent = `Invite sent to ${inviteEmail.value}.`;
        inviteEmail.value = "";
      } catch (err) {
        inviteStatus.textContent = err instanceof ApiError ? err.message : "Couldn't send invite.";
      }
      inviteBtn.removeAttribute("disabled");
    });
    inviteForm.append(inviteEmail, inviteBtn, inviteStatus);
    inviteCard.appendChild(inviteForm);
    root.appendChild(inviteCard);
  } catch (err) {
    root.innerHTML = `<div class="card error">Couldn't load settings.</div>`;
    console.error(err);
  }
}

const HTML_ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c] ?? c);
}
