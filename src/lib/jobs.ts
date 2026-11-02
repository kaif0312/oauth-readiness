import { after } from "next/server";
import { generateGuide, type AgentEvent } from "./agent";
import { Guide } from "./guide";
import { kvGet, kvPut, saveGuide, seedGuides, takeGenerationSlot } from "./store";

// Background research jobs for the MCP: research_app returns at once, the run continues after the response
// (Next `after()` = waitUntil on Vercel, bounded by the route's maxDuration 300 s) and writes its progress to
// jobs/<slug>.json so get_research_status can be polled. One job per slug at a time.

export type Job = {
  slug: string;
  query: string;
  status: "running" | "done" | "error";
  startedAt: string;
  updatedAt: string;
  step: string; // latest human-readable progress
  counts: { searches: number; fetches: number; probes: number };
  error?: string;
};

export const JOB_STALE_MS = 6 * 60_000;
const PROGRESS_THROTTLE_MS = 4_000;
const jobKey = (slug: string) => `jobs/${slug}.json`;

export async function readJob(slug: string): Promise<Job | null> {
  const raw = await kvGet(jobKey(slug));
  if (!raw) return null;
  try {
    const job = JSON.parse(raw) as Job;
    // A run that died with its function (timeout, crash) never writes a final state: call it failed after 6 min.
    if (job.status === "running" && Date.now() - Date.parse(job.updatedAt) > JOB_STALE_MS) {
      const failed: Job = {
        ...job,
        status: "error",
        error: "The research run stopped without finishing (no progress for 6 minutes). Call research_app again with force: true to retry.",
        updatedAt: new Date().toISOString(),
      };
      await kvPut(jobKey(slug), JSON.stringify(failed));
      return failed;
    }
    return job;
  } catch {
    return null;
  }
}

export type Generator = (query: string, slug: string, emit: (e: AgentEvent) => void) => Promise<Guide>;

// Test hook, only honoured outside production: RESEARCH_STUB=1 swaps the paid agent for a fast fake that copies a seed.
async function stubGenerator(query: string, slug: string, emit: (e: AgentEvent) => void): Promise<Guide> {
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  emit({ type: "phase", phase: "research", text: `Researching ${query}` });
  await wait(2500);
  emit({ type: "search", query: `${query} OAuth app registration` });
  await wait(2500);
  emit({ type: "fetch", url: "https://example.com/docs" });
  emit({ type: "probe", domains: ["example.com"], summary: "stub" });
  await wait(2500);
  emit({ type: "phase", phase: "compose", text: "Writing the guide" });
  await wait(2500);
  if (/fail/i.test(query)) throw new Error("stub failure");
  return { ...seedGuides()[0], slug, app: query };
}

function pickGenerator(): Generator {
  return process.env.NODE_ENV !== "production" && process.env.RESEARCH_STUB === "1" ? stubGenerator : generateGuide;
}

function describe(e: AgentEvent): string | null {
  switch (e.type) {
    case "phase":
      return e.text;
    case "search":
      return `Searching: ${e.query}`;
    case "fetch":
      return `Reading ${e.url}`;
    case "probe":
      return "Probing the provider's OAuth endpoints";
    default:
      return null;
  }
}

async function run(job: Job, generate: Generator): Promise<void> {
  let current = job;
  let chain: Promise<void> = Promise.resolve();
  let lastWrite = 0;
  const write = (patch: Partial<Job>) => {
    current = { ...current, ...patch, updatedAt: new Date().toISOString() };
    const snapshot = JSON.stringify(current);
    chain = chain.then(() => kvPut(jobKey(job.slug), snapshot)).catch(() => {});
    lastWrite = Date.now();
  };
  const emit = (e: AgentEvent) => {
    const text = describe(e);
    const counts = { ...current.counts };
    if (e.type === "search") counts.searches++;
    if (e.type === "fetch") counts.fetches++;
    if (e.type === "probe") counts.probes++;
    current = { ...current, counts };
    // Phase changes are written at once; the many search/fetch events at most every few seconds.
    if (text && (e.type === "phase" || Date.now() - lastWrite > PROGRESS_THROTTLE_MS)) write({ step: text });
    else if (text) current = { ...current, step: text };
  };
  try {
    const guide = await generate(job.query, job.slug, emit);
    write({ step: "Saving the guide" });
    await chain;
    await saveGuide(guide);
    write({ status: "done", step: "Done" });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const hint = /authentication_error/.test(message) ? " (server API key problem)" : "";
    write({ status: "error", error: (message + hint).slice(0, 500) });
  }
  await chain;
}

export type StartResult =
  | { started: true; job: Job }
  | { started: false; reason: "running"; job: Job }
  | { started: false; reason: "limit" };

/** Start a research job unless one is already running for this slug (then return it: no second paid run, no slot). */
export async function startJob(query: string, slug: string): Promise<StartResult> {
  const existing = await readJob(slug);
  if (existing?.status === "running") return { started: false, reason: "running", job: existing };
  if (!(await takeGenerationSlot())) return { started: false, reason: "limit" };
  const now = new Date().toISOString();
  const job: Job = { slug, query, status: "running", startedAt: now, updatedAt: now, step: "Queued", counts: { searches: 0, fetches: 0, probes: 0 } };
  await kvPut(jobKey(slug), JSON.stringify(job));
  const work = () => run(job, pickGenerator());
  try {
    after(work);
  } catch {
    void work(); // outside a request scope (scripts, tests): run it in the background
  }
  return { started: true, job };
}
