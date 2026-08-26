import { api, type BlockId, type Cadence } from "../api";
import { mountBlockCard } from "../blockCard";

/**
 * The current block is whichever check-in is coming up next — Morning owns
 * the stretch from the previous Evening reminder up to this Morning's
 * reminder, Evening owns the stretch from Morning's reminder up to Evening's.
 * Purely time-based (compares wall-clock time against cadence), so this
 * flips right on schedule regardless of whether the push notification has
 * actually fired yet.
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

  const until = (target: number) => (target - now + 1440) % 1440;
  return until(toMinutes(cadence.block1)) <= until(toMinutes(cadence.block2)) ? "1" : "2";
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
    block = me.cadence.frequency === "once" ? "combined" : currentBlock(me.cadence);
  } catch {
    // fall through with block "1" — mountBlockCard's own error handling covers a real auth failure
  }

  void mountBlockCard(card, block);
}
