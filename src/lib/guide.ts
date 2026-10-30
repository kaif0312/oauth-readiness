import { z } from "zod";

// One schema is shared by the seeded library, the live research agent and the UI.
// Every factual claim carries `evidence`: what supports it and how strongly.

export const Evidence = z.object({
  status: z
    .enum(["tested", "sourced", "inferred"])
    .describe(
      "tested = we did it ourselves (setup attempt, real console); sourced = an official doc or provider page says so (cite it); inferred = reasoning or third-party reports only, treat as uncertain",
    ),
  sourceIds: z.array(z.string()).describe("ids from the guide's sources[]"),
  note: z.string().optional().describe("what exactly was tested or what is unclear"),
});

export const Source = z.object({
  id: z.string().describe("short id, e.g. s1"),
  title: z.string(),
  url: z.string(),
  kind: z.enum(["official-docs", "provider-policy", "provider-console", "community", "our-test"]),
  quote: z.string().optional().describe("short verbatim quote that supports the claim"),
  accessed: z.string().describe("YYYY-MM-DD"),
});

export const Who = z
  .enum(["agent", "you", "agent-then-you"])
  .describe("agent = an agent can do it unattended; you = a human must (login, legal, payment, judgement); agent-then-you = agent prepares/fills, human reviews and submits");

export const Step = z.object({
  title: z.string(),
  who: Who,
  phase: z.enum(["build", "test", "launch"]).describe("build = create the app and credentials; test = works for you and test users; launch = review/approval for real users"),
  detail: z.string().describe("concrete instructions: where to click, what to enter"),
  url: z.string().optional().describe("deep link to the console page, if known"),
  estimate: z.string().describe("hands-on time, e.g. '5 min'"),
  // Form fields the step asks for, mapped to the developer profile when possible.
  fields: z
    .array(
      z.object({
        label: z.string().describe("field label as the provider names it"),
        profileKey: z.string().optional().describe("key in the developer profile that answers it, e.g. privacyPolicyUrl"),
        note: z.string().optional(),
      }),
    )
    .optional(),
  evidence: Evidence,
});

export const Scope = z.object({
  name: z.string().describe("scope/permission string as the provider names it"),
  purpose: z.string().describe("what the developer's agent would use it for"),
  tier: z.enum(["basic", "sensitive", "restricted", "partner-only", "paid"]).describe("how much review it triggers"),
  note: z.string().optional(),
  evidence: Evidence,
});

export const Blocker = z.object({
  title: z.string(),
  detail: z.string(),
  severity: z.enum(["info", "slows-you-down", "can-block-launch"]),
  workaround: z.string().optional(),
  evidence: Evidence,
});

export const Guide = z.object({
  slug: z.string(),
  app: z.string().describe("provider/app name, e.g. Google (Gmail API)"),
  website: z.string(),
  category: z.string().describe("e.g. Email, CRM, Chat, Dev tools"),
  summary: z.string().describe("2-3 sentences a developer can forward: how hard, how long, main catch"),
  verdict: z.object({
    difficulty: z.enum(["easy", "moderate", "hard", "gated"]).describe("gated = needs a partnership, paid tier or invitation before you can launch"),
    timeToFirstToken: z.string().describe("SHORT (max ~20 chars): hands-on time until your own account can connect, e.g. '15 min'"),
    timeToLaunch: z.string().describe("SHORT (max ~20 chars): realistic calendar time until arbitrary users can connect, including review waits, e.g. '3-6 weeks'"),
    launchNote: z.string().optional().describe("one sentence on what the launch range depends on (scope choice, paths, resubmissions)"),
    reviewRequired: z.string().describe("one short sentence: what review/approval stands between test and launch, or 'none'"),
    cost: z.string().describe("SHORT (max ~30 chars), e.g. 'free', 'USD 540+/yr (CASA)'"),
    costNote: z.string().optional().describe("detail behind the cost, if any"),
    evidence: Evidence,
  }),
  // What you can do before review, and the limits of that state.
  testMode: z.object({
    available: z.boolean(),
    limits: z.string().describe("e.g. '100 test users, refresh tokens expire after 7 days'"),
    evidence: Evidence,
  }),
  prerequisites: z
    .array(
      z.object({
        item: z.string(),
        profileKey: z.string().optional().describe("developer-profile key that satisfies it"),
        requiredFor: z.enum(["build", "launch"]),
        evidence: Evidence,
      }),
    )
    .describe("accounts, URLs, assets and verifications the provider requires"),
  steps: z.array(Step),
  scopes: z.array(Scope).describe("the scopes a typical agent integration needs, with review tier"),
  blockers: z.array(Blocker).describe("nuances that can delay or block approval"),
  agentHandoff: z.object({
    agentCan: z.array(z.string()),
    youMust: z.array(z.string()),
  }),
  uncertainties: z.array(z.string()).describe("what we could not verify; be specific"),
  sources: z.array(Source),
  meta: z.object({
    generatedBy: z.enum(["seed-research", "live-agent"]),
    generatedAt: z.string(),
    verification: z
      .array(
        z.object({
          claim: z.string(),
          method: z.string().describe("how it was checked: fetched doc X, created app in console, ..."),
          result: z.enum(["confirmed", "corrected", "unverified"]),
          note: z.string().optional(),
        }),
      )
      .describe("spot checks of this guide's claims"),
  }),
});

export type Guide = z.infer<typeof Guide>;
export type Evidence = z.infer<typeof Evidence>;
export type Step = z.infer<typeof Step>;
