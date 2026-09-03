import { api, type BlockId, type Cadence } from "../api";
import { mountBlockCard } from "../blockCard";
import { blocksForCadence, currentBlockForCadence } from "./today";
import { localDateStr, renderHistoryList } from "./history";
import { GEAR_ICON_SVG } from "../icons";

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
    settingsBtn.innerHTML = GEAR_ICON_SVG;
    settingsBtn.addEventListener("click", onSettings);
    header.append(heading, settingsBtn);
    root.appendChild(header);

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
      void mountBlockCard(container, block, today);
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
