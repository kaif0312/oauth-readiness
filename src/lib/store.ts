import { readFileSync, readdirSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { put, list, head } from "@vercel/blob";
import { Guide } from "./guide";

// Seeded guides ship in the repo (src/data/guides). Live-generated guides go to Vercel Blob
// (one public JSON file per guide) when BLOB_READ_WRITE_TOKEN is set, else to .data/guides (local dev).

const SEED_DIR = join(process.cwd(), "src/data/guides");
const LOCAL_DIR = join(process.cwd(), ".data/guides");
const useBlob = !!process.env.BLOB_READ_WRITE_TOKEN;
const blobPath = (slug: string) => `guides/${slug}.json`;

function readDir(dir: string): Guide[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .flatMap((f) => {
      const parsed = Guide.safeParse(JSON.parse(readFileSync(join(dir, f), "utf8")));
      return parsed.success ? [parsed.data] : [];
    });
}

async function fetchGuide(url: string): Promise<Guide | null> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) return null;
  const parsed = Guide.safeParse(await res.json());
  return parsed.success ? parsed.data : null;
}

export function seedGuides(): Guide[] {
  return readDir(SEED_DIR).sort((a, b) => a.app.localeCompare(b.app));
}

export async function liveGuides(): Promise<Guide[]> {
  if (!useBlob) return readDir(LOCAL_DIR);
  const { blobs } = await list({ prefix: "guides/", limit: 100 });
  const newest = blobs.sort((a, b) => +b.uploadedAt - +a.uploadedAt).slice(0, 30);
  const guides = await Promise.all(newest.map((b) => fetchGuide(b.url)));
  return guides.filter((g): g is Guide => !!g);
}

export async function getGuide(slug: string): Promise<Guide | null> {
  const seed = seedGuides().find((g) => g.slug === slug);
  if (seed) return seed;
  if (useBlob) {
    const meta = await head(blobPath(slug)).catch(() => null);
    return meta ? fetchGuide(meta.url) : null;
  }
  const file = join(LOCAL_DIR, `${slug}.json`);
  return existsSync(file) ? Guide.parse(JSON.parse(readFileSync(file, "utf8"))) : null;
}

export async function saveGuide(guide: Guide): Promise<void> {
  const body = JSON.stringify(guide, null, 2);
  if (useBlob) {
    await put(blobPath(guide.slug), body, {
      access: "public",
      contentType: "application/json",
      addRandomSuffix: false,
      allowOverwrite: true,
      cacheControlMaxAge: 60,
    });
    return;
  }
  mkdirSync(LOCAL_DIR, { recursive: true });
  writeFileSync(join(LOCAL_DIR, `${guide.slug}.json`), body, "utf8");
}

// Spend guard for the public generator: at most `limit` live runs per UTC day. A counter file in Blob;
// not atomic, so two runs at the same instant can both pass, which is fine for a cost cap.
export async function takeGenerationSlot(limit = Number(process.env.DAILY_GENERATION_LIMIT ?? 40)): Promise<boolean> {
  if (!useBlob) return true;
  const path = `meta/generations-${new Date().toISOString().slice(0, 10)}.json`;
  const meta = await head(path).catch(() => null);
  const count = meta ? ((await (await fetch(meta.url, { cache: "no-store" })).json()) as { count: number }).count : 0;
  if (count >= limit) return false;
  await put(path, JSON.stringify({ count: count + 1 }), { access: "public", contentType: "application/json", addRandomSuffix: false, allowOverwrite: true, cacheControlMaxAge: 60 });
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
