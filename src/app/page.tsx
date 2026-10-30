import Link from "next/link";
import { connection } from "next/server";
import { seedGuides, liveGuides } from "@/lib/store";
import { profile } from "@/lib/profile";
import type { Guide } from "@/lib/guide";
import { Difficulty } from "@/components/bits";
import { GenerateBox } from "@/components/generate-box";

const ORDER = { easy: 0, moderate: 1, hard: 2, gated: 3 } as const;

function Row({ g }: { g: Guide }) {
  return (
    <Link href={`/guides/${g.slug}`} className="grid grid-cols-12 gap-3 px-4 py-3 border-t border-line hover:bg-soft items-center">
      <div className="col-span-12 sm:col-span-3">
        <div className="font-semibold">{g.app}</div>
        <div className="text-xs text-muted">{g.category}</div>
      </div>
      <div className="col-span-4 sm:col-span-2"><Difficulty value={g.verdict.difficulty} /></div>
      <div className="col-span-4 sm:col-span-2 text-sm">{g.verdict.timeToFirstToken}</div>
      <div className="col-span-4 sm:col-span-2 text-sm font-medium">{g.verdict.timeToLaunch}</div>
      <div className="col-span-12 sm:col-span-3 text-xs text-muted line-clamp-2">{g.verdict.reviewRequired}</div>
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
          Before your agent can connect an app, you need an approved OAuth app. Here is how long that really takes.
        </h1>
        <p className="mt-4 text-muted">
          Each guide separates <b className="text-ink">first token</b> (your own account works, usually minutes) from{" "}
          <b className="text-ink">real users</b> (after review, sometimes weeks), shows which steps an agent can do and which need you, and marks
          every claim as tested, sourced or inferred. Guides are personalised for{" "}
          <Link href="/profile" className="link">{profile.companyName}</Link>&apos;s developer profile.
        </p>
      </section>

      <section className="mt-8 panel p-4 sm:p-5 no-print">
        <div className="label mb-2">Not in the library? An agent will research it now</div>
        <GenerateBox />
        <p className="text-xs text-muted mt-2">
          Takes 2-4 minutes: it searches the provider&apos;s docs, fetches and quotes them, probes the provider&apos;s OAuth endpoints, re-checks the key claims, then writes a shareable guide.
        </p>
      </section>

      <section className="mt-10">
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-lg font-semibold">Library</h2>
          <span className="text-xs text-muted">{seeds.length} researched guides, easiest first</span>
        </div>
        <Table guides={seeds} />
      </section>

      {live.length > 0 && (
        <section className="mt-10">
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="text-lg font-semibold">Generated live</h2>
            <span className="text-xs text-muted">written by the agent on request, not yet reviewed by a person</span>
          </div>
          <Table guides={live} />
        </section>
      )}
    </div>
  );
}
