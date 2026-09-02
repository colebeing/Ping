import type { BlockId, Cadence } from "../api";

// Grace period after a block's own cadence time before the next block takes
// over as "current" — without this, the switch happens the instant the
// block's own scheduled time passes, so opening the app even a minute after
// tapping that block's own notification could already show the next block.
// Two hours protects the full check-in window regardless of cadence.
const BLOCK_SWITCH_DELAY_MINUTES = 120;

/**
 * A block owns the stretch of time from the end of the previous block's own
 * window up through two hours after its own check-in time. Purely time-based
 * (compares wall-clock time against cadence), so this flips on schedule
 * regardless of whether the push notification has actually fired yet —
 * delayed by BLOCK_SWITCH_DELAY_MINUTES so there's room to actually act on
 * that notification before the view moves on.
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

/** Which block is currently active, accounting for once-daily cadence collapsing everything to "combined" and four-daily cadence expanding to four independent blocks. */
export function currentBlockForCadence(cadence: Cadence): BlockId {
  if (cadence.frequency === "once") return "combined";
  if (cadence.frequency === "four") return currentQuadBlock(cadence);
  return currentBlock(cadence);
}

/** Every block today's cadence produces, in daily chronological order — used by Home to decide which of today's cards to show at all. */
export function blocksForCadence(cadence: Cadence): [BlockId, string][] {
  if (cadence.frequency === "once") return [["combined", cadence.block1]];
  if (cadence.frequency === "four") {
    return [
      ["q1", cadence.block1],
      ["q2", cadence.block2],
      ["q3", cadence.block3 ?? cadence.block1],
      ["q4", cadence.block4 ?? cadence.block2],
    ];
  }
  return [
    ["1", cadence.block1],
    ["2", cadence.block2],
  ];
}
