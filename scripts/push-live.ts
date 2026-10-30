// Copy locally generated guides (.data/guides) into the production Blob store.
// Usage (BLOB_READ_WRITE_TOKEN comes from `vercel env pull`, already in .env.local):
//   node --env-file=.env.local scripts/push-live.ts calendly [slug...]
import { readFileSync } from "node:fs";
import { put } from "@vercel/blob";
import { Guide } from "../src/lib/guide.ts";

if (!process.env.BLOB_READ_WRITE_TOKEN) throw new Error("BLOB_READ_WRITE_TOKEN missing");
for (const slug of process.argv.slice(2)) {
  const guide = Guide.parse(JSON.parse(readFileSync(`.data/guides/${slug}.json`, "utf8")));
  const { url } = await put(`guides/${slug}.json`, JSON.stringify(guide, null, 2), {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 60,
  });
  console.log(`pushed ${slug} -> ${url}`);
}
