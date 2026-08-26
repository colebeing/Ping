import { api, type BlockId, type Cadence } from "../api";
import { mountBlockCard } from "../blockCard";

/**
 * Splits the day in half at the midpoints between the two check-in times,
 * so "current" flips as soon as you're past the halfway point toward the
 * next one — not only once it's actually fired. With 11:55am/11:55pm, that
 * means Evening becomes current at 5:55pm, not at 11:55pm.
 */
function currentBlock(cadence: Cadence): BlockId {
  const toMinutes = (hhmm: string) => {
    const [h, m] = hhmm.split(":").map(Number);
    return ((h % 24) * 60 + (m || 0) + 1440) % 1440;
  };
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: cadence.timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const hh = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10) % 24;
  const mm = parseInt(parts.find((p) => p.type === "minute")?.value ?? "0", 10);
  const now = hh * 60 + mm;

  const b1 = toMinutes(cadence.block1);
  const b2 = toMinutes(cadence.block2);
  const midAfterB1 = (b1 + ((b2 - b1 + 1440) % 1440) / 2) % 1440; // midpoint between block1 and block2
  const midAfterB2 = (b2 + ((b1 - b2 + 1440) % 1440) / 2) % 1440; // midpoint between block2 and next-day block1

  const inRange = (value: number, start: number, end: number) =>
    start <= end ? value >= start && value < end : value >= start || value < end;

  return inRange(now, midAfterB2, midAfterB1) ? "1" : "2";
}

export async function renderToday(root: HTMLElement): Promise<void> {
  root.innerHTML = "";
  const heading = document.createElement("h2");
  heading.textContent = "Today";
  root.appendChild(heading);

  const card = document.createElement("div");
  root.appendChild(card);

  let block: BlockId = "1";
  try {
    const me = await api.me();
    block = currentBlock(me.cadence);
  } catch {
    // fall through with block "1" — mountBlockCard's own error handling covers a real auth failure
  }

  void mountBlockCard(card, block);
}
