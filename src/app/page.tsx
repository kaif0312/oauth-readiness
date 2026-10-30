import Link from "next/link";
import { connection } from "next/server";
import { seedGuides, liveGuides } from "@/lib/store";
import type { Guide } from "@/lib/guide";
import { Difficulty } from "@/components/bits";
import { GenerateBox } from "@/components/generate-box";
import { AgentPanel } from "@/components/agent-panel";
import { INSTALLS, agentPrompt } from "@/lib/install";

const ORDER = { easy: 0, moderate: 1, hard: 2, gated: 3 } as const;

function Row({ g }: { g: Guide }) {
  return (
    <Link href={`/guides/${g.slug}`} className="row-link grid grid-cols-12 gap-x-3 gap-y-1 px-4 py-3 border-t border-line hover:bg-soft items-center">
      <div className="col-span-10 sm:col-span-3">
        <div className="font-semibold text-accent">{g.app}</div>
        <div className="text-xs text-muted">{g.category}</div>
      </div>
      <div className="col-span-2 sm:hidden text-right row-go text-muted" aria-hidden>→</div>
      <div className="col-span-12 sm:col-span-2"><Difficulty value={g.verdict.difficulty} /></div>
      <div className="col-span-6 sm:col-span-2 text-sm"><span className="sm:hidden text-muted">First token </span>{g.verdict.timeToFirstToken}</div>
      <div className="col-span-6 sm:col-span-2 text-sm font-medium"><span className="sm:hidden text-muted font-normal">Real users </span>{g.verdict.timeToLaunch}</div>
      <div className="hidden sm:block sm:col-span-2 text-xs text-muted"><span className="line-clamp-2">{g.verdict.reviewRequired}</span></div>
      <div className="hidden sm:block sm:col-span-1 text-right text-sm text-muted row-go">Open →</div>
    </Link>
  );
}

function Table({ guides }: { guides: Guide[] }) {
  return (
    <div className="panel overflow-hidden">
      <div className="hidden sm:grid grid-cols-12 gap-3 px-4 py-2 label">
        <div className="col-span-3">App</div>
        <div className="col-span-2">Difficulty</div>
        <div className="col-span-2">First token</div>
        <div className="col-span-2">Real users</div>
        <div className="col-span-3">Review</div>
      </div>
      {guides.map((g) => <Row key={g.slug} g={g} />)}
    </div>
  );
}

export default async function Home() {
  await connection();
  const seeds = seedGuides().sort((a, b) => ORDER[a.verdict.difficulty] - ORDER[b.verdict.difficulty]);
  const live = (await liveGuides()).filter((g) => !seeds.some((s) => s.slug === g.slug));

  return (
    <div className="wrap py-10">
      <section className="max-w-2xl">
        <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight leading-tight">
          How long your OAuth app will take to get approved, per provider. And an agent to set it up.
        </h1>
        <p className="mt-4 text-muted">
          Pick a provider for the real timeline: <b className="text-ink">first token</b> (your own account works, usually minutes) and{" "}
          <b className="text-ink">real users</b> (after review, sometimes weeks), what can block approval, and which steps your coding agent can do for you.
          Every claim is marked tested, sourced or inferred.
        </p>
        <div className="mt-5 flex flex-wrap gap-3 no-print">
          <a href="#library" className="btn">Pick a provider</a>
          <a href="#agent" className="btn-sm self-center">Set it up with your agent →</a>
        </div>
      </section>

      <section className="mt-10" id="library">
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-lg font-semibold">Library</h2>
          <span className="text-xs text-muted">{seeds.length} researched guides, easiest first</span>
        </div>
        <Table guides={seeds} />
      </section>

      {live.length > 0 && (
        <section className="mt-8">
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="text-lg font-semibold">Generated live</h2>
            <span className="text-xs text-muted">written by the agent on request, not yet reviewed by a person</span>
          </div>
          <Table guides={live} />
        </section>
      )}

      <section className="mt-6 panel p-4 sm:p-5 no-print">
        <div className="font-semibold mb-1">Provider not listed? Research it live</div>
        <p className="text-xs text-muted mb-3">
          An agent reads the provider&apos;s docs, probes its OAuth endpoints, re-checks the key claims and writes a shareable guide. Takes 2-4 minutes;
          free for you, up to 40 runs a day across the site. Apps already in the library open instantly.
        </p>
        <GenerateBox known={[...seeds, ...live].map((g) => ({ slug: g.slug, app: g.app }))} />
      </section>

      <div className="mt-10">
        <AgentPanel installs={INSTALLS} prompt={agentPrompt()} title="Set it up with your coding agent" />
      </div>
    </div>
  );
}
