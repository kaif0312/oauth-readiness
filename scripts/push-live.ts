// Copy locally generated guides (.data/guides) into the production Redis store.
// Usage: vercel env pull .env.production.local --environment production, then
//   node --env-file=.env.production.local scripts/push-live.ts calendly [slug...]
import { readFileSync } from "node:fs";
import { Redis } from "@upstash/redis";
import { Guide } from "../src/lib/guide.ts";

const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
if (!url || !token) throw new Error("Upstash env vars missing");
const redis = new Redis({ url, token });

for (const slug of process.argv.slice(2)) {
  const guide = Guide.parse(JSON.parse(readFileSync(`.data/guides/${slug}.json`, "utf8")));
  await redis.set(`guide:${slug}`, guide);
  await redis.zadd("guides:live", { score: Date.now(), member: slug });
  console.log(`pushed ${slug}`);
}
