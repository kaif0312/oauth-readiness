import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import type { Metadata } from "next";
import { getGuide } from "@/lib/store";
import { profile, profileHas, profileDisplay } from "@/lib/profile";
import type { Guide } from "@/lib/guide";
import { Difficulty, EvidenceTag, WhoTag } from "@/components/bits";
import { PrintButton } from "@/components/print-button";
import { AgentPanel } from "@/components/agent-panel";
import { INSTALLS, agentPrompt } from "@/lib/install";

export async function generateMetadata({ params }: PageProps<"/guides/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const g = await getGuide(slug);
  return g ? { title: `${g.app} OAuth guide`, description: g.summary } : {};
}

const PHASES = [
  { key: "build", title: "Build", hint: "create the app and credentials" },
  { key: "test", title: "Test", hint: "works for you and test users" },
  { key: "launch", title: "Launch", hint: "review and approval for real users" },
] as const;

function Have({ k }: { k?: string }) {
  if (!k) return null;
  const has = profileHas(k);
  if (has === undefined) return null;
  return has ? (
    <span className="ev ev-tested" title={profileDisplay(k)}>✓ {profile.companyName} has it</span>
  ) : (
    <span className="ev ev-inferred">✗ {profile.companyName} lacks it</span>
  );
}

function Section({ title, children, id }: { title: string; children: React.ReactNode; id?: string }) {
  return (
    <section className="mt-10 scroll-mt-4" id={id}>
      <h2 className="text-lg font-semibold mb-3">{title}</h2>
      {children}
    </section>
  );
}

function Readiness({ g }: { g: Guide }) {
  const withKey = g.prerequisites.filter((p) => p.profileKey && profileHas(p.profileKey) !== undefined);
  const missing = withKey.filter((p) => !profileHas(p.profileKey!));
  const rest = g.prerequisites.length - withKey.length;
  return (
    <div className="panel p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <div className="font-semibold">What you need before you start</div>
          <div className="text-xs text-muted mt-0.5">
            Example check against {profile.companyName}&apos;s profile: {withKey.length - missing.length} of {withKey.length} checkable items in place
            {rest > 0 && <>, {rest} more to confirm yourself</>}. Your agent checks yours when you pass your own profile.
          </div>
        </div>
        <Link href="/profile" className="text-xs link">See the example profile</Link>
      </div>
      <ul className="mt-3 space-y-2 text-sm">
        {g.prerequisites.map((p, i) => (
          <li key={i} className="flex flex-wrap items-center gap-2">
            <span className={`ev ${p.requiredFor === "launch" ? "" : "ev-sourced"}`}>for {p.requiredFor}</span>
            <span className="flex-1 min-w-[12rem]">{p.item}</span>
            <Have k={p.profileKey} />
            <EvidenceTag e={p.evidence} guide={g} />
          </li>
        ))}
      </ul>
    </div>
  );
}

export default async function GuidePage({ params }: PageProps<"/guides/[slug]">) {
  await connection();
  const { slug } = await params;
  const g = await getGuide(slug);
  if (!g) notFound();
  const v = g.verdict;

  return (
    <article className="wrap py-10">
      <Link href="/#library" className="text-sm link no-print">← All guides</Link>
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted mt-3">
        <span>{g.category}</span>·<a href={g.website} className="link">{g.website.replace(/^https?:\/\//, "")}</a>·
        <span>{g.meta.generatedBy === "live-agent" ? "generated live by the agent" : "researched guide"}, {g.meta.generatedAt}</span>
        <span className="ml-auto no-print"><PrintButton /></span>
      </div>
      <h1 className="text-3xl font-semibold tracking-tight mt-2">{g.app}</h1>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-px mt-4 panel overflow-hidden bg-line">
        {[
          ["Difficulty", <Difficulty key="d" value={v.difficulty} />],
          ["First token", v.timeToFirstToken],
          ["Real users", v.timeToLaunch],
          ["Cost", v.cost],
        ].map(([label, value], i) => (
          <div key={i} className="bg-panel p-3">
            <div className="label">{label}</div>
            <div className="mt-1 text-lg font-semibold">{value}</div>
          </div>
        ))}
      </div>
      <p className="mt-4 text-[17px] max-w-3xl">{g.summary}</p>
      <div className="mt-3 text-sm text-muted space-y-1 max-w-3xl">
        <p><b className="text-ink">Review:</b> {v.reviewRequired}</p>
      </div>
      {(v.launchNote || v.costNote) && (
        <div className="mt-1 text-sm text-muted space-y-1 max-w-3xl">
          {v.launchNote && <p><b className="text-ink">Timing:</b> {v.launchNote}</p>}
          {v.costNote && <p><b className="text-ink">Cost:</b> {v.costNote}</p>}
        </div>
      )}
      <div className="mt-2 text-xs text-muted flex items-center gap-2">Verdict evidence <EvidenceTag e={v.evidence} guide={g} /></div>

      <nav aria-label="On this page" className="mt-6 flex flex-wrap gap-x-4 gap-y-1 text-sm no-print">
        {[
          ["#agent", "Set up with your agent"],
          ["#before", "Before you start"],
          ["#steps", "Steps"],
          ["#scopes", "Scopes"],
          ["#blockers", "Blockers"],
          ["#verification", "What we checked"],
          ["#sources", "Sources"],
        ].map(([href, label]) => (
          <a key={href} href={href} className="link">{label}</a>
        ))}
      </nav>

      <div className="mt-6">
        <AgentPanel installs={INSTALLS} prompt={agentPrompt(g.slug, g.app)} title={`Set up ${g.app} with your coding agent`} />
      </div>

      {g.slug === "github" && (
        <div className="mt-6 panel p-4 no-print flex flex-wrap items-center gap-3 justify-between">
          <div className="text-sm">
            <b>Agent setup available.</b> A Playwright agent fills GitHub&apos;s registration form from the developer profile and hands the browser to you for login and the final click.
          </div>
          <Link href="/method#automation" className="btn">How the setup agent works</Link>
        </div>
      )}

      <Section title="Before you start" id="before">
        <Readiness g={g} />
        <div className="panel p-4 mt-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">Test mode:</span>
            {g.testMode.available ? "available" : "not available"}
            <EvidenceTag e={g.testMode.evidence} guide={g} />
          </div>
          <p className="mt-1 text-muted">{g.testMode.limits}</p>
        </div>
      </Section>

      <Section title="Who does what">
        <div className="grid md:grid-cols-2 gap-3">
          <div className="panel p-4">
            <div className="flex items-center gap-2"><WhoTag who="agent" /><span className="text-sm text-muted">can do for you</span></div>
            <ul className="mt-3 list-disc pl-5 text-sm space-y-1">{g.agentHandoff.agentCan.map((x, i) => <li key={i}>{x}</li>)}</ul>
          </div>
          <div className="panel p-4">
            <div className="flex items-center gap-2"><WhoTag who="you" /><span className="text-sm text-muted">must take over</span></div>
            <ul className="mt-3 list-disc pl-5 text-sm space-y-1">{g.agentHandoff.youMust.map((x, i) => <li key={i}>{x}</li>)}</ul>
          </div>
        </div>
      </Section>

      <Section title="Steps" id="steps">
        <div className="space-y-6">
          {PHASES.map((ph) => {
            const steps = g.steps.filter((s) => s.phase === ph.key);
            if (!steps.length) return null;
            return (
              <div key={ph.key}>
                <div className="flex items-baseline gap-2 mb-2">
                  <span className="font-semibold">{ph.title}</span>
                  <span className="text-xs text-muted">{ph.hint}</span>
                </div>
                <ol className="space-y-2">
                  {steps.map((s) => (
                    <li key={g.steps.indexOf(s)} className="panel p-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="mono text-xs text-muted">{g.steps.indexOf(s) + 1}</span>
                        <span className="font-semibold">{s.title}</span>
                        <WhoTag who={s.who} />
                        <span className="text-xs text-muted">{s.estimate}</span>
                        <span className="ml-auto"><EvidenceTag e={s.evidence} guide={g} /></span>
                      </div>
                      <p className="mt-2 text-sm whitespace-pre-line">{s.detail}</p>
                      {s.url && <a href={s.url} className="link text-sm mt-1 inline-block break-all">{s.url}</a>}
                      {s.fields && s.fields.length > 0 && (
                        <table className="mt-3 w-full text-sm">
                          <tbody>
                            {s.fields.map((f, i) => (
                              <tr key={i} className="border-t border-line align-top">
                                <td className="py-1.5 pr-3 font-medium w-1/3">{f.label}</td>
                                <td className="py-1.5">
                                  {f.profileKey && profileHas(f.profileKey) ? (
                                    <span className="mono text-xs break-all">{profileDisplay(f.profileKey)}</span>
                                  ) : f.profileKey && profileHas(f.profileKey) === false ? (
                                    <span className="ev ev-inferred">missing: {f.profileKey}</span>
                                  ) : null}
                                  {f.note && <span className="text-muted text-xs block">{f.note}</span>}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </li>
                  ))}
                </ol>
              </div>
            );
          })}
        </div>
      </Section>

      <Section title="Scopes an agent typically needs" id="scopes">
        <div className="panel overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="label text-left"><th className="p-3">Scope</th><th className="p-3">Used for</th><th className="p-3">Review tier</th><th className="p-3">Evidence</th></tr></thead>
            <tbody>
              {g.scopes.map((s, i) => (
                <tr key={i} className="border-t border-line align-top">
                  <td className="p-3 mono text-xs break-all">{s.name}</td>
                  <td className="p-3">{s.purpose}{s.note && <div className="text-xs text-muted mt-1">{s.note}</div>}</td>
                  <td className="p-3"><span className={`pill ${s.tier === "basic" ? "d-easy" : s.tier === "sensitive" ? "d-moderate" : s.tier === "restricted" ? "d-hard" : "d-gated"}`}>{s.tier}</span></td>
                  <td className="p-3"><EvidenceTag e={s.evidence} guide={g} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="What can slow you down or block approval" id="blockers">
        <div className="space-y-2">
          {g.blockers.map((b, i) => (
            <div key={i} className="panel p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`pill ${b.severity === "can-block-launch" ? "d-hard" : b.severity === "slows-you-down" ? "d-moderate" : "d-easy"}`}>{b.severity.replace(/-/g, " ")}</span>
                <span className="font-semibold">{b.title}</span>
                <span className="ml-auto"><EvidenceTag e={b.evidence} guide={g} /></span>
              </div>
              <p className="text-sm mt-2">{b.detail}</p>
              {b.workaround && <p className="text-sm mt-1 text-muted"><b>Workaround:</b> {b.workaround}</p>}
            </div>
          ))}
        </div>
      </Section>

      <Section title="What we checked" id="verification">
        <div className="panel overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="label text-left"><th className="p-3">Claim</th><th className="p-3">How</th><th className="p-3">Result</th></tr></thead>
            <tbody>
              {g.meta.verification.map((c, i) => (
                <tr key={i} className="border-t border-line align-top">
                  <td className="p-3">{c.claim}{c.note && <div className="text-xs text-muted mt-1">{c.note}</div>}</td>
                  <td className="p-3 text-muted">{c.method}</td>
                  <td className="p-3"><span className={`ev ${c.result === "confirmed" ? "ev-tested" : c.result === "corrected" ? "ev-sourced" : "ev-inferred"}`}>{c.result}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {g.uncertainties.length > 0 && (
          <div className="panel p-4 mt-3">
            <div className="label mb-2">Still uncertain</div>
            <ul className="list-disc pl-5 text-sm space-y-1">{g.uncertainties.map((u, i) => <li key={i}>{u}</li>)}</ul>
          </div>
        )}
      </Section>

      <Section title="Sources" id="sources">
        <ol className="space-y-2 text-sm">
          {g.sources.map((s) => (
            <li key={s.id} id={`src-${s.id}`} className="flex gap-2 scroll-mt-20">
              <span className="ev shrink-0">{s.id}</span>
              <div className="min-w-0">
                <a href={s.url} className="link break-all">{s.title}</a>
                <span className="text-xs text-muted"> · {s.kind} · accessed {s.accessed}</span>
                {s.quote && <blockquote className="text-xs text-muted border-l-2 border-line pl-2 mt-1">“{s.quote}”</blockquote>}
              </div>
            </li>
          ))}
        </ol>
      </Section>

      <div className="mt-10 text-xs text-muted no-print">
        Something wrong or outdated? <Link className="link" href={`/generate?q=${encodeURIComponent(g.app)}&force=1`}>Re-run the agent for {g.app}</Link>
      </div>
    </article>
  );
}
