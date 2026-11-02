import type { Guide } from "./guide";
import { verifyScript as buildVerifyScript } from "./verify-script";
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

// Which profile filled the plan: the developer's own, Iskaria's worked example (opt-in), or nothing (every field missing).
export type ProfileMode = "yours" | "example" | "none";

// Scope names that are real authorize-URL strings ("openid email" holds two). Labels such as GitHub App permissions
// ("Issues: Read & write") are not, and are left out of the test authorize URL.
const authorizeScopes = (guide: Guide) =>
  guide.scopes.map((s) => s.name).filter((n) => !n.includes(": ") && /^[\w.:/-]+( [\w.:/-]+)*$/.test(n)).flatMap((n) => n.split(" "));

export function buildPlan(
  guide: Guide,
  phases: PlanStep["phase"][],
  profile?: Json,
  opts: { compact?: boolean; example?: boolean; verifyScript?: boolean } = {},
) {
  const mode: ProfileMode = profile !== undefined ? "yours" : opts.example ? "example" : "none";
  // No profile and no opt-in: an empty custom profile, so every profile-backed field reports as missing.
  if (mode === "none") profile = {};
  // Profile values are templates for every provider (".../api/oauth/{provider}/callback"); fill in this one.
  const provider = guide.slug.split("-")[0];
  // With the default (Iskaria) profile an absent key means "this guide's field has no profile answer"; with a developer's
  // own profile, an absent key is simply something they have not told us yet, so it is missing.
  const custom = mode !== "example";
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
  const redirectUris = profileList("redirectUris", profile)?.map((v) => v.replaceAll("{provider}", provider)) ?? [];
  const oauth = guide.oauth;
  const apiKey = oauth?.authType === "api-key";
  const missingList = [...new Set(missing)];
  const next =
    mode === "none"
      ? "No profile was given, so every profile-backed field is `missing` (Iskaria's example data is NOT used). Call get_profile {template: true}, fill the profile from the developer's project (package.json, site, README, existing OAuth code), ask the developer for what you cannot find, then call get_setup_plan again with `profile`. Pass example: true only to see a worked example (never type its values into a real console)."
      : mode === "yours" && missingList.length
        ? "Some fields are `missing`: ask the developer for them (do not invent values) and call get_setup_plan again with the completed `profile`, or leave those fields empty and list them for the human."
        : undefined;
  return {
    app: guide.app,
    verdict: opts.compact ? { ...guide.verdict, evidence: undefined } : guide.verdict,
    profile: mode === "example" ? "Iskaria example (not yours: never type these values into someone else's console)" : mode,
    ...(next ? { next } : {}),
    rules: BROWSER_RULES,
    steps,
    missing: missingList,
    ...(oauth ? { oauth: { ...oauth, evidence: oauth.evidence.status } } : {}),
    scopes: guide.scopes.map((s) => ({ name: s.name, tier: s.tier, purpose: s.purpose })),
    blockers: guide.blockers.filter((b) => b.severity !== "info").map((b) => ({ title: b.title, severity: b.severity, workaround: b.workaround })),
    credentials: {
      env: apiKey
        ? { [`${env}_API_KEY`]: "API key: the human copies it from the console into .env.local / the host's secret store; never into chat" }
        : { [`${env}_CLIENT_ID`]: "client id (safe to show)", [`${env}_CLIENT_SECRET`]: "client secret: the human copies it from the console into .env.local / the host's secret store; never into chat" },
      redirectUris,
    },
    verify: buildVerify(guide, env, redirectUris, opts.verifyScript !== false),
    guideUrl: `https://oauth-readiness-five.vercel.app/guides/${guide.slug}`,
  };
}

const FALLBACK_VERIFY =
  "Done when the developer's own account completes the OAuth flow at one of the redirect URIs above with the scopes listed, and one API call with the token succeeds. Request only those scopes in the authorize URL.";

// The sentence, a ready authorize URL, and a script the developer's agent can run to prove the app works end to end.
function buildVerify(guide: Guide, env: string, redirectUris: string[], withScript: boolean) {
  const o = guide.oauth;
  if (!o) return { summary: FALLBACK_VERIFY, note: "This guide has no OAuth endpoint data yet (older guide): take the authorize/token URLs from the steps and get_guide." };
  if (o.authType === "api-key")
    return {
      summary: `Done when the key works: ${o.testApiCall ? `${o.testApiCall.method} ${o.testApiCall.url} with the key returns 2xx` : "one read-only API call with the key returns 2xx"}. Read the key from ${env}_API_KEY; never print it.`,
      ...(o.testApiCall ? { testApiCall: o.testApiCall } : {}),
    };
  if (o.authType === "other" || !o.authorizeUrl || !o.tokenUrl) return { summary: FALLBACK_VERIFY, note: "This guide's endpoints are incomplete: use the steps and get_guide." };
  const local = redirectUris.find((u) => /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(u));
  const redirect = local ?? "http://localhost:8976/callback";
  const pkce = o.pkce === "required" || o.pkce === "supported" || o.authType === "oauth2-pkce-only";
  const q: Record<string, string> = { redirect_uri: redirect, response_type: "code" };
  const scopes = authorizeScopes(guide);
  if (scopes.length) q.scope = scopes.join(o.scopeSeparator ?? " ");
  q.state = "<random>";
  if (pkce) Object.assign(q, { code_challenge: "<S256 of verifier>", code_challenge_method: "S256" });
  Object.assign(q, o.extraAuthorizeParams);
  const authorizeUrl = `${o.authorizeUrl}${o.authorizeUrl.includes("?") ? "&" : "?"}client_id=\${${env}_CLIENT_ID}&${Object.entries(q).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&")}`;
  return {
    summary: `Done when the developer's own account completes the flow and the test call succeeds. Run verifyScript in the developer's repo (Node 20+, scratch file, delete after); it prints no tokens or secrets.`,
    authorizeUrl,
    ...(local ? {} : { redirectNote: `No localhost redirect URI in the profile: add ${redirect} as a redirect URI in the provider console before running the script.` }),
    ...(withScript ? { verifyScript: buildVerifyScript({ idEnv: `${env}_CLIENT_ID`, secretEnv: `${env}_CLIENT_SECRET`, authorizeUrl: o.authorizeUrl, tokenUrl: o.tokenUrl, redirect, scopes, sep: o.scopeSeparator ?? " ", pkce, clientAuth: o.clientAuth === "none" || o.authType === "oauth2-pkce-only" ? "none" : o.clientAuth, extra: o.extraAuthorizeParams ?? {}, test: o.testApiCall ?? null }) } : {}),
  };
}
