import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import { buildPlan } from "@/lib/plan";
import { parseProfile, profile, profileTemplate } from "@/lib/profile";
import { getGuide, liveGuides, normalizeSlug, resolveSlug, seedGuides, slugify } from "@/lib/store";
import { readJob, startJob, type Job } from "@/lib/jobs";
import { MAX_TEXT, REPORT_KINDS, submitReport } from "@/lib/feedback";
import { installHtml } from "@/lib/install";

export const maxDuration = 300;

const SITE = "https://oauth-readiness-five.vercel.app";
const json = (data: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] });
const fail = (text: string) => ({ content: [{ type: "text" as const, text }], isError: true });
const unknown = async (slug: string) => {
  const slugs = [...seedGuides(), ...(await liveGuides())].map((g) => g.slug).join(", ");
  return fail(`No guide '${slug}'. Known slugs: ${slugs}. For another provider call research_app (runs 2-4 min in the background, paid), or tell the developer.`);
};

const jobView = (j: Job) => ({
  slug: j.slug,
  status: j.status,
  step: j.step,
  progress: j.counts,
  startedAt: j.startedAt,
  updatedAt: j.updatedAt,
  ...(j.error ? { error: j.error } : {}),
});

const handler = createMcpHandler(
  (server) => {
    server.registerTool(
      "list_guides",
      {
        title: "List OAuth guides",
        description:
          "Start here. Lists the providers that have an OAuth guide (slug, difficulty, hands-on time to your own first token, calendar time until any user can connect including review). Small (~600 tokens). Then: get_setup_plan to set an app up, get_guide only for research questions.",
        inputSchema: z.object({}),
      },
      async () => {
        const guides = [...seedGuides(), ...(await liveGuides())];
        return json(
          guides.map((g) => ({
            slug: g.slug,
            app: g.app,
            difficulty: g.verdict.difficulty,
            timeToFirstToken: g.verdict.timeToFirstToken,
            timeToLaunch: g.verdict.timeToLaunch,
            source: g.meta.generatedBy === "seed-research" ? "researched + verified" : "live agent, unreviewed",
          })),
        );
      },
    );

    server.registerTool(
      "get_guide",
      {
        title: "Get an OAuth guide",
        description:
          "The full research for one provider: verdict, test-mode limits, prerequisites, steps, scopes with review tier, blockers, uncertainties and sources, every claim marked tested / sourced / inferred. LONG (~7k tokens): use it to answer questions like 'how long will Google review take' or 'which scopes need a security assessment'. To actually set an app up, call get_setup_plan instead.",
        inputSchema: z.object({ slug: z.string().describe("slug from list_guides, e.g. google-gmail; names like 'Gmail' or 'Slack' also work") }),
      },
      async ({ slug }) => {
        const g = await getGuide(slug);
        return g ? json({ ...g, url: `${SITE}/guides/${g.slug}` }) : unknown(slug);
      },
    );

    server.registerTool(
      "get_setup_plan",
      {
        title: "Get a setup plan for a browser agent",
        description:
          "Use this when a developer asks to set up / register / create an OAuth app for a provider (e.g. 'set up Slack OAuth for my app'). Returns ordered steps for an agent driving the developer's own signed-in browser: each console form field filled from the developer's profile (or listed under `missing`), STOP points where the human signs in, accepts terms, pays or submits, the scopes to request, env var names for the credentials, and and `verify`: a ready authorize URL plus `verifyScript`, a self-contained Node 20+ script (no deps) to write to a scratch file and run in the developer's repo; the human approves in the browser and it prints only success/failure, granted scopes, token type, expiry, refresh-token presence and the test call's HTTP status (never tokens or secrets). `oauth` gives the authorize/token URLs, PKCE, client auth and refresh behaviour. Pass the developer's own `profile` (call get_profile with template: true for the keys; ask the developer for missing values, never invent them). Without a profile NOTHING is filled: every profile-backed field is `missing` and `next` tells you what to do. Pass example: true only for a worked example with Iskaria's data (never type it into a real console). ~1.5-3k tokens (verifyScript is ~0.7k; verifyScript: false omits it).",
        inputSchema: z.object({
          slug: z.string().describe("slug from list_guides, e.g. slack; names like 'Gmail' also work"),
          phases: z
            .array(z.enum(["build", "test", "launch"]))
            .optional()
            .describe("build = create app + credentials, test = works for you and test users, launch = review for real users. Default: build and test"),
          profile: z
            .union([z.record(z.string(), z.any()), z.string()])
            .optional()
            .describe("the developer's profile: {appName, homepageUrl, privacyPolicyUrl, supportEmail, authorizedDomains[], redirectUris[] (use {provider} as a placeholder), ...}; see get_profile with template: true"),
          compact: z.boolean().optional().describe("drop the evidence detail from the verdict (smaller)"),
          example: z.boolean().optional().describe("no profile: fill the plan with Iskaria's example data instead of leaving fields missing. Only to show a worked example; never use those values for a real developer"),
          verifyScript: z.boolean().optional().describe("include the verification script in verify (default true); false for a smaller plan"),
        }),
      },
      async ({ slug, phases, profile: custom, compact, example, verifyScript }) => {
        const g = await getGuide(slug);
        if (!g) return unknown(slug);
        let p;
        try {
          p = parseProfile(custom);
        } catch (e) {
          return fail(`profile is not valid JSON: ${(e as Error).message}`);
        }
        return json(buildPlan(g, phases ?? ["build", "test"], p, { compact, example, verifyScript }));
      },
    );

    server.registerTool(
      "get_profile",
      {
        title: "Get the profile template",
        description:
          "With template: true (recommended), the keys a setup plan fills console forms from (app name, URLs, support email, redirect URIs...), which are required, and an example: fill it from the developer's project (package.json, site, README) and ask them for the rest. Without it, Iskaria's real profile as a worked example (get_setup_plan never uses it unless you pass example: true).",
        inputSchema: z.object({ template: z.boolean().optional().describe("true: empty template with field descriptions; false/absent: Iskaria's example profile") }),
      },
      async ({ template }) => json(template ? profileTemplate() : profile),
    );

    server.registerTool(
      "research_app",
      {
        title: "Research a new provider",
        description:
          "Only when list_guides has no guide for the provider. Starts a research agent on an app name or website that publishes a new guide. Returns AT ONCE with status 'running' (the research takes 2-4 minutes in the background and costs real API money with a site-wide daily cap, so ask the developer first). Then call get_research_status with the slug every 20-30 seconds until it says done, and call get_setup_plan with that slug. Returns the existing guide if there is one (names like 'HubSpot CRM' or 'Microsoft Outlook' resolve to existing guides); if the name is close to several guides (e.g. 'Google Drive') it returns the candidates: pick one of their slugs, or pass force: true to research it as new. If a run for the same provider is already going, that run is returned and no second one is started.",
        inputSchema: z.object({ query: z.string().min(2).max(120), force: z.boolean().optional().describe("research as a new provider even if a similar guide exists") }),
      },
      async ({ query, force }) => {
        const q = query.trim();
        const slug = force ? slugify(q) : undefined;
        let target = slug;
        if (!force) {
          const r = await resolveSlug(q);
          if (r.kind === "exact" && r.slug) {
            const existing = await getGuide(r.slug);
            if (existing) return json({ slug: r.slug, url: `${SITE}/guides/${r.slug}`, existing: true, summary: existing.summary, next: "call get_setup_plan with this slug" });
          }
          if (r.kind === "close" || r.kind === "ambiguous") {
            return json({
              status: "needs_choice",
              message: `'${q}' is close to existing guide(s) but not clearly the same provider. Use one of these slugs with get_setup_plan, or call research_app again with force: true to research '${q}' as new.`,
              candidates: r.candidates,
            });
          }
          target = normalizeSlug(q);
        }
        if (!target) return fail("Could not make a slug from that name.");
        const started = await startJob(q, target);
        if (!started.started && started.reason === "limit") return fail("Today's limit of live generations is used up.");
        return json({ ...jobView(started.job), alreadyRunning: !started.started, pollWith: "get_research_status", etaSeconds: 180, pollEverySeconds: 25 });
      },
    );

    server.registerTool(
      "get_research_status",
      {
        title: "Check a research run",
        description:
          "Progress of a research_app run, by the slug research_app returned. Poll every 20-30 seconds (a run takes 2-4 minutes). status 'running' shows the latest step; 'done' returns the summary and verdict and says to call get_setup_plan next; 'error' says what failed (retry with research_app force: true). A run with no progress for 6 minutes counts as failed.",
        inputSchema: z.object({ slug: z.string().describe("the slug research_app returned") }),
      },
      async ({ slug }) => {
        const s = slugify(slug);
        const job = s ? await readJob(s) : null;
        if (!job) {
          const g = await getGuide(slug);
          if (g) return json({ slug: g.slug, status: "done", url: `${SITE}/guides/${g.slug}`, summary: g.summary, verdict: g.verdict, next: "call get_setup_plan with this slug" });
          return fail(`No research run for '${slug}'. Start one with research_app.`);
        }
        if (job.status === "done") {
          const g = await getGuide(job.slug);
          return json({ ...jobView(job), url: `${SITE}/guides/${job.slug}`, summary: g?.summary, verdict: g?.verdict, next: "call get_setup_plan with this slug" });
        }
        return json({ ...jobView(job), ...(job.status === "running" ? { pollWith: "get_research_status", pollEverySeconds: 25 } : { next: "retry with research_app and force: true, or tell the developer" }) });
      },
    );

    server.registerTool(
      "report_issue",
      {
        title: "Report a problem or success with a guide",
        description:
          "Call this when the provider's console did not match a step of the plan (kind 'console-changed'), a fact in the guide was wrong ('wrong-fact'), a step was missing ('missing-step'), and with kind 'worked' after a setup succeeded. Short and factual: what the step said, what you saw instead. NEVER include secrets, tokens, client secrets or personal data (such reports are rejected). Reports are shown on the guide page and used to fix guides.",
        inputSchema: z.object({
          slug: z.string().describe("the guide's slug, e.g. google-gmail"),
          step: z.number().int().min(0).max(200).optional().describe("step number in the plan, if one applies"),
          kind: z.enum(REPORT_KINDS),
          text: z.string().min(1).max(MAX_TEXT),
          evidenceUrl: z.string().max(500).optional().describe("page URL that shows the problem (no tokens in it)"),
        }),
      },
      async ({ slug, step, kind, text, evidenceUrl }) => {
        const g = await getGuide(slug);
        if (!g) return unknown(slug);
        const res = await submitReport({ slug: g.slug, step, kind, text, evidenceUrl });
        return res.ok ? json({ ok: true, slug: g.slug, thanks: "Report stored." }) : fail(res.error);
      },
    );
  },
  { serverInfo: { name: "oauth-readiness", version: "0.1.0" } },
);

// A browser opening the MCP URL gets the install instructions instead of a JSON-RPC 405.
async function GET(req: Request) {
  if ((req.headers.get("accept") ?? "").includes("text/html")) return new Response(installHtml(), { headers: { "content-type": "text/html; charset=utf-8" } });
  return handler(req);
}

export { GET, handler as POST };
