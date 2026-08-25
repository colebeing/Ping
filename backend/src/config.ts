import type { AppConfig, Env, FollowupPrompt } from "./types";

// Placeholder copy — real wording lives in a separate content doc (not yet
// available). Structure/keys are what matters here; swap text freely, this
// is just KV-stored JSON, not code.
function what(prompt: string, options: Record<string, string>): FollowupPrompt {
  return { prompt, options: options as FollowupPrompt["options"] };
}

export const DEFAULT_CONFIG: AppConfig = {
  blocks: {
    "1": {
      question: { when: "today start", how: "how you wanted" },
      yes: {
        what: what("What made it go well?", {
          friends: "Time with friends",
          work: "A good start on work",
          home: "Home felt settled",
          capacity: "I had the energy for it",
        }),
        why: what("What set that up?", {
          friends: "Connected with someone first",
          work: "Walked in with a clear plan",
          home: "Home routine went smoothly",
          capacity: "I was rested / had margin",
        }),
      },
      no: {
        what: what("What got in the way?", {
          friends: "Felt disconnected from friends",
          work: "Work started rough",
          home: "Home stuff derailed things",
          capacity: "I was already running low",
        }),
        why: what("What drove that?", {
          friends: "No time carved out for friends",
          work: "Unclear priorities this morning",
          home: "Home responsibilities piled up",
          capacity: "Didn't sleep / recover enough",
        }),
      },
    },
    "2": {
      question: { when: "today end", how: "how you wanted" },
      yes: {
        what: what("What made it land well?", {
          friends: "Good time with friends",
          work: "Closed work out cleanly",
          home: "Home felt good tonight",
          capacity: "Still had energy left",
        }),
        why: what("What set that up?", {
          friends: "Made space for people today",
          work: "Stayed on top of things",
          home: "Home stayed manageable",
          capacity: "Paced myself well today",
        }),
      },
      no: {
        what: what("What threw it off?", {
          friends: "Missed out on friend time",
          work: "Work bled into the evening",
          home: "Home stuff piled up",
          capacity: "Ran out of gas",
        }),
        why: what("What drove that?", {
          friends: "Didn't prioritize friends today",
          work: "Overcommitted today",
          home: "Home got neglected today",
          capacity: "Overextended today",
        }),
      },
    },
  },
};

export async function getConfig(env: Env): Promise<AppConfig> {
  const stored = await env.CONFIG_KV.get("config", "json");
  return (stored as AppConfig | null) ?? DEFAULT_CONFIG;
}
