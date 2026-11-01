<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# OAuth Readiness: handoff for the next agent

Last updated 2026-10-30. Read this, then `README.md` (product story, decisions, evidence) before changing anything.

## What this is

A take-home project that became a real tool: guides that tell a developer building an AI agent how long a provider OAuth
app takes to get approved, what it needs, what can block it, and which steps an agent can do. Three ways in:

- **Website** `https://oauth-readiness-five.vercel.app` (Vercel project `oauth-readiness`; NOT `oauth-readiness.vercel.app`,
  that is someone else's). Library of 8 researched guides + live generation (`/generate?q=<app>`).
- **MCP server** `/api/mcp` (Streamable HTTP, no auth, `mcp-handler` 2.x + `@modelcontextprotocol/server` 2.x). Tools:
  `list_guides`, `get_guide`, `get_setup_plan` (guide -> browser-agent instructions, fields resolved against a profile,
  STOP points, rules), `get_profile`, `research_app` (runs the live agent). Add to Claude Code:
  `claude mcp add --transport http oauth-readiness https://oauth-readiness-five.vercel.app/api/mcp`.
- **Setup agents**: `scripts/setup-github.ts` (GitHub App Manifest flow, Playwright; only dry-run tested, the live run timed
  out waiting for sign-in) and the proven path: Claude Code + this MCP + Claude in Chrome in the owner's signed-in browser
  (done for Google on 2026-10-30, see below).

Repo `github.com/kaif0312/oauth-readiness`, branch `main`. **A push to `main` deploys production** (Vercel Git integration).
Deliverables: the live link, this repo and README.

## Code map

| Path | What |
|---|---|
| `src/lib/guide.ts` | zod `Guide` schema shared by seeds, live agent, UI and MCP. Every claim has `evidence` tested/sourced/inferred |
| `src/data/guides/*.json` | 8 seed guides (github, google-gmail, google-search-analytics, hubspot, linkedin, meta, microsoft-graph, slack). `node scripts/validate.ts` checks schema + source ids |
| `src/data/profile/iskaria.json` | developer profile (Iskaria, public facts only). `{provider}` in values is filled per guide |
| `src/lib/agent.ts` | live agent: research (Opus 5.5, web_search/web_fetch server tools + local `probe_oauth`, 140 s budget, forced wrap-up) then compose (streamed JSON, zod-validated, one repair round) |
| `src/lib/probe.ts` | credential-free endpoint probe: RFC 8414 / OIDC discovery, PKCE, dynamic client registration, authorize error shape |
| `src/lib/plan.ts` | `buildPlan()`: guide -> setup plan for a browser agent; `BROWSER_RULES` (never type secrets, stop at STOP steps, reload and read back after every save) |
| `src/lib/r2.ts` | R2 client: S3 API with SigV4 via node:crypto, no SDK (`r2Get` null on 404, `r2Put`, `r2List` first 1000 keys) |
| `src/lib/store.ts` | seeds from disk; live guides in R2 (`guides/<slug>.json`), `.data/guides` locally; `takeGenerationSlot` daily cap (`DAILY_GENERATION_LIMIT`, default 40) |
| `src/app/api/generate/route.ts` | SSE stream of agent events, `maxDuration` 300 |
| `src/app/api/mcp/route.ts` | MCP server. Tool descriptions steer the agent: list_guides -> get_profile {template:true} -> get_setup_plan {slug, profile}. Slugs are normalised + aliased (`normalizeSlug` in `store.ts`: gmail, outlook, Slack...). A browser GET returns the install page (`installHtml`) instead of a 405 |
| `src/lib/install.ts` | ONE source for the per-client install snippets (Claude Code, Cursor + deeplink, VS Code + deeplink, Codex, Windsurf), the copy-paste agent prompt, `/llms.txt` and the `/api/mcp` HTML page. Change the MCP URL here only |
| `src/lib/profile.ts` | `PROFILE_FIELDS` (keys a stranger fills; `required`, `list`), `profileTemplate()`, `parseProfile()` (object or JSON string). With a custom profile an absent key counts as missing |
| `src/components/agent-panel.tsx` | "Set it up with your coding agent" panel (home `#agent`, every guide page): client tabs, copy buttons, prompt |
| `scripts/` | `validate.ts`, `probe.ts`, `setup-github.ts`, `push-live.ts` (push a local `.data` guide to R2, reads it back). Run with `node` (type stripping) |

Env (`.env.example`): `ANTHROPIC_API_KEY` (Vercel has it, unquoted; `.env.local` has it quoted, the code strips quotes),
`R2_ENDPOINT` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_BUCKET`, `DAILY_GENERATION_LIMIT`, `NTFY_TOPIC` / `NOTIFY_WEBHOOK` (setup-agent handoff pings).
Secrets never in git: `.secrets/`, `.auth/`, `.data/`, `.env*` are git-ignored AND in `.vercelignore` (a locked Chrome profile
in `.auth/` once made every CLI deploy fail silently with EBUSY).

## State and open problems (in priority order)

1. **Live guides moved to Cloudflare R2 (2026-10-30).** Vercel Blob (Hobby) blocked the store over quota (every read 403),
   so live guides now go to the PRIVATE R2 bucket `oauth-readiness-guides`, with an API token limited to Object Read & Write
   on that bucket. Env `R2_*` set in Vercel Production + Preview and `.env.local`. calendly and xero were re-pushed from
   `.data/guides`; **notion and zoom were lost** with the Blob store: regenerate them. Account details: `AGENTS.local.md`
   (git-ignored, owner's machine only).
2. **Live guides are neutral (2026-11-01).** The live agent no longer sees the Iskaria profile: it writes for any developer,
   and `ownerLeaks()` (`guide.ts`, shared with `validate.ts`) sends Iskaria/clinic wording back for one rewrite round.
   xero was regenerated with it (no leaks, 5/50 connection tiers consistent). calendly predates the fix: regenerate it.
   Local `next dev` with `.env.local` writes to the production R2 bucket.
3. 8 guides, not 100. The scale path: batch `research_app` runs + a human review queue; seeds were researched by parallel
   agents following `docs/research-brief.md`, then checked by a separate verifier.
4. Save the Google console flow to the browser-flows library (`~/.claude/scripts/browser-flows/`, see the `browser-fast`
   skill) so the next Google setup is a replay. Steps and selectors are in "Google end to end" below.
5. Usability pass 2026-10-30 (branch `agent-ux`): two review agents (Krug/Norman audit of the site; an AI-developer walk through
   the MCP). Done: agent panel + nav link, library before Generate, clickable rows with mobile labels, jump nav, readiness
   relabelled as Iskaria's example, live-run stepper + retry, re-run confirmation, `/llms.txt`, stranger profiles in
   get_setup_plan (missing keys, arrays, env names, verify), guides neutralised (`validate.ts` fails on Iskaria/clinic outside
   sources/meta/evidence notes). Not done: `research_app` is still synchronous with no progress notifications (clients with a
   ~60 s tool timeout give up; an async job + `get_research_status` is the fix) and unauthenticated (shared daily cap);
   evidence chips still use `title` tooltips (invisible on touch).

## Google end to end (the proof case, 2026-10-30)

Claude Code fetched `get_setup_plan("google-search-analytics")` from production MCP and filled Google Auth Platform for
Iskaria's Google Cloud project in the owner's signed-in Chrome (Claude in Chrome). Then "Connect Google" in the Iskaria console
read live Business Profile, Search Console and GA4 data. Project and browser-profile details: `AGENTS.local.md`.

Lessons (all in the Google guide and `plan.ts` already):
- `business.manage` and `webmasters.readonly` are non-sensitive; only `analytics.readonly` needs verification.
- User support email = the signed-in account or a Google Group it manages.
- New client option "Use this client for an AI-powered agent"; Google wants separate clients for agent and normal flows.
- Unsaved console forms vanish on navigation; one "saved" Branding page kept only the domain. Reload and read back.
- The logo upload input is hidden: a browser agent has to set the file input from script.
- Brand verification is automatic (passed in about 2 minutes), then "Publish branding".
- The extension may not act on accounts.google.com: sign-in and consent are always the human's.

## How to work here

- `npm run dev` (port 3000; the old session used 3100), `npx tsc --noEmit`, `npx eslint`, `node scripts/validate.ts`,
  `npx next build` before pushing. Next.js 16: `await connection()` instead of `dynamic`, `PageProps` with Promise params.
- Machine: Windows, `py` not `python`, no `jq`, built-in WebSearch does not work (use the deepseek-web MCP).
- Never print or commit keys. Profile data stays public facts only (no Iskaria project numbers, client ids, third-party emails).
- Update this file as you go: delete what stops being true.
