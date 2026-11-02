import { urlPlaceholders, type Guide } from "./guide";
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
  urlGuessed?: true;
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

// Scopes for the test authorize URL: only tiers a developer gets without review or payment, only real scope strings
// ("openid email" holds two; prose such as "Issues: Read & write" is not one), never pseudo-scopes such as Discord's `bot`.
const PSEUDO_SCOPES = new Set(["bot"]);
const SCOPE_TOKEN = /^[\w.:/-]+$/;
export function authorizeScopes(guide: Guide): { scopes: string[]; omitted: { name: string; reason: string }[] } {
  const scopes: string[] = [];
  const omitted: { name: string; reason: string }[] = [];
  for (const sc of guide.scopes) {
    const parts = sc.name.trim().split(/\s+/);
    if (sc.tier !== "basic" && sc.tier !== "sensitive") omitted.push({ name: sc.name, reason: `${sc.tier} tier: needs review, partnership or payment` });
    else if (parts.some((p) => PSEUDO_SCOPES.has(p))) omitted.push({ name: sc.name, reason: "pseudo-scope (not a permission string for the test URL)" });
    else if (!parts.every((p) => SCOPE_TOKEN.test(p))) omitted.push({ name: sc.name, reason: "not a scope string (prose or UI label)" });
    else for (const p of parts) if (!scopes.includes(p)) scopes.push(p);
  }
  return { scopes, omitted };
}

const upperEnv = (x: string) => x.toUpperCase().replace(/[^A-Z0-9]/g, "_");
type Placeholder = { name: string; about: string; env: string };
// Declared placeholders plus any {xxx} left in the endpoint URLs of older guides (env = PROVIDER_XXX).
function placeholdersOf(guide: Guide, provider: string): Placeholder[] {
  const o = guide.oauth;
  const out: Placeholder[] = [...(o?.placeholders ?? [])];
  for (const u of [o?.authorizeUrl, o?.tokenUrl, o?.revokeUrl, o?.testApiCall?.url])
    for (const n of urlPlaceholders(u))
      if (!out.some((p) => p.name === n)) out.push({ name: n, about: `the account-specific value for {${n}} in the provider's URLs (not described in this older guide: see the steps)`, env: `${upperEnv(provider)}_${upperEnv(n)}` });
  return out;
}
const withEnvs = (url: string, ph: Placeholder[]) => ph.reduce((u, p) => u.replaceAll(`{${p.name}}`, `\${${p.env}}`), url);

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
  // developerContactEmail falls back to supportEmail when only that is given.
  const alias = (key: string) => (key === "developerContactEmail" && has(key) === false && has("supportEmail") ? "supportEmail" : key);
  const hasK = (key: string) => has(alias(key));
  const placeholders = placeholdersOf(guide, provider);
  const scopeNames = guide.scopes.map((x) => x.name);
  let lastUrl: string | undefined;
  const steps = guide.steps
    .filter((s) => phases.includes(s.phase))
    .map((s, i): PlanStep => {
      const code = s.phase === "test" && !s.fields?.length && s.who !== "you";
      // Web steps without a known page get the nearest earlier page, else the provider's home, marked as a guess.
      const url = s.url ?? (code ? undefined : lastUrl ?? guide.website);
      if (s.url) lastUrl = s.url;
      return {
      n: i + 1,
      title: s.title,
      phase: s.phase,
      who: s.who,
      action: code ? RUN : ACTION[s.who],
      url,
      ...(url && !s.url ? { urlGuessed: true as const } : {}),
      detail: s.detail,
      fields: (s.fields ?? []).map((f): PlanField => {
        if (!f.profileKey && /scope|permission/i.test(f.label)) return { label: f.label, value: scopeNames, status: "filled", note: "from the guide" };
        if (!f.profileKey) return { label: f.label, value: null, status: "not-in-profile", note: f.note };
        const h = hasK(f.profileKey);
        const key = alias(f.profileKey);
        // A note telling the agent to substitute {provider} is stale once we have substituted it.
        const note = key !== f.profileKey && h ? "using supportEmail (no developerContactEmail given)" : h && f.note?.includes("{provider}") ? undefined : f.note;
        return {
          label: f.label,
          value: h ? fill(key) : null,
          status: h ? "filled" : h === false ? "missing" : "not-in-profile",
          profileKey: f.profileKey,
          note,
        };
      }),
      evidence: s.evidence.status,
      };
    });
  const missing = [
    ...guide.prerequisites
      .filter((p) => p.profileKey && hasK(p.profileKey) === false)
      .map((p) => `${p.item} (needed for ${p.requiredFor})`),
    ...steps.flatMap((s) => s.fields.filter((f) => f.status === "missing").map((f) => `${f.label} (step ${s.n}, profile key ${f.profileKey})`)),
  ];
  const env = upperEnv(provider);
  const redirectUris = profileList("redirectUris", profile)?.map((v) => v.replaceAll("{provider}", provider)) ?? [];
  const oauth = guide.oauth;
  const missingList = [...new Set([...missing, ...placeholders.map((p) => `${p.about} (placeholder {${p.name}} in the provider URLs; set ${p.env})`)])];
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
    ...(oauth ? { oauth: { ...oauth, ...(placeholders.length ? { placeholders } : {}), evidence: oauth.evidence.status } } : {}),
    ...(placeholders.length ? { inputs: placeholders.map((p) => ({ ...p, note: `Appears as {${p.name}} in the provider URLs; the verification script reads it from ${p.env}.` })) } : {}),
    scopes: guide.scopes.map((s) => ({ name: s.name, tier: s.tier, purpose: s.purpose })),
    blockers: guide.blockers.filter((b) => b.severity !== "info").map((b) => ({ title: b.title, severity: b.severity, workaround: b.workaround })),
    credentials: { env: credentialEnv(guide, env), redirectUris },
    verify: buildVerify(guide, env, redirectUris, opts.verifyScript !== false, placeholders),
    ...(phases.includes("launch")
      ? {}
      : { launch: { required: guide.verdict.reviewRequired, timeToLaunch: guide.verdict.timeToLaunch, steps: guide.steps.filter((x) => x.phase === "launch").map((x) => x.title) } }),
    guideUrl: `https://oauth-readiness-five.vercel.app/guides/${guide.slug}`,
  };
}

const SECRET_NOTE = "the human copies it from the console into .env.local / the host's secret store; never into chat";
const isStandard = (t?: string) => t === "oauth2" || t === "oauth2-pkce-only";

// Env vars the developer stores. Declared credentials win; otherwise a client id + secret pair for OAuth2 only.
function credentialEnv(guide: Guide, env: string): Record<string, string> {
  const o = guide.oauth;
  if (o?.credentials?.length) return Object.fromEntries(o.credentials.map((c) => [c.env, `${c.what} (secrets: ${SECRET_NOTE})`]));
  if (o?.authType === "api-key") return { [`${env}_API_KEY`]: `API key: ${SECRET_NOTE}` };
  if (o?.authType === "oauth1") return { [`${env}_CONSUMER_KEY`]: "OAuth 1.0a consumer key (app key)", [`${env}_CONSUMER_SECRET`]: `OAuth 1.0a consumer secret: ${SECRET_NOTE}` };
  if (o && !isStandard(o.authType)) return { [`${env}_CREDENTIALS`]: `whatever the steps say you receive (key, token, secret): ${SECRET_NOTE}` };
  return { [`${env}_CLIENT_ID`]: "client id (safe to show)", [`${env}_CLIENT_SECRET`]: `client secret: ${SECRET_NOTE}` };
}

const FALLBACK_VERIFY =
  "Done when the developer's own account completes the OAuth flow at one of the redirect URIs above with the scopes listed, and one API call with the token succeeds. Request only those scopes in the authorize URL.";

// The sentence, a ready authorize URL, and a script the developer's agent can run to prove the app works end to end.
function buildVerify(guide: Guide, env: string, redirectUris: string[], withScript: boolean, placeholders: Placeholder[]) {
  const o = guide.oauth;
  if (!o) return { summary: FALLBACK_VERIFY, note: "This guide has no OAuth endpoint data yet (older guide): take the authorize/token URLs from the steps and get_guide." };
  if (!isStandard(o.authType)) {
    const creds = Object.keys(credentialEnv(guide, env));
    const t = o.testApiCall;
    const call = t ? `${t.method} ${withEnvs(t.url, placeholders)}${t.note ? ` (${t.note})` : ""}` : "one cheap read-only API call";
    const how: Record<string, string> = {
      "api-key": `Read the credentials from ${creds.join(", ")}; never print them.`,
      oauth1: `This provider uses OAuth 1.0a: every request must be signed (HMAC-SHA1 per RFC 5849) with the consumer key/secret and the user's token/secret, so use an OAuth 1.0a library (no generic script is provided). Credentials: ${creds.join(", ")}.`,
      custom: `This provider's flow is not standard OAuth2 (see the steps and oauth.credentials): no generic OAuth2 script applies. Credentials: ${creds.join(", ")}.`,
      other: `No standard OAuth2 flow applies (see the steps). Credentials: ${creds.join(", ")}.`,
    };
    return {
      summary: `Done when ${call} succeeds (2xx) with the developer's credentials. ${how[o.authType] ?? how.other}`,
      ...(t ? { testApiCall: { ...t, url: withEnvs(t.url, placeholders) } } : {}),
      note: "No OAuth2 authorize URL or verifyScript for this auth type.",
    };
  }
  if (!o.authorizeUrl || !o.tokenUrl) return { summary: FALLBACK_VERIFY, note: "This guide's endpoints are incomplete: use the steps and get_guide." };
  const local = redirectUris.find((u) => /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(u));
  const redirect = local ?? "http://localhost:8976/callback";
  const pkce = o.pkce === "required" || o.pkce === "supported" || o.authType === "oauth2-pkce-only";
  const q: Record<string, string> = { redirect_uri: redirect, response_type: "code" };
  const { scopes, omitted } = authorizeScopes(guide);
  if (scopes.length && !o.noScopeParam) q.scope = scopes.join(o.scopeSeparator ?? " ");
  q.state = "<random>";
  if (pkce) Object.assign(q, { code_challenge: "<S256 of verifier>", code_challenge_method: "S256" });
  Object.assign(q, o.extraAuthorizeParams);
  const base = withEnvs(o.authorizeUrl, placeholders);
  // Declared credentials name the vars: the id is ..._CLIENT_ID / _APP_ID / _API_KEY (Shopify), the secret the one with SECRET.
  const creds = o.credentials ?? [];
  const idEnv = creds.find((c) => /(CLIENT_?ID|APP_?ID|API_?KEY|_ID)$/.test(c.env) && !/SECRET/.test(c.env))?.env ?? `${env}_CLIENT_ID`;
  const secretEnv = creds.find((c) => /SECRET/.test(c.env))?.env ?? creds.find((c) => c.env !== idEnv && /KEY|TOKEN/.test(c.env))?.env ?? `${env}_CLIENT_SECRET`;
  const authorizeUrl = `${base}${base.includes("?") ? "&" : "?"}client_id=\${${idEnv}}&${Object.entries(q).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&")}`;
  const scopeNote = o.noScopeParam
    ? "No scope parameter: this provider takes permissions from the app's own settings/manifest."
    : omitted.length
      ? `Scopes left out of the test URL: ${omitted.map((x) => `${x.name} (${x.reason})`).join("; ")}.`
      : undefined;
  return {
    summary: `Done when the developer's own account completes the flow and the test call succeeds. Run verifyScript in the developer's repo (Node 20+, scratch file, delete after); it prints no tokens or secrets.${placeholders.length ? ` First set ${placeholders.map((p) => p.env).join(", ")}.` : ""}`,
    authorizeUrl,
    ...(scopeNote ? { scopeNote } : {}),
    ...(o.clientAuth === "secret_key" ? { clientAuthNote: `No client secret: the code is exchanged with the platform's secret key (${secretEnv}) as a Bearer token.` } : {}),
    ...(local ? {} : { redirectNote: `No localhost redirect URI in the profile: add ${redirect} as a redirect URI in the provider console before running the script.` }),
    ...(withScript ? { verifyScript: buildVerifyScript({ idEnv, secretEnv, authorizeUrl: o.authorizeUrl, tokenUrl: o.tokenUrl, redirect, scopes, sep: o.scopeSeparator ?? " ", pkce, clientAuth: o.clientAuth === "none" || o.authType === "oauth2-pkce-only" ? "none" : o.clientAuth, noScopeParam: o.noScopeParam, placeholders: placeholders.map((p) => ({ name: p.name, env: p.env })), extra: o.extraAuthorizeParams ?? {}, test: o.testApiCall ?? null }) } : {}),
  };
}
