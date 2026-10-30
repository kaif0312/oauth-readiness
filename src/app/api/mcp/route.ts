import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import { generateGuide } from "@/lib/agent";
import { buildPlan } from "@/lib/plan";
import { parseProfile, profile, profileTemplate } from "@/lib/profile";
import { getGuide, liveGuides, normalizeSlug, saveGuide, seedGuides, slugify, takeGenerationSlot } from "@/lib/store";
import { installHtml } from "@/lib/install";

export const maxDuration = 300;

const SITE = "https://oauth-readiness-five.vercel.app";
const json = (data: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] });
const fail = (text: string) => ({ content: [{ type: "text" as const, text }], isError: true });
const unknown = async (slug: string) => {
  const slugs = [...seedGuides(), ...(await liveGuides())].map((g) => g.slug).join(", ");
  return fail(`No guide '${slug}'. Known slugs: ${slugs}. For another provider call research_app (slow and paid), or tell the developer.`);
};

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
          "Use this when a developer asks to set up / register / create an OAuth app for a provider (e.g. 'set up Slack OAuth for my app'). Returns ordered steps for an agent driving the developer's own signed-in browser: each console form field filled from the developer's profile (or listed under `missing`), STOP points where the human signs in, accepts terms, pays or submits, the scopes to request, env var names for the credentials, and how to verify it works. Pass the developer's own `profile` (call get_profile with template: true for the keys; ask the developer for missing values, never invent them). Without a profile the plan is filled with Iskaria's example data. ~1.5-3k tokens.",
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
        }),
      },
      async ({ slug, phases, profile: custom, compact }) => {
        const g = await getGuide(slug);
        if (!g) return unknown(slug);
        let p;
        try {
          p = parseProfile(custom);
        } catch (e) {
          return fail(`profile is not valid JSON: ${(e as Error).message}`);
        }
        return json(buildPlan(g, phases ?? ["build", "test"], p, { compact }));
      },
    );

    server.registerTool(
      "get_profile",
      {
        title: "Get the profile template",
        description:
          "With template: true (recommended), the keys a setup plan fills console forms from (app name, URLs, support email, redirect URIs...), which are required, and an example: fill it from the developer's project (package.json, site, README) and ask them for the rest. Without it, Iskaria's real profile as a worked example.",
        inputSchema: z.object({ template: z.boolean().optional().describe("true: empty template with field descriptions; false/absent: Iskaria's example profile") }),
      },
      async ({ template }) => json(template ? profileTemplate() : profile),
    );

    server.registerTool(
      "research_app",
      {
        title: "Research a new provider",
        description:
          "Only when list_guides has no guide for the provider. Runs a research agent on an app name or website and publishes a new guide. SLOW (2-4 minutes; the call blocks, and a client with a short tool timeout may give up: then call get_guide with the slug a few minutes later), costs real API money, and shares a site-wide daily cap, so ask the developer first. Returns the existing guide if there is one, unless force is true. Then call get_setup_plan with the returned slug.",
        inputSchema: z.object({ query: z.string().min(2).max(120), force: z.boolean().optional() }),
      },
      async ({ query, force }) => {
        const slug = force ? slugify(query) : normalizeSlug(query);
        if (!slug) return fail("Could not make a slug from that name.");
        const existing = force ? null : await getGuide(slug);
        if (existing) return json({ slug, url: `${SITE}/guides/${slug}`, existing: true, summary: existing.summary });
        if (!(await takeGenerationSlot())) return fail("Today's limit of live generations is used up.");
        const guide = await generateGuide(query.trim(), slug, () => {});
        await saveGuide(guide);
        return json({ slug, url: `${SITE}/guides/${slug}`, summary: guide.summary, verdict: guide.verdict });
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
