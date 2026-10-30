import type { Guide } from "./guide";
import { PROFILE_FIELDS, profileDisplay, profileHas, profileList, type Json } from "./profile";

// A guide turned into instructions for an agent driving a browser: steps in order, every form field
// resolved against the developer profile, and explicit STOP points where a human takes over.

export type PlanField = { label: string; value: string | string[] | null; status: "filled" | "missing" | "not-in-profile"; profileKey?: string; note?: string };
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
const RUN = "RUN: a code or test step (no console form). Run it, show the human the result, and stop if it fails.";

export const BROWSER_RULES = [
  "Work in the developer's own signed-in browser; never type passwords, 2FA codes or payment details.",
  "Stop at every STOP step, notify the human, and wait for them to say they are done.",
  "Never click a final Submit / Publish / Create for production, accept terms, or pay; the human does that.",
  "Fill only values from the plan. If a field is 'missing', leave it empty and list it for the human.",
  "Consoles change: if the page does not match the step, describe what you see and ask; do not guess.",
  "Never navigate away from a filled form before it is saved: consoles drop unsaved input. After every save, reload the page and read the values back; a save can silently keep only some fields.",
  "Record client ids you see; never copy client secrets into chat. Ask the human to store them.",
];

export function buildPlan(guide: Guide, phases: PlanStep["phase"][], profile?: Json, opts: { compact?: boolean } = {}) {
  // Profile values are templates for every provider (".../api/oauth/{provider}/callback"); fill in this one.
  const provider = guide.slug.split("-")[0];
  // With the default (Iskaria) profile an absent key means "this guide's field has no profile answer"; with a developer's
  // own profile, an absent key is simply something they have not told us yet, so it is missing.
  const custom = profile !== undefined;
  const has = (key: string) => {
    const h = profileHas(key, profile);
    return h === undefined && custom && key in PROFILE_FIELDS ? false : h;
  };
  const fill = (key: string): string | string[] => {
    const list = profileList(key, profile);
    if (list) return list.map((v) => v.replaceAll("{provider}", provider));
    return profileDisplay(key, profile).replaceAll("{provider}", provider);
  };
  const steps = guide.steps
    .filter((s) => phases.includes(s.phase))
    .map((s, i): PlanStep => ({
      n: i + 1,
      title: s.title,
      phase: s.phase,
      who: s.who,
      action: s.phase === "test" && !s.fields?.length && s.who !== "you" ? RUN : ACTION[s.who],
      url: s.url,
      detail: s.detail,
      fields: (s.fields ?? []).map((f) => {
        if (!f.profileKey) return { label: f.label, value: null, status: "not-in-profile", note: f.note };
        const h = has(f.profileKey);
        // A note telling the agent to substitute {provider} is stale once we have substituted it.
        const note = h && f.note?.includes("{provider}") ? undefined : f.note;
        return {
          label: f.label,
          value: h ? fill(f.profileKey) : null,
          status: h ? "filled" : h === false ? "missing" : "not-in-profile",
          profileKey: f.profileKey,
          note,
        };
      }),
      evidence: s.evidence.status,
    }));
  const missing = [
    ...guide.prerequisites
      .filter((p) => p.profileKey && has(p.profileKey) === false)
      .map((p) => `${p.item} (needed for ${p.requiredFor})`),
    ...steps.flatMap((s) => s.fields.filter((f) => f.status === "missing").map((f) => `${f.label} (step ${s.n}, profile key ${f.profileKey})`)),
  ];
  const env = provider.toUpperCase().replace(/[^A-Z0-9]/g, "_");
  return {
    app: guide.app,
    verdict: opts.compact ? { ...guide.verdict, evidence: undefined } : guide.verdict,
    profile: custom ? "yours" : "Iskaria example (pass your own `profile`; get_profile with template: true lists the keys)",
    rules: BROWSER_RULES,
    steps,
    missing: [...new Set(missing)],
    scopes: guide.scopes.map((s) => ({ name: s.name, tier: s.tier, purpose: s.purpose })),
    blockers: guide.blockers.filter((b) => b.severity !== "info").map((b) => ({ title: b.title, severity: b.severity, workaround: b.workaround })),
    credentials: {
      env: { [`${env}_CLIENT_ID`]: "client id (safe to show)", [`${env}_CLIENT_SECRET`]: "client secret: the human copies it from the console into .env.local / the host's secret store; never into chat" },
      redirectUris: profileList("redirectUris", profile)?.map((v) => v.replaceAll("{provider}", provider)) ?? [],
    },
    verify: `Done when the developer's own account completes the OAuth flow at one of the redirect URIs above with the scopes listed, and one API call with the token succeeds. Request only those scopes in the authorize URL.`,
    guideUrl: `https://oauth-readiness-five.vercel.app/guides/${guide.slug}`,
  };
}
