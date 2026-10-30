# OAuth Readiness

Guides that tell a developer building an AI agent **how long it really takes to get an OAuth app approved** with a provider, what it
requires, what can block it, and which steps an agent can do for them. A library of researched guides, plus a live agent that researches any
other app on request and publishes a shareable guide.

## The problem, as I understood it

An agent that acts in a user's Gmail, Slack or HubSpot needs a **provider OAuth app**: a client registered with the provider (client id
and secret, redirect URIs, consent screen, scopes). The developer registers it once; each end user then "connects" by consenting to that
app. Managed-OAuth platforms lend you their pre-approved app, but they don't cover every provider, and teams that want their own brand on
the consent screen, their own rate limits or extra scopes have to register their own.

Registering is quick. The hard part is the **gap between "works for my account" and "works for any user"**: Google's verification
and its paid CASA assessment, Meta's App Review and Business Verification, Microsoft's publisher verification and admin consent, LinkedIn's
partner gate, Slack's Marketplace rate limits. That gap is undocumented, spread over many pages, and it changes. So every guide leads with
two numbers: **first token** (hands-on time to your own working connection) and **real users** (calendar time including review).

## What's here

- **Library**: 8 guides chosen to cover the range of setup difficulty: GitHub (easy, no review), Slack and HubSpot (easy to start, review
  only to lift a cap), Microsoft Graph (publisher verification plus per-tenant admin consent), Google Search Console/GA4 and Gmail
  (sensitive vs restricted scopes, CASA), Meta (App Review, Business Verification, Tech Provider), and LinkedIn (gated: partner approval).
- **Live generation** (`/generate?q=<app>`): a Claude agent researches any app in 2-4 minutes, and you watch every search, fetch and probe as it
  happens. It writes a guide in the same schema at a shareable URL.
- **Evidence on every claim**: `tested` (we did it), `sourced` (an official page says so, quoted), `inferred` (third-party or reasoning).
  Every guide has a "What we checked" table, open uncertainties, and numbered sources. `/method` aggregates them.
- **Developer profile** (`src/data/profile/iskaria.json`, `/profile`): the facts registration forms keep asking for (privacy URL, domain,
  logo, support mailbox, demo video, business verification). Guides check each provider's requirements against it and flag what's
  missing: "Google needs a Limited Use section in your privacy policy; Iskaria's has none." The profile is my own company, Iskaria, a
  clinic-operations console with an AI assistant. Using a real company means the gaps are real, and we have actually set up Google and Meta
  for it.
- **Setup agent** (`scripts/setup-github.ts`): registers a real GitHub App from the profile via GitHub's App Manifest flow. The agent does
  everything except sign-in and the final "Create" click. At each handoff it notifies you (terminal bell, phone push via ntfy, or any chat
  webhook), then receives the credentials and saves them to `.secrets/`.

## How the live agent works (`src/lib/agent.ts`)

1. **Research**: Claude Opus 5.5 with the server-side `web_search` and `web_fetch` tools, plus a custom `probe_oauth` tool that runs on our
   server (`src/lib/probe.ts`). The probe fetches the provider's `/.well-known/oauth-authorization-server` and `openid-configuration`
   (PKCE support, **dynamic client registration**) and calls the authorize endpoint with a fake client id to see how it rejects it. That is a
   real, credential-free test, and the only thing the agent can mark `tested`. The agent re-checks its 2-4 most decision-relevant claims against a
   second page and writes a dossier.
2. **Compose**: a second call with structured outputs constrained to the zod `Guide` schema (`src/lib/guide.ts`). It only uses facts and URLs
   from the dossier; dangling source ids are dropped.
3. **Save**: Upstash Redis in production, `.data/` locally. Seeded guides live in the repo.

The seeded guides were written the same way, by parallel research agents following `docs/research-brief.md`, then checked by a separate
verifier agent that was given the guides but not my conclusions.

## Key decisions

- **Guides first, automation second.** Every provider console sits behind a login, often 2FA or CAPTCHA, and some terms forbid automation.
  An agent can always research and draft; it can only sometimes click. So automation is real for GitHub (where the manifest flow makes it
  clean and allowed), and every other guide splits steps into **Agent**, **Agent drafts, you submit**, and **You**.
- **Two timelines, not one difficulty score.** "Hard" means nothing to a developer planning a launch. "30 min to first token, 4-10 weeks to
  real users, unless you only request gmail.send" is something they can plan around.
- **Personalised to a profile.** The most common approval blockers are missing assets (policy sections, demo video, verified domain,
  business verification), not code. Checking them against a profile turns generic docs into a to-do list.
- **Evidence labels instead of confidence scores.** Review wait times are almost never documented officially. Saying so beats
  inventing a precise number.
- **The probe as the agent's own setup attempt.** It can't create apps without credentials, but it can verify endpoints, PKCE and dynamic
  client registration live. That surfaced one thing documentation-reading misses: some providers' MCP servers (e.g. `mcp.notion.com`)
  support dynamic client registration, so an agent there may not need a registered app at all.

## What I tested, sourced, or could not verify

- **Tested ourselves (Iskaria, Oct 2026):**
  - **Google:** a Testing-mode consent screen with our own client. Refresh tokens expired after 7 days. gcloud's built-in client is blocked for Analytics/Search Console scopes. The Business Profile API needed its own access request.
  - **Meta:** the live app holds messaging scopes but lacks publishing scopes, and publish calls fail with Graph error codes 10/200-299 until Advanced Access is granted. Embedded Signup won't run on localhost.
- **Endpoint probes:** discovery and authorize behaviour for Google, Microsoft, GitHub, Slack, LinkedIn and Notion (see each guide's sources).
- **Corrected during research** (each guide's "What we checked"; summary at `/method`). Examples:
  - **Microsoft:** the 2025 managed consent policy blocks ordinary users from consenting to Mail.Read.
  - **HubSpot:** new legacy public apps can no longer be created (June 2026).
  - **Slack:** commercially distributed apps that aren't on the Marketplace get `conversations.history` at 1 request/min.
  - **LinkedIn:** the Community Management API needs its own app with no other products.
  - **Google:** Gmail `metadata`/`compose` scopes are restricted, not sensitive.
- **Independent verification pass:** a separate agent re-checked 23 high-stakes claims against primary sources: 17 confirmed,
  4 corrected, 2 unverified.
  - **GitHub:** repo-admin installs are also blocked by the Repository administration permission, and org owners can switch them off.
  - **Google:** brand verification is usually minutes when the automated check passes; 2-3 business days only on manual review.
  - **LinkedIn:** every app approved for the Marketing Developer Platform gets 365-day refresh tokens, not just partners.
- **Not verified:**
  - Real review wait times. These are community reports, labelled `inferred`.
  - Google CASA prices. Taken from assessor price lists, which change.
  - Whether Slack's 2026 throttling applies to existing installs.

## Run it

```sh
npm install
cp .env.example .env.local      # add ANTHROPIC_API_KEY (and Upstash vars for production)
npm run dev                     # http://localhost:3000
node scripts/validate.ts        # check all guides against the schema
node scripts/probe.ts accounts.google.com --authorize https://accounts.google.com/o/oauth2/v2/auth
node scripts/setup-github.ts --dry-run   # print the GitHub App manifest built from the profile
node scripts/setup-github.ts             # real run: opens Chrome, you sign in and click Create
```

Deploy: Vercel (Next.js preset). Set `ANTHROPIC_API_KEY`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, optionally
`DAILY_GENERATION_LIMIT` (default 40 live runs/day). The generate route needs up to 300 s (`maxDuration`).

## Limitations

- 8 guides, not 100. The schema, research brief and live agent are the scale path; the remaining 92 would be a batch run plus a human review queue.
- Live guides are unreviewed agent output, marked as such. A live run costs roughly USD 0.50-1.50 in API usage and takes 2-4 minutes.
- Guides go stale. Each records its access date; there is no automatic re-check yet (a scheduled re-run diffing verdicts would be next).
- The setup agent covers GitHub only. Other providers' consoles would need per-provider scripts and a human at every login.
- One developer profile (Iskaria). Making it editable per visitor is a small step that wasn't needed for the demo.
