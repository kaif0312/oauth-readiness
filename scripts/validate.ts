// Validate guide JSON files against the schema.
// Usage: node scripts/validate.ts [file...]   (default: every file in src/data/guides)
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { Guide } from "../src/lib/guide.ts";

const dir = "src/data/guides";
const files = process.argv.slice(2).length
  ? process.argv.slice(2)
  : readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => join(dir, f));

const OWNER = /iskaria|clinic/i;
function ownerLeaks(value: unknown, path: (string | number)[] = []): string[] {
  if (path[0] === "sources" || path[0] === "meta") return [];
  if (typeof value === "string") {
    const isEvidenceNote = path.at(-1) === "note" && path.at(-2) === "evidence";
    return !isEvidenceNote && OWNER.test(value) ? [`${path.join(".")}: ${value.slice(0, 120)}`] : [];
  }
  if (Array.isArray(value)) return value.flatMap((v, i) => ownerLeaks(v, [...path, i]));
  if (value && typeof value === "object")
    return Object.entries(value).flatMap(([k, v]) => ownerLeaks(v, [...path, k]));
  return [];
}

let failed = 0;
for (const file of files) {
  const data = JSON.parse(readFileSync(file, "utf8"));
  const res = Guide.safeParse(data);
  if (!res.success) {
    failed++;
    console.log(`FAIL ${file}`);
    for (const issue of res.error.issues.slice(0, 20)) console.log(`  ${issue.path.join(".")}: ${issue.message}`);
    continue;
  }
  // Every cited source id must exist.
  const ids = new Set(res.data.sources.map((s) => s.id));
  const missing = new Set<string>();
  JSON.stringify(res.data, (k, v) => {
    if (k === "sourceIds") for (const id of v as string[]) if (!ids.has(id)) missing.add(id);
    return v;
  });
  if (missing.size) {
    failed++;
    console.log(`FAIL ${file}: unknown source ids ${[...missing].join(", ")}`);
    continue;
  }
  // Guides must read correctly for any developer: no Iskaria/clinic situation baked into the guidance.
  // Allowed only as evidence of a real test: inside sources, meta and evidence.note.
  const leaks = ownerLeaks(res.data);
  if (leaks.length) {
    failed++;
    console.log(`FAIL ${file}: developer-specific wording (/iskaria|clinic/i) outside sources/meta/evidence.note`);
    for (const l of leaks.slice(0, 20)) console.log(`  ${l}`);
    continue;
  }
  console.log(`ok   ${file} (${res.data.steps.length} steps, ${res.data.sources.length} sources)`);
}
process.exit(failed ? 1 : 0);
