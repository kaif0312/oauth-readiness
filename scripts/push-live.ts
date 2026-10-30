// Copy locally generated guides (.data/guides) into the production R2 bucket.
// Usage (the R2_* env is in .env.local, or `vercel env pull`):
//   node --env-file=.env.local scripts/push-live.ts calendly [slug...]
import { readFileSync } from "node:fs";
import { r2Configured, r2Get, r2Put } from "../src/lib/r2.ts";
import { Guide } from "../src/lib/guide.ts";

if (!r2Configured()) throw new Error("R2_ENDPOINT / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET missing");
for (const slug of process.argv.slice(2)) {
  const guide = Guide.parse(JSON.parse(readFileSync(`.data/guides/${slug}.json`, "utf8")));
  const body = JSON.stringify(guide, null, 2);
  await r2Put(`guides/${slug}.json`, body);
  const back = await r2Get(`guides/${slug}.json`);
  console.log(`pushed ${slug} (${body.length} bytes, read back ${back === body ? "OK" : "MISMATCH"})`);
}
