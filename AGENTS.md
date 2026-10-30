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
Assignment brief and scope: the first message of the original session; deliverables are the live link, this repo and README.

## Code map

| Path | What |
|---|---|
| `src/lib/guide.ts` | zod `Guide` schema shared by seeds, live agent, UI and MCP. Every claim has `evidence` tested/sourced/inferred |
| `src/data/guides/*.json` | 8 seed guides (github, google-gmail, google-search-analytics, hubspot, linkedin, meta, microsoft-graph, slack). `node scripts/validate.ts` checks schema + source ids |
| `src/data/profile/iskaria.json` | developer profile (Iskaria, public facts only). `{provider}` in values is filled per guide |
| `src/lib/agent.ts` | live agent: research (Opus 5.5, web_search/web_fetch server tools + local `probe_oauth`, 140 s budget, forced wrap-up) then compose (streamed JSON, zod-validated, one repair round) |
| `src/lib/probe.ts` | credential-free endpoint probe: RFC 8414 / OIDC discovery, PKCE, dynamic client registration, authorize error shape |
| `src/lib/plan.ts` | `buildPlan()`: guide -> setup plan for a browser agent; `BROWSER_RULES` (never type secrets, stop at STOP steps, reload and read back after every save) |
| `src/lib/store.ts` | seeds from disk; live guides in Vercel Blob (`guides/<slug>.json`), `.data/guides` locally; `takeGenerationSlot` daily cap (`DAILY_GENERATION_LIMIT`, default 40) |
| `src/app/api/generate/route.ts` | SSE stream of agent events, `maxDuration` 300 |
| `src/app/api/mcp/route.ts` | MCP server |
| `scripts/` | `validate.ts`, `probe.ts`, `setup-github.ts`, `push-live.ts` (push a local `.data` guide to Blob). Run with `node` (type stripping) |

Env (`.env.example`): `ANTHROPIC_API_KEY` (Vercel has it, unquoted; `.env.local` has it quoted, the code strips quotes),
`BLOB_READ_WRITE_TOKEN`, `DAILY_GENERATION_LIMIT`, `NTFY_TOPIC` / `NOTIFY_WEBHOOK` (setup-agent handoff pings).
Secrets never in git: `.secrets/`, `.auth/`, `.data/`, `.env*` are git-ignored AND in `.vercelignore` (a locked Chrome profile
in `.auth/` once made every CLI deploy fail silently with EBUSY).

## State and open problems (in priority order)

1. **BROKEN: live guides are unreadable.** The Vercel Blob store `oauth-readiness-guides` returns 403 "Your store is
   blocked" (the account's free Blob allowance; another agent saw "Blob suspended" for the Sign module the same day). The
   files (calendly, notion, zoom) still list, but cannot be read or written, so `/guides/notion` 404s and new live runs fail at
   Save. Unblocking costs money; the owner does not want to pay. Free options, owner to pick: (a) save live guides to this
   GitHub repo through the contents API with a fine-grained token limited to this repo (free, reviewable as PRs/commits);
   (b) Upstash Redis free tier via the Vercel Marketplace (it was deleted once out of a cost worry; the free tier is free);
   (c) Cloudflare R2 (another agent is setting it up for Iskaria, needs Cloudflare sign-in). Local copies exist only for
   calendly and xero (`.data/guides`).
2. **Xero live guide contradicts itself** (summary says 5 connections, verification says 25). The compose prompt now forbids
   that; regenerate xero, then push with `node --env-file=.env.local scripts/push-live.ts xero` (once storage works).
3. 8 guides, not 100. The scale path: batch `research_app` runs + a human review queue; seeds were researched by parallel
   agents following `docs/research-brief.md`, then checked by a separate verifier.
4. Save the Google console flow to the browser-flows library (`~/.claude/scripts/browser-flows/`, see the `browser-fast`
   skill) so the next Google setup is a replay. Steps and selectors are in "Google end to end" below.
5. The folder sits on the Desktop root; the workspace map (`~/.claude/scripts/workspace.md`) says non-Iskaria projects go in
   `Desktop/Projects/<name>`. Move it when nothing runs from it (the `.vercel` link moves with the folder).
6. The assignment named a company ("APM Integrations"); never confirmed what they are. If the owner shares a link, match the
   README framing to it.

## Google end to end (the proof case, 2026-10-30)

Claude Code fetched `get_setup_plan("google-search-analytics")` from production MCP and filled Google Auth Platform for
Iskaria's project `dr-jefna-gbp` in the owner's Chrome (Gmail profile, Claude in Chrome deviceId `c3b434b0-...`; the other
profile `96427a42-...` is ibrahim@iskaria.com and asks for a password on the Cloud console). Then "Connect Google" in the
Iskaria console read live Business Profile, Search Console and GA4 data. Detail lives in the Iskaria app repo:
`Desktop/Iskaria/app/docs/agents/google-connect-seo.md` and `docs/google/oauth-verification-submission.md`.

Lessons (all in the Google guide and `plan.ts` already):
- `business.manage` and `webmasters.readonly` are non-sensitive; only `analytics.readonly` needs verification.
- User support email = the signed-in account or a Google Group it manages.
- New client option "Use this client for an AI-powered agent"; Google wants separate clients for agent and normal flows.
- Unsaved console forms vanish on navigation; one "saved" Branding page kept only the domain. Reload and read back.
- The logo upload input is hidden: set it with a DataTransfer in `javascript_tool` (file_upload had no ref to target).
- Brand verification is automatic (passed in about 2 minutes), then "Publish branding".
- The extension may not act on accounts.google.com: sign-in and consent are always the human's.

## How to work here

- `npm run dev` (port 3000; the old session used 3100), `npx tsc --noEmit`, `npx eslint`, `node scripts/validate.ts`,
  `npx next build` before pushing. Next.js 16: `await connection()` instead of `dynamic`, `PageProps` with Promise params.
- Machine: Windows, `py` not `python`, no `jq`, built-in WebSearch does not work (use the deepseek-web MCP).
- Never print or commit keys. Profile data stays public facts only (no Iskaria project numbers, client ids, third-party emails).
- Update this file as you go: delete what stops being true.
