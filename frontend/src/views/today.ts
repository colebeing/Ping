import { api, type BlockId, type Cadence } from "../api";
import { mountBlockCard } from "../blockCard";

// Grace period after a block's own cadence time before the other block takes
// over as "current" — without this, the switch happens the instant the
// block's own scheduled time passes, so opening the app even a minute after
// tapping that block's own notification could already show the next block.
const BLOCK_SWITCH_DELAY_MINUTES = 60;

/**
 * The current block is whichever check-in is coming up next — Morning owns
 * the stretch from the previous Evening reminder up to this Morning's
 * reminder, Evening owns the stretch from Morning's reminder up to Evening's.
 * Purely time-based (compares wall-clock time against cadence), so this
 * flips on schedule regardless of whether the push notification has actually
 * fired yet — delayed by BLOCK_SWITCH_DELAY_MINUTES so there's room to
 * actually act on that notification before the view moves on.
 */
/** Of a set of (block, cadence time) candidates, picks whichever one's own reminder time is coming up soonest. */
function pickSoonestBlock(timezone: string, candidates: [BlockId, string][]): BlockId {
  const toMinutes = (hhmm: string) => {
    const [h, m] = hhmm.split(":").map(Number);
    return ((h % 24) * 60 + (m || 0) + 1440) % 1440;
  };
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const hh = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10) % 24;
  const mm = parseInt(parts.find((p) => p.type === "minute")?.value ?? "0", 10);
  const now = (hh * 60 + mm - BLOCK_SWITCH_DELAY_MINUTES + 1440) % 1440;

  const until = (target: number) => (target - now + 1440) % 1440;
  let best = candidates[0];
  let bestUntil = until(toMinutes(best[1]));
  for (const candidate of candidates.slice(1)) {
    const candidateUntil = until(toMinutes(candidate[1]));
    if (candidateUntil < bestUntil) {
      best = candidate;
      bestUntil = candidateUntil;
    }
  }
  return best[0];
}

export function currentBlock(cadence: Cadence): BlockId {
  return pickSoonestBlock(cadence.timezone, [
    ["1", cadence.block1],
    ["2", cadence.block2],
  ]);
}

function currentQuadBlock(cadence: Cadence): BlockId {
  return pickSoonestBlock(cadence.timezone, [
    ["q1", cadence.block1],
    ["q2", cadence.block2],
    ["q3", cadence.block3 ?? cadence.block1],
    ["q4", cadence.block4 ?? cadence.block2],
  ]);
}

/** Which block "Today" is currently showing, accounting for once-daily cadence collapsing everything to "combined" and four-daily cadence expanding to four independent blocks. */
export function currentBlockForCadence(cadence: Cadence): BlockId {
  if (cadence.frequency === "once") return "combined";
  if (cadence.frequency === "four") return currentQuadBlock(cadence);
  return currentBlock(cadence);
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
    block = currentBlockForCadence(me.cadence);
  } catch {
    // fall through with block "1" — mountBlockCard's own error handling covers a real auth failure
  }

  void mountBlockCard(card, block);
}
