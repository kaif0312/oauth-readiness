import profile from "@/data/profile/iskaria.json";

export { profile };

export type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

// Resolve "a.b" style keys against the developer profile (or another profile object, e.g. one an MCP client sends).
export function profileValue(key: string, root: Json = profile as unknown as Json): Json | undefined {
  let cur: Json | undefined = root;
  for (const part of key.split(".")) {
    if (cur && typeof cur === "object" && !Array.isArray(cur) && part in cur) cur = (cur as Record<string, Json>)[part];
    else return undefined;
  }
  return cur;
}

// true = profile has it, false = profile knows it's missing (null), undefined = key not in profile
export function profileHas(key: string, root?: Json): boolean | undefined {
  const v = profileValue(key, root);
  if (v === undefined) return undefined;
  if (v === null) return false;
  if (typeof v === "object" && !Array.isArray(v)) return Object.values(v).some((x) => x !== null && x !== "unknown");
  return true;
}

export function profileDisplay(key: string, root?: Json): string {
  const v = profileValue(key, root);
  if (v === undefined || v === null) return "";
  if (typeof v === "string") return v;
  return JSON.stringify(v);
}

// What a developer who is not Iskaria sends as `profile` to get_setup_plan. Keys are the ones the guides' form fields and
// prerequisites point at (`profileKey`); a key that is absent or null in a custom profile is reported as missing.
export const PROFILE_FIELDS: Record<string, { about: string; required?: boolean; list?: boolean }> = {
  appName: { about: "app name users see on the consent screen", required: true },
  companyName: { about: "company or developer name" },
  legalEntity: { about: "registered legal entity name (some reviews check it)" },
  appDescription: { about: "2-3 sentences: what the app does with the user's data" },
  homepageUrl: { about: "public homepage, https", required: true },
  privacyPolicyUrl: { about: "public privacy policy URL on your domain", required: true },
  termsUrl: { about: "terms of service URL" },
  dataDeletionUrl: { about: "data deletion instructions URL (Meta asks for it)" },
  supportUrl: { about: "support page URL" },
  supportEmail: { about: "user-facing support email (Google: the signed-in account or a group it manages)", required: true },
  developerContactEmail: { about: "email the provider uses to reach the developer" },
  appDomain: { about: "domain the app runs on, e.g. app.example.com" },
  authorizedDomains: { about: "top-level domains you own, e.g. [\"example.com\"]", required: true, list: true },
  redirectUris: { about: "OAuth callback URLs; {provider} is replaced per guide, e.g. https://app.example.com/api/oauth/{provider}/callback", required: true, list: true },
  "logo.square512Png": { about: "URL or path of a square 512x512 PNG logo" },
  demoVideoUrl: { about: "unlisted video showing the OAuth flow and each scope in use (Google and Meta reviews ask for it)" },
  "domainVerified.googleSearchConsole": { about: "true if the domain is verified in Google Search Console" },
  "businessVerification.meta": { about: "Meta business verification: verified / pending / unknown" },
  "businessVerification.microsoftPartnerId": { about: "Microsoft Partner One ID, if any" },
  country: { about: "where the business is registered" },
  "useCases.default": { about: "one sentence: what your agent does with the provider's data (also useCases.<provider>, e.g. useCases.slack)" },
};

export function profileTemplate() {
  return {
    howToUse: "Fill what you have, leave the rest out, and pass it as `profile` to get_setup_plan. Required keys come first. Nested keys like logo.square512Png are objects: {\"logo\": {\"square512Png\": \"...\"}}. Public facts only: never put secrets here.",
    fields: Object.entries(PROFILE_FIELDS)
      .sort(([, a], [, b]) => Number(!!b.required) - Number(!!a.required))
      .map(([key, f]) => ({ key, required: !!f.required, type: f.list ? "string[]" : "string", about: f.about })),
    example: {
      appName: "Acme Assistant",
      homepageUrl: "https://acme.example/",
      privacyPolicyUrl: "https://acme.example/privacy",
      supportEmail: "support@acme.example",
      authorizedDomains: ["acme.example"],
      redirectUris: ["https://app.acme.example/api/oauth/{provider}/callback", "http://localhost:3000/api/oauth/{provider}/callback"],
      useCases: { default: "Let Acme's assistant read the user's own data to answer questions" },
    },
  };
}

// MCP clients sometimes send an object argument as a JSON string; accept both.
export function parseProfile(input: unknown): Json | undefined {
  if (input == null) return undefined;
  if (typeof input === "string") {
    const parsed: unknown = JSON.parse(input);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("profile must be a JSON object");
    return parsed as Json;
  }
  return input as Json;
}

export function profileList(key: string, root?: Json): string[] | null {
  const v = profileValue(key, root);
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : null;
}
