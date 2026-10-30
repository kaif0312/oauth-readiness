import type { Guide } from "./guide";
import { profileDisplay, profileHas, type Json } from "./profile";

// A guide turned into instructions for an agent driving a browser: steps in order, every form field
// resolved against the developer profile, and explicit STOP points where a human takes over.

export type PlanField = { label: string; value: string | null; status: "filled" | "missing" | "not-in-profile"; note?: string };
export type PlanStep = {
  n: number;
  title: string;
  phase: "build" | "test" | "launch";
  who: "agent" | "you" | "agent-then-you";
  action: string;
  url?: string;
  detail: string;
  fields: PlanField[];
  evidence: string;
};

const ACTION: Record<PlanStep["who"], string> = {
  agent: "DO: the agent can complete this step.",
  "agent-then-you": "FILL, THEN STOP: fill the fields, do not submit; hand over to the human to review and submit.",
  you: "STOP: a human must do this step (sign-in, legal, payment or judgement). Notify them and wait.",
};

export const BROWSER_RULES = [
  "Work in the developer's own signed-in browser; never type passwords, 2FA codes or payment details.",
  "Stop at every STOP step, notify the human, and wait for them to say they are done.",
  "Never click a final Submit / Publish / Create for production, accept terms, or pay; the human does that.",
  "Fill only values from the plan. If a field is 'missing', leave it empty and list it for the human.",
  "Consoles change: if the page does not match the step, describe what you see and ask; do not guess.",
  "Never navigate away from a filled form before it is saved: consoles drop unsaved input. After every save, reload the page and read the values back; a save can silently keep only some fields.",
  "Record client ids you see; never copy client secrets into chat. Ask the human to store them.",
];

export function buildPlan(guide: Guide, phases: PlanStep["phase"][], profile?: Json) {
  // Profile values are templates for every provider (".../api/oauth/{provider}/callback"); fill in this one.
  const provider = guide.slug.split("-")[0];
  const fill = (key: string) => profileDisplay(key, profile).replaceAll("{provider}", provider);
  const steps = guide.steps
    .filter((s) => phases.includes(s.phase))
    .map((s, i): PlanStep => ({
      n: i + 1,
      title: s.title,
      phase: s.phase,
      who: s.who,
      action: ACTION[s.who],
      url: s.url,
      detail: s.detail,
      fields: (s.fields ?? []).map((f) => {
        if (!f.profileKey) return { label: f.label, value: null, status: "not-in-profile", note: f.note };
        const has = profileHas(f.profileKey, profile);
        return {
          label: f.label,
          value: has ? fill(f.profileKey) : null,
          status: has ? "filled" : has === false ? "missing" : "not-in-profile",
          note: f.note,
        };
      }),
      evidence: s.evidence.status,
    }));
  const missing = [
    ...guide.prerequisites
      .filter((p) => p.profileKey && profileHas(p.profileKey, profile) === false)
      .map((p) => `${p.item} (needed for ${p.requiredFor})`),
    ...steps.flatMap((s) => s.fields.filter((f) => f.status === "missing").map((f) => `${f.label} (step ${s.n})`)),
  ];
  return {
    app: guide.app,
    verdict: guide.verdict,
    rules: BROWSER_RULES,
    steps,
    missing: [...new Set(missing)],
    blockers: guide.blockers.filter((b) => b.severity !== "info").map((b) => ({ title: b.title, severity: b.severity, workaround: b.workaround })),
  };
}
