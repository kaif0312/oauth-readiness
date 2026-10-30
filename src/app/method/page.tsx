import Link from "next/link";
import { seedGuides } from "@/lib/store";

export const metadata = { title: "Evidence and method" };

export default function MethodPage() {
  const guides = seedGuides();
  const checks = guides.flatMap((g) => g.meta.verification.map((c) => ({ ...c, app: g.app, slug: g.slug })));
  const count = (r: string) => checks.filter((c) => c.result === r).length;
  const claims = guides.flatMap((g) => [g.verdict.evidence, g.testMode.evidence, ...g.steps.map((s) => s.evidence), ...g.scopes.map((s) => s.evidence), ...g.blockers.map((b) => b.evidence), ...g.prerequisites.map((p) => p.evidence)]);
  const by = (s: string) => claims.filter((e) => e.status === s).length;

  return (
    <div className="wrap py-10 max-w-3xl">
      <h1 className="text-2xl font-semibold">Evidence and method</h1>

      <section className="mt-6 text-sm space-y-3">
        <p>
          <b>What a guide is for.</b> An agent that acts for users in another app needs a provider OAuth app: a registered client (id, secret,
          redirect URIs, consent screen) that the provider trusts. Creating it is usually quick; getting it approved for users outside your own account is
          where the weeks go. Managed-OAuth platforms hide this by sharing one pre-approved app, but they don&apos;t cover every provider, and anyone
          who needs their own brand on the consent screen, their own rate limits or their own scopes ends up registering their own app.
        </p>
        <p>
          <b>How each claim is marked.</b> <span className="ev ev-tested">tested</span> = we did it: set it up in a real console, or the agent probed
          the provider&apos;s live OAuth endpoints. <span className="ev ev-sourced">sourced</span> = an official page says so, quoted in the sources
          list. <span className="ev ev-inferred">inferred</span> = third-party reports or reasoning; treat as uncertain. Review wait times are almost
          never documented, so they are usually inferred.
        </p>
      </section>

      <div className="grid grid-cols-3 gap-px panel overflow-hidden bg-line mt-6">
        {[["tested", by("tested")], ["sourced", by("sourced")], ["inferred", by("inferred")]].map(([k, n]) => (
          <div key={k} className="bg-panel p-3"><div className="label">{k} claims</div><div className="text-2xl font-semibold mt-1">{n}</div></div>
        ))}
      </div>

      <h2 className="text-lg font-semibold mt-10">Spot checks across the library</h2>
      <p className="text-sm text-muted mt-1">{checks.length} checks: {count("confirmed")} confirmed, {count("corrected")} corrected, {count("unverified")} could not be verified.</p>
      <div className="panel overflow-x-auto mt-3">
        <table className="w-full text-sm">
          <thead><tr className="label text-left"><th className="p-3">App</th><th className="p-3">Claim</th><th className="p-3">Result</th></tr></thead>
          <tbody>
            {checks.sort((a, b) => (a.result === "corrected" ? -1 : 0) - (b.result === "corrected" ? -1 : 0)).map((c, i) => (
              <tr key={i} className="border-t border-line align-top">
                <td className="p-3"><Link className="link" href={`/guides/${c.slug}#verification`}>{c.app}</Link></td>
                <td className="p-3">{c.claim}<div className="text-xs text-muted mt-1">{c.method}{c.note ? ` · ${c.note}` : ""}</div></td>
                <td className="p-3"><span className={`ev ${c.result === "confirmed" ? "ev-tested" : c.result === "corrected" ? "ev-sourced" : "ev-inferred"}`}>{c.result}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="text-lg font-semibold mt-10" id="automation">The setup agent</h2>
      <div className="text-sm space-y-3 mt-2">
        <p>
          Guides say what an agent can do; for GitHub the repo includes one that does it. <span className="mono">scripts/setup-github.ts</span> opens a
          real browser on GitHub&apos;s &quot;Register a new GitHub App&quot; page, fills every field from the developer profile, and stops at the two
          places a human must act: signing in (password, 2FA) and the final <i>Create</i> click. It then reads back the client id and tells you where to
          generate the secret. It never sees your password and stores nothing.
        </p>
      </div>
    </div>
  );
}
