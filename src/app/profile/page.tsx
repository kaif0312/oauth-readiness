import Link from "next/link";
import { profile, profileHas } from "@/lib/profile";
import { seedGuides } from "@/lib/store";

export const metadata = { title: "Developer profile" };

const LABELS: Record<string, string> = {
  companyName: "Company", legalEntity: "Legal entity name", appName: "App name", appDescription: "App description",
  homepageUrl: "Homepage", privacyPolicyUrl: "Privacy policy", termsUrl: "Terms of service", dataDeletionUrl: "Data deletion page",
  supportUrl: "Support page", supportEmail: "Support email", sharedSupportMailbox: "Shared support mailbox (group)",
  developerContactEmail: "Developer contact", appDomain: "App domain", authorizedDomains: "Authorized domains",
  domainVerified: "Domain verification", redirectUris: "Redirect URIs", logo: "Logo", demoVideoUrl: "Demo video",
  businessVerification: "Business verification", country: "Country", usersAre: "Who the users are", securityPosture: "Security posture",
};

function show(v: unknown): string {
  if (v === null) return "";
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v.join(", ");
  return Object.entries(v as object).map(([k, x]) => `${k}: ${x ?? "none"}`).join(" · ");
}

export default function ProfilePage() {
  const guides = seedGuides();
  const keys = Object.keys(LABELS);
  return (
    <div className="wrap py-10 max-w-3xl">
      <h1 className="text-2xl font-semibold">Developer profile: {profile.companyName}</h1>
      <p className="text-muted mt-2 text-sm">
        Registration and review forms ask for the same things again and again. The guides check each provider&apos;s requirements against this profile, and
        the setup agent fills forms from it. It holds public facts only: secrets, logins and legal acceptance stay with you. Source:{" "}
        <span className="mono">src/data/profile/iskaria.json</span>.
      </p>
      <div className="panel mt-6 overflow-hidden">
        {keys.map((k) => {
          const has = profileHas(k);
          const needed = guides.filter((g) => g.prerequisites.some((p) => p.profileKey === k) || g.steps.some((s) => s.fields?.some((f) => f.profileKey === k)));
          return (
            <div key={k} className="grid grid-cols-12 gap-3 px-4 py-3 border-t border-line first:border-t-0 text-sm">
              <div className="col-span-12 sm:col-span-4 font-medium">
                {LABELS[k]} {has === false && <span className="ev ev-inferred ml-1">missing</span>}
              </div>
              <div className="col-span-12 sm:col-span-8 min-w-0">
                <div className="break-words">{show((profile as Record<string, unknown>)[k]) || <span className="text-muted">not set</span>}</div>
                {needed.length > 0 && (
                  <div className="text-xs text-muted mt-1">
                    asked by {needed.map((g, i) => (
                      <span key={g.slug}>{i > 0 && ", "}<Link className="link" href={`/guides/${g.slug}`}>{g.app}</Link></span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <h2 className="text-lg font-semibold mt-8">Use cases</h2>
      <ul className="mt-2 text-sm space-y-1">
        {Object.entries(profile.useCases).map(([k, v]) => <li key={k}><span className="mono text-xs">{k}</span>: {v}</li>)}
      </ul>
    </div>
  );
}
