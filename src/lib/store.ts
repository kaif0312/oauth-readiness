import { readFileSync, readdirSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { r2Configured, r2Get, r2List, r2Put } from "./r2";
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

export async function getGuide(input: string): Promise<Guide | null> {
  const slug = normalizeSlug(input);
  if (!slug) return null;
  const seed = seedGuides().find((g) => g.slug === slug);
  if (seed) return seed;
  if (useR2) return fetchGuide(objectKey(slug));
  const file = join(LOCAL_DIR, `${slug}.json`);
  return existsSync(file) ? Guide.parse(JSON.parse(readFileSync(file, "utf8"))) : null;
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
