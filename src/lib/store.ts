import { readFileSync, readdirSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { r2Configured, r2Get, r2List, r2Put, safeKey } from "./r2";
import { Guide } from "./guide";

// Seeded guides ship in the repo (src/data/guides). Live-generated guides go to Cloudflare R2 (one JSON file per guide
// in a private bucket, see ./r2.ts) when the R2_* env is set, else to .data/guides (local dev).

const SEED_DIR = join(process.cwd(), "src/data/guides");
const LOCAL_DIR = join(process.cwd(), ".data/guides");
const useR2 = r2Configured();
const objectKey = (slug: string) => `guides/${slug}.json`;

function readDir(dir: string): Guide[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .flatMap((f) => {
      const parsed = Guide.safeParse(JSON.parse(readFileSync(join(dir, f), "utf8")));
      return parsed.success ? [parsed.data] : [];
    });
}

async function fetchGuide(key: string): Promise<Guide | null> {
  const body = await r2Get(key);
  if (!body) return null;
  const parsed = Guide.safeParse(JSON.parse(body));
  return parsed.success ? parsed.data : null;
}

export function seedGuides(): Guide[] {
  return readDir(SEED_DIR).sort((a, b) => a.app.localeCompare(b.app));
}

export async function liveGuides(): Promise<Guide[]> {
  if (!useR2) return readDir(LOCAL_DIR);
  const objects = await r2List("guides/");
  const newest = objects.sort((a, b) => +b.lastModified - +a.lastModified).slice(0, 30);
  const guides = await Promise.all(newest.map((o) => fetchGuide(o.key)));
  return guides.filter((g): g is Guide => !!g);
}

// Agents guess slugs ("Slack", "gmail", "outlook"); map what they send to a real slug before touching storage.
const ALIASES: Record<string, string> = {
  gmail: "google-gmail",
  google: "google-search-analytics",
  "search-console": "google-search-analytics",
  ga4: "google-search-analytics",
  "google-business-profile": "google-search-analytics",
  "google-mail": "google-gmail",
  "google-search-console": "google-search-analytics",
  "google-analytics": "google-search-analytics",
  "microsoft-outlook": "microsoft-graph",
  "office-365": "microsoft-graph",
  outlook: "microsoft-graph",
  microsoft: "microsoft-graph",
  "microsoft-365": "microsoft-graph",
  facebook: "meta",
  instagram: "meta",
  whatsapp: "meta",
};

export function normalizeSlug(input: string): string {
  const s = slugify(input);
  return ALIASES[s] ?? s;
}

// ---- Fuzzy slug resolution -------------------------------------------------------------------------------------
// "HubSpot CRM", "hubspot.com", "Microsoft Outlook" -> an existing guide; "google-drive" must NOT land on a Google
// guide it is not (Google has several), so a first-word match only counts when exactly one guide shares that word.

const NOISE = new Set(["crm", "api", "apis", "oauth", "oauth2", "app", "apps", "the", "for", "integration", "platform", "sdk", "developer", "developers"]);

export type Resolution = {
  slug: string | null; // the guide to use, when sure
  kind: "exact" | "close" | "ambiguous" | "none";
  candidates: string[]; // for close / ambiguous
};

export async function knownSlugs(): Promise<{ slug: string; app?: string }[]> {
  const seeds = seedGuides().map((g) => ({ slug: g.slug, app: g.app }));
  let live: string[] = [];
  if (useR2) live = (await r2List("guides/")).map((o) => o.key.replace(/^guides\//, "").replace(/\.json$/, ""));
  else if (existsSync(LOCAL_DIR)) live = readdirSync(LOCAL_DIR).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, ""));
  const have = new Set(seeds.map((s) => s.slug));
  return [...seeds, ...live.filter((s) => !have.has(s)).map((slug) => ({ slug }))];
}

export function resolveAmong(input: string, known: { slug: string; app?: string }[]): Resolution {
  const slugs = new Set(known.map((k) => k.slug));
  const s = normalizeSlug(input);
  if (!s) return { slug: null, kind: "none", candidates: [] };
  if (slugs.has(s)) return { slug: s, kind: "exact", candidates: [] };
  const tokens = s.split("-").filter(Boolean);
  const core = tokens.filter((t) => !NOISE.has(t));
  if (core.length === 0) return { slug: null, kind: "none", candidates: [] };
  const coreSlug = ALIASES[core.join("-")] ?? core.join("-");
  if (slugs.has(coreSlug)) return { slug: coreSlug, kind: "exact", candidates: [] };
  // an app name equal to the query ("Microsoft Graph" -> microsoft-graph is covered above; this catches odd slugs)
  const byApp = known.filter((k) => k.app && slugify(k.app) === coreSlug);
  if (byApp.length === 1) return { slug: byApp[0].slug, kind: "exact", candidates: [] };
  const first = core[0];
  const sharing = known.filter((k) => k.slug.split("-")[0] === first || (k.app ? slugify(k.app).split("-")[0] === first : false));
  if (sharing.length === 1) return { slug: sharing[0].slug, kind: "close", candidates: [sharing[0].slug] };
  if (sharing.length > 1) return { slug: null, kind: "ambiguous", candidates: sharing.map((k) => k.slug) };
  return { slug: null, kind: "none", candidates: [] };
}

export async function resolveSlug(input: string): Promise<Resolution> {
  return resolveAmong(input, await knownSlugs());
}

export async function getGuide(input: string): Promise<Guide | null> {
  const r = await resolveSlug(input);
  if (!r.slug) return null;
  const slug = r.slug;
  const seed = seedGuides().find((g) => g.slug === slug);
  if (seed) return seed;
  if (useR2) return fetchGuide(objectKey(slug));
  const file = join(LOCAL_DIR, `${slug}.json`);
  return existsSync(file) ? Guide.parse(JSON.parse(readFileSync(file, "utf8"))) : null;
}

// ---- Small key/value layer (jobs, feedback, counters): R2 when configured, else .data/<key> --------------------------

const DATA_DIR = join(process.cwd(), ".data");

export async function kvGet(key: string): Promise<string | null> {
  if (useR2) return r2Get(key);
  const file = join(DATA_DIR, safeKey(key));
  return existsSync(file) ? readFileSync(file, "utf8") : null;
}

export async function kvPut(key: string, body: string): Promise<void> {
  if (useR2) return r2Put(key, body);
  const file = join(DATA_DIR, safeKey(key));
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, body, "utf8");
}

/** Keys under a prefix (ending in "/"), sorted ascending by key. */
export async function kvList(prefix: string): Promise<string[]> {
  safeKey(prefix);
  if (useR2) return (await r2List(prefix)).map((o) => o.key).sort();
  const dir = join(DATA_DIR, prefix);
  return existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".json")).sort().map((f) => prefix + f) : [];
}

export async function saveGuide(guide: Guide): Promise<void> {
  const body = JSON.stringify(guide, null, 2);
  if (useR2) return r2Put(objectKey(guide.slug), body);
  mkdirSync(LOCAL_DIR, { recursive: true });
  writeFileSync(join(LOCAL_DIR, `${guide.slug}.json`), body, "utf8");
}

// Spend guard for the public generator: at most `limit` live runs per UTC day. A counter file in R2;
// not atomic, so two runs at the same instant can both pass, which is fine for a cost cap.
export async function takeGenerationSlot(limit = Number(process.env.DAILY_GENERATION_LIMIT ?? 40)): Promise<boolean> {
  if (!useR2) return true;
  const key = `meta/generations-${new Date().toISOString().slice(0, 10)}.json`;
  const stored = await r2Get(key);
  const count = stored ? (JSON.parse(stored) as { count: number }).count : 0;
  if (count >= limit) return false;
  await r2Put(key, JSON.stringify({ count: count + 1 }));
  return true;
}

// Same idea for other per-day caps (feedback reports). Works locally too, so the limit is testable.
export async function takeDailyCounter(name: string, limit: number): Promise<boolean> {
  const key = `meta/${name}-${new Date().toISOString().slice(0, 10)}.json`;
  const stored = await kvGet(key);
  const count = stored ? (JSON.parse(stored) as { count: number }).count : 0;
  if (count >= limit) return false;
  await kvPut(key, JSON.stringify({ count: count + 1 }));
  return true;
}

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\.(com|io|dev|app|co|ai|org|net)(\/.*)?$/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}
