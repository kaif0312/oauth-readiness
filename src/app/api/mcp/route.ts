import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import { generateGuide } from "@/lib/agent";
import { buildPlan } from "@/lib/plan";
import { profile, type Json } from "@/lib/profile";
import { getGuide, liveGuides, saveGuide, seedGuides, slugify, takeGenerationSlot } from "@/lib/store";

export const maxDuration = 300;

const SITE = "https://oauth-readiness-five.vercel.app";
const json = (data: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] });
const fail = (text: string) => ({ content: [{ type: "text" as const, text }], isError: true });

const handler = createMcpHandler(
  (server) => {
    server.registerTool(
      "list_guides",
      {
        title: "List OAuth guides",
        description:
          "List the providers that have an OAuth setup guide, with difficulty and the two timelines: hands-on time to your own first token, and calendar time until any user can connect (including review).",
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
          "Full guide for one provider: verdict, test-mode limits, prerequisites, steps (who does each: agent / agent-then-you / you), scopes with review tier, blockers, uncertainties and sources. Every claim has evidence: tested, sourced or inferred.",
        inputSchema: z.object({ slug: z.string().describe("slug from list_guides, e.g. google-gmail") }),
      },
      async ({ slug }) => {
        const g = await getGuide(slug);
        return g ? json({ ...g, url: `${SITE}/guides/${slug}` }) : fail(`No guide '${slug}'. Call list_guides, or research_app to create one.`);
      },
    );

    server.registerTool(
      "get_setup_plan",
      {
        title: "Get a setup plan for a browser agent",
        description:
          "Turn a guide into step-by-step instructions for an agent that fills the provider's console in the developer's own browser: every form field resolved to a profile value (or marked missing), and STOP points where the human must sign in, pay, accept terms or submit. Defaults to the Iskaria profile; pass your own profile object to personalise.",
        inputSchema: z.object({
          slug: z.string(),
          phases: z.array(z.enum(["build", "test", "launch"])).optional().describe("default: build and test"),
          profile: z.record(z.string(), z.any()).optional().describe("developer profile with the same keys as get_profile; default Iskaria"),
        }),
      },
      async ({ slug, phases, profile: custom }) => {
        const g = await getGuide(slug);
        if (!g) return fail(`No guide '${slug}'.`);
        return json(buildPlan(g, phases ?? ["build", "test"], (custom as Json | undefined) ?? undefined));
      },
    );

    server.registerTool(
      "get_profile",
      {
        title: "Get the developer profile",
        description: "The developer profile (company, URLs, support email, redirect URIs, use cases) that setup plans fill forms from. Use it as a template for your own.",
        inputSchema: z.object({}),
      },
      async () => json(profile),
    );

    server.registerTool(
      "research_app",
      {
        title: "Research a new provider",
        description:
          "Run the research agent on an app name or website and publish a guide (takes 2-4 minutes). Returns the existing guide if there is one, unless force is true. Limited runs per day.",
        inputSchema: z.object({ query: z.string().min(2).max(120), force: z.boolean().optional() }),
      },
      async ({ query, force }) => {
        const slug = slugify(query);
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

export { handler as GET, handler as POST };
