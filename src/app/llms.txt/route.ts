import { llmsTxt } from "@/lib/install";
import { liveGuides, seedGuides } from "@/lib/store";

// Agent-readable entry point (llmstxt.org): what this is, the MCP URL, the tools and every guide.
export async function GET() {
  const guides = [...seedGuides(), ...(await liveGuides().catch(() => []))].map((g) => ({
    slug: g.slug,
    app: g.app,
    difficulty: g.verdict.difficulty,
    firstToken: g.verdict.timeToFirstToken,
    launch: g.verdict.timeToLaunch,
  }));
  return new Response(llmsTxt(guides), { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=300" } });
}
