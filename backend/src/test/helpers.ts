import { CATEGORIES, type Category, type EscalationNode, type FollowupPrompt, type LiveBlockId } from "../types";

/** Minimal in-memory stand-in for Cloudflare's KVNamespace — just enough of `get`/`put` for the routes
 * and config/state readers under test (both only ever call `.get(key, "json")` / `.put(key, jsonString)`).
 * Not a full KVNamespace implementation (no list/metadata/expiration) — nothing under test uses those. */
export class FakeKV {
  private store = new Map<string, string>();

  async get<T>(key: string, _type?: string): Promise<T | null> {
    const raw = this.store.get(key);
    return raw === undefined ? null : (JSON.parse(raw) as T);
  }

  async put(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }

  /** Test setup shortcut — equivalent to a prior `put` with the value already serialized. */
  seed(key: string, value: unknown): void {
    this.store.set(key, JSON.stringify(value));
  }
}

function samePrompt(text: string): FollowupPrompt {
  const options = {} as Record<Category, string>;
  for (const cat of CATEGORIES) options[cat] = `${text} (${cat})`;
  return { prompt: text, options };
}

/** A minimally valid, "finished" (see isUnfinishedNode) escalation-tree leaf for tests — every field
 * required by EscalationNode is present with distinguishable placeholder text, overridable per test. */
export function makeNode(overrides: Partial<EscalationNode> = {}): EscalationNode {
  const question = overrides.label ?? "node question";
  const blockQuestions = { q1: question, q2: question, q3: question, q4: question } as Record<LiveBlockId, string>;
  return {
    inviteQuestion: `Switch to: ${question}?`,
    blockQuestions,
    yes: samePrompt(`${question} yes`),
    no: samePrompt(`${question} no`),
    children: { yes: {}, no: {} },
    ...overrides,
  };
}
