import { readFileSync, readdirSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { Redis } from "@upstash/redis";
import { Guide } from "./guide";

// Seeded guides ship in the repo (src/data/guides). Live-generated guides go to Upstash Redis
// when it is configured (production), else to .data/guides on disk (local dev).

const SEED_DIR = join(process.cwd(), "src/data/guides");
const LOCAL_DIR = join(process.cwd(), ".data/guides");

const redisUrl = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
const redis = redisUrl && redisToken ? new Redis({ url: redisUrl, token: redisToken }) : null;

const KEY = (slug: string) => `guide:${slug}`;
const INDEX = "guides:live";

function readDir(dir: string): Guide[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .flatMap((f) => {
      const parsed = Guide.safeParse(JSON.parse(readFileSync(join(dir, f), "utf8")));
      return parsed.success ? [parsed.data] : [];
    });
}

export function seedGuides(): Guide[] {
  return readDir(SEED_DIR).sort((a, b) => a.app.localeCompare(b.app));
}

export async function liveGuides(): Promise<Guide[]> {
  if (!redis) return readDir(LOCAL_DIR);
  const slugs = await redis.zrange<string[]>(INDEX, 0, 49, { rev: true });
  if (!slugs.length) return [];
  const rows = await redis.mget<(Guide | null)[]>(...slugs.map(KEY));
  return rows.filter((g): g is Guide => !!g);
}

export async function getGuide(slug: string): Promise<Guide | null> {
  const seed = seedGuides().find((g) => g.slug === slug);
  if (seed) return seed;
  if (redis) return (await redis.get<Guide>(KEY(slug))) ?? null;
  const file = join(LOCAL_DIR, `${slug}.json`);
  return existsSync(file) ? Guide.parse(JSON.parse(readFileSync(file, "utf8"))) : null;
}

export async function saveGuide(guide: Guide): Promise<void> {
  if (redis) {
    await Promise.all([redis.set(KEY(guide.slug), guide), redis.zadd(INDEX, { score: Date.now(), member: guide.slug })]);
    return;
  }
  mkdirSync(LOCAL_DIR, { recursive: true });
  writeFileSync(join(LOCAL_DIR, `${guide.slug}.json`), JSON.stringify(guide, null, 2), "utf8");
}

// Spend guard for the public generator: at most `limit` live runs per UTC day (only enforced with Redis).
export async function takeGenerationSlot(limit = Number(process.env.DAILY_GENERATION_LIMIT ?? 40)): Promise<boolean> {
  if (!redis) return true;
  const key = `gen:${new Date().toISOString().slice(0, 10)}`;
  const n = await redis.incr(key);
  if (n === 1) await redis.expire(key, 60 * 60 * 26);
  return n <= limit;
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
