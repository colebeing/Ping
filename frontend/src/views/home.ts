import { api, type BlockId, type Cadence, type Nudge } from "../api";
import { mountBlockCard } from "../blockCard";
import { blocksForCadence, currentBlockForCadence } from "./today";
import { localDateStr, renderHistoryList } from "./history";
import { SETTINGS_ICON_SVG } from "../icons";
import { enablePushNotifications } from "../push-setup";

/** The single Home-level nudge slot — notification-permission, save-account, or whatever earned
 * checkpoint kind comes next. Recommendation nudges never land here; those render inline per-block. */
function renderNudge(container: HTMLElement, nudge: Nudge, onSettings: () => void, refresh: () => void): void {
  if (nudge.kind === "recommendation") return;
  container.innerHTML = "";

  const card = document.createElement("div");
  card.className = "card";

  const badge = document.createElement("span");
  badge.className = "pill recommendation-badge";
  badge.textContent = nudge.kind === "notification-permission" ? "Quick reminder" : "Save your account";
  card.appendChild(badge);

  const prompt = document.createElement("p");
  prompt.className = "followup-prompt";
  prompt.textContent =
    nudge.kind === "notification-permission" ? "Would you like quick reminders to answer from?" : "Would you like to save your account?";
  card.appendChild(prompt);

  const row = document.createElement("div");
  row.className = "btn-row";

  const yes = document.createElement("button");
  yes.className = "btn btn-primary";
  yes.textContent = "Yes";
  yes.addEventListener("click", async () => {
    yes.disabled = true;
    no.disabled = true;
    if (nudge.kind === "notification-permission") {
      // Answering Yes resolves the nudge outright, whether or not the OS permission prompt actually
      // gets granted — a denial here isn't something re-asking at the next checkpoint would fix (most
      // browsers won't re-prompt once denied), and the always-on Home banner already covers "still
      // not enabled" indefinitely. A successful subscribe already clears the nudge server-side (see
      // routes/push.ts); the explicit dismiss below covers the denied/unsupported case, and no-ops
      // harmlessly (404, swallowed) when the subscribe path got there first.
      await enablePushNotifications();
      await api.dismissNudge(nudge.id).catch(() => undefined);
      refresh();
    } else {
      await api.dismissNudge(nudge.id);
      onSettings();
    }
  });

  const no = document.createElement("button");
  no.className = "btn";
  no.textContent = "No";
  no.addEventListener("click", async () => {
    yes.disabled = true;
    no.disabled = true;
    await api.dismissNudge(nudge.id);
    refresh();
  });

  row.append(yes, no);
  card.appendChild(row);
  container.appendChild(card);
}

/** Has this block's own scheduled moment already happened today, in the account's timezone? Used
 * to decide which of today's blocks besides the current one are worth showing at all — a block
 * whose check-in time hasn't arrived yet has nothing to show, so it stays hidden rather than
 * appearing as an empty/locked placeholder. */
function hasReachedToday(cadenceHHMM: string, timezone: string): boolean {
  const [h, m] = cadenceHHMM.split(":").map(Number);
  const cadenceMinutes = (h % 24) * 60 + (m || 0);

  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(
    new Date(),
  );
  const hh = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10) % 24;
  const mm = parseInt(parts.find((p) => p.type === "minute")?.value ?? "0", 10);
  const nowMinutes = hh * 60 + mm;

  return cadenceMinutes <= nowMinutes;
}

/** Today's blocks worth showing right now: the current one (always, however hero-treated
 * separately) plus any earlier ones today that have already reached their own check-in time —
 * blocks still ahead of us today stay hidden until their own moment arrives. */
function visibleBlocksToday(cadence: Cadence): BlockId[] {
  const current = currentBlockForCadence(cadence);
  const all = blocksForCadence(cadence);
  return all.filter(([block, time]) => block === current || hasReachedToday(time, cadence.timezone)).map(([block]) => block);
}

export async function renderHome(root: HTMLElement, onSettings: () => void): Promise<void> {
  root.innerHTML = `<h2>Home</h2><div class="card">Loading…</div>`;
  try {
    const me = await api.me();
    root.innerHTML = "";

    const header = document.createElement("div");
    header.className = "view-header";
    const heading = document.createElement("h2");
    heading.textContent = "Home";
    const settingsBtn = document.createElement("button");
    settingsBtn.className = "header-icon-btn";
    settingsBtn.setAttribute("aria-label", "Settings");
    settingsBtn.innerHTML = SETTINGS_ICON_SVG;
    settingsBtn.addEventListener("click", onSettings);
    header.append(heading, settingsBtn);
    root.appendChild(header);

    // Reappears on every render while notifications aren't on — Ping's whole loop runs on the
    // nudge, so this isn't a one-and-done tip, unlike the earned, dismissible nudge card below.
    const pushEnabled = me.pushSubscriptionCount > 0 || me.fcmTokenCount > 0;
    if (!pushEnabled) {
      const banner = document.createElement("div");
      banner.className = "banner";
      banner.innerHTML = `<p style="margin:0 0 10px">Turn on notifications to get your check-in nudge.</p>`;
      const enableBtn = document.createElement("button");
      enableBtn.className = "btn btn-primary";
      enableBtn.textContent = "Enable notifications";
      enableBtn.addEventListener("click", async () => {
        enableBtn.textContent = "Enabling…";
        await enablePushNotifications();
        void renderHome(root, onSettings);
      });
      banner.appendChild(enableBtn);
      root.appendChild(banner);
    }

    const nudgeContainer = document.createElement("div");
    root.appendChild(nudgeContainer);

    const refreshNudge = async () => {
      const fresh = await api.me();
      if (fresh.homeNudge) renderNudge(nudgeContainer, fresh.homeNudge, onSettings, () => void refreshNudge());
      else nudgeContainer.innerHTML = "";
    };

    if (me.homeNudge) renderNudge(nudgeContainer, me.homeNudge, onSettings, () => void refreshNudge());

    const today = localDateStr(me.cadence.timezone, new Date());
    const current = currentBlockForCadence(me.cadence);
    const visible = visibleBlocksToday(me.cadence);

    // Chronological order (start of day through end of day), not
    // current-first — the current block still gets hero styling, just
    // wherever it actually falls in that order rather than always up top.
    for (const block of visible) {
      const container = document.createElement("div");
      container.className = block === current ? "today-hero" : "";
      root.appendChild(container);
      void mountBlockCard(container, block, today, () => void refreshNudge());
    }

    const toggle = document.createElement("button");
    toggle.className = "history-toggle";
    toggle.innerHTML = `<span>Show history</span><span class="chev">▾</span>`;
    root.appendChild(toggle);

    const historyContainer = document.createElement("div");
    root.appendChild(historyContainer);

    let expanded = false;
    toggle.addEventListener("click", () => {
      expanded = !expanded;
      toggle.classList.toggle("expanded", expanded);
      toggle.querySelector("span")!.textContent = expanded ? "Hide history" : "Show history";
      if (expanded) renderHistoryList(historyContainer, me.cadence, today);
      else historyContainer.innerHTML = "";
    });
  } catch (err) {
    root.innerHTML = `<div class="card error">Couldn't load Home.</div>`;
    console.error(err);
  }
}
