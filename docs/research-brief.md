# Research brief for seed guides

You are writing one or more OAuth setup guides for the library. Read these first:
- `src/lib/guide.ts`: the schema (field descriptions say what goes where)
- `src/data/profile/iskaria.json`: the developer profile. Iskaria is the developer: a clinic-operations console whose AI assistant
  connects clinics' business accounts. Personalise: use `useCases` for the scopes, set `profileKey` on fields/prerequisites the profile
  answers, and call out what the profile is MISSING for this provider (null fields, no Limited Use section, no demo video, ...).

## The question the guide answers
A developer must register their own OAuth app with this provider (client id/secret, consent screen, scopes) and, for real users,
often pass a review. Answer: how hard, how long (hands-on vs. calendar wait), what's required, what can block approval, and which steps
an agent can do vs. a human.

## Evidence rules (most important)
- Every claim gets `evidence`. `sourced` only with a source you actually fetched this session, plus a short verbatim `quote` in the source.
  Prefer official docs/policy pages (`official-docs`, `provider-policy`). Community posts (Reddit, Stack Overflow, blogs) are `community`
  and a claim backed only by them is `inferred`.
- `tested` only for things in the "Our tests" notes given to you, or that you actually did.
- Review wait times are rarely documented officially. Give a range, cite where it comes from, and say in `uncertainties` when it's anecdotal.
- Fill `meta.verification` with 3-6 spot checks: claims you re-checked against a second source or the live page, with result
  confirmed / corrected / unverified. If you found a common claim to be outdated (e.g. a renamed console, a changed limit), record it as
  `corrected`; those are valuable.
- Never invent URLs. If a deep link is unknown, omit `url`.
- Date today: 2026-10-30. `accessed` = that date. Note anything that changed in 2025-2026.

## Tools
Web: load `mcp__deepseek-web__search` and `mcp__deepseek-web__fetch_page` via ToolSearch (built-in WebSearch does NOT work on this
machine). WebFetch also works for pages. Do not log into anything, create accounts or submit forms.

## Output
Write `src/data/guides/<slug>.json` (UTF-8). `meta.generatedBy: "seed-research"`, `meta.generatedAt: "2026-10-30"`.
Validate: `node scripts/validate.ts src/data/guides/<slug>.json` from the repo root (`C:\Users\Ibrahim Kaif\Desktop\oauth-guides`), fix until ok.
Keep it practical: 6-12 steps, the 3-6 scopes an agent integration typically needs, the real blockers. No marketing voice.
Do not touch any other file.
