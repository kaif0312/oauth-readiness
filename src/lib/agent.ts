import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { Guide } from "./guide";
import { probeOAuth, type ProbeInput } from "./probe";
import profile from "@/data/profile/iskaria.json";

// Live guide generation: research (web search + fetch + a real OAuth probe) -> compose (schema-constrained) -> validate.

export type AgentEvent =
  | { type: "phase"; phase: "research" | "compose" | "save"; text: string }
  | { type: "search"; query: string }
  | { type: "fetch"; url: string }
  | { type: "probe"; domains: string[]; summary: string }
  | { type: "thinking"; text: string }
  | { type: "note"; text: string }
  | { type: "done"; slug: string }
  | { type: "error"; message: string };

const MODEL = "claude-opus-5-5";
const RESEARCH_BUDGET_MS = 140_000;
const today = () => new Date().toISOString().slice(0, 10);

const RESEARCH_SYSTEM = `You research how a developer sets up an OAuth app with a provider and gets it approved, so their AI agent's users can connect that provider.

The developer is described by this profile (use its useCases to pick scopes; notice what it lacks):
${JSON.stringify(profile, null, 2)}

Find out, from the provider's own documentation wherever possible:
1. Whether the provider supports OAuth for third-party apps at all (if not: what the alternative is, e.g. API keys, partner program).
2. Where and how to register an app: console URL, the form fields, redirect URI rules, client secret handling.
3. Test/development mode and its limits (user caps, token expiry, workspace/tenant restrictions).
4. What review or approval stands between test and real users: name of the process, requirements (privacy policy, demo video, security assessment, business verification, partner tier, paid plan), cost, and realistic wait time.
5. The scopes an agent integration typically needs and which of them trigger extra review.
6. Nuances that block people: recent policy changes (2025-2026), rate limits for unreviewed apps, org-admin approval, regional limits.

Method (you have about two minutes, so batch your calls: one round of parallel searches, one round of parallel fetches, the probe, a short re-check, then write):
- Search, then FETCH the key official pages; quote them. Prefer docs over blogs. Note page dates where shown.
- Call probe_oauth once with the provider's likely auth domains (and the authorize URL if you found it). This is a real test: report what the discovery metadata shows (endpoints, PKCE, dynamic client registration) and how the authorize endpoint rejects an unknown client.
- Re-check the 2-4 most decision-relevant claims (review requirement, wait time, user cap) against a second page. Record whether they held up.
- Be honest about gaps: review wait times are usually anecdotal; say so.

Finish with a research dossier in plain text with these headings: FINDINGS (each line: claim | evidence: tested/sourced/inferred | source URL | short verbatim quote), PROBE RESULT, VERIFICATION (claim | method | confirmed/corrected/unverified), UNCERTAINTIES, SOURCES (url | title | kind). Keep it dense; no preamble. Today is ${today()}.`;

const COMPOSE_SYSTEM = `You turn an OAuth research dossier into a guide that matches the given JSON schema exactly.
Rules:
- Use only facts in the dossier. Every evidence.sourceIds entry must be an id from sources[]. Only URLs from the dossier.
- evidence.status: "tested" only for the probe_oauth result (add a source of kind "our-test" for it, url = the probed URL); "sourced" when an official page in the dossier says it; otherwise "inferred".
- Personalise for the developer profile: set profileKey on fields/prerequisites the profile answers (keys: ${Object.keys(profile).filter((k) => !k.startsWith("_")).join(", ")}); add a prerequisite or blocker for each requirement the profile is missing (null values).
- steps: 5-12, in order, phase build -> test -> launch, who = agent | you | agent-then-you. Logins, legal acceptance, payment, identity/business verification and final "Submit for review" are "you". Drafting texts, manifests, scope justifications, privacy-policy sections and demo scripts are "agent-then-you".
- When sources disagree (e.g. a blog vs the provider's docs), the provider's docs win in summary and verdict; put the conflict in uncertainties. Never state a figure in the summary that the verification list contradicts.
- If the probe found a registration_endpoint (dynamic client registration, common on MCP servers), add an "info" blocker saying an agent may be able to register a client itself with no manual app, and on which surface (e.g. the MCP server but not the REST API).
- verdict.timeToLaunch is calendar time including review waits. summary: 2-3 plain sentences a developer can forward.
- meta.generatedBy = "live-agent", meta.generatedAt = "${today()}", sources[].accessed = "${today()}".
Output ONLY one JSON object (no prose, no code fences) valid against this JSON Schema:
${JSON.stringify(z.toJSONSchema(Guide))}`;

const probeTool: Anthropic.Tool = {
  name: "probe_oauth",
  description:
    "Real read-only test. Fetches /.well-known/oauth-authorization-server and /.well-known/openid-configuration on each domain (public https only), and optionally calls the authorize URL with a dummy client_id to see how unknown clients are rejected. Use once.",
  strict: true,
  input_schema: {
    type: "object",
    properties: {
      domains: { type: "array", items: { type: "string" }, description: "auth hostnames, e.g. ['accounts.google.com','oauth2.googleapis.com']" },
      authorizeUrl: { type: "string", description: "the provider's OAuth authorize endpoint, or empty string if unknown" },
    },
    required: ["domains", "authorizeUrl"],
    additionalProperties: false,
  },
};

// Server tools; cast because the installed SDK's type union may lag the newest tool versions.
const serverTools = [
  { type: "web_search_20260209", name: "web_search", max_uses: 6 },
  { type: "web_fetch_20260209", name: "web_fetch", max_uses: 8, max_content_tokens: 12000 },
] as unknown as Anthropic.ToolUnion[];

export async function generateGuide(query: string, slug: string, emit: (e: AgentEvent) => void): Promise<Guide> {
  const client = new Anthropic();

  // ---- Phase 1: research ----
  emit({ type: "phase", phase: "research", text: `Researching ${query}` });
  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: `App to research: ${query}\nProduce the dossier.` },
  ];
  let dossier = "";
  const seen = new Set<string>();
  const t0 = Date.now();
  let wrapUp = false;
  for (let turn = 0; turn < 12; turn++) {
    // Time budget: the whole run must fit a 300 s function. Past it, no more tools, write the dossier.
    if (!wrapUp && turn > 0 && Date.now() - t0 > RESEARCH_BUDGET_MS) {
      wrapUp = true;
      emit({ type: "phase", phase: "research", text: "Time budget reached, writing up what was found" });
      const note = { type: "text" as const, text: "Time is up. Do not call more tools. Write the dossier now from what you have, and list what you could not check under UNCERTAINTIES." };
      const last = messages[messages.length - 1];
      if (last.role === "user" && Array.isArray(last.content)) last.content.push(note);
      else messages.push({ role: "user", content: [note] });
    }
    const stream = client.messages.stream({
      model: MODEL,
      max_tokens: 32000,
      thinking: { type: "adaptive", display: "summarized" },
      output_config: { effort: "medium" },
      system: RESEARCH_SYSTEM,
      tools: [...serverTools, probeTool],
      ...(wrapUp ? { tool_choice: { type: "none" as const } } : {}),
      messages,
    });
    stream.on("thinking", (delta) => emit({ type: "thinking", text: delta }));
    stream.on("text", (delta) => emit({ type: "note", text: delta }));
    stream.on("contentBlock", (block) => {
      if (block.type === "server_tool_use") {
        const input = block.input as { query?: string; url?: string };
        // Dynamic filtering can re-issue the same call; show each search/fetch once.
        const key = `${block.name}:${input.query ?? input.url ?? ""}`;
        if (seen.has(key)) return;
        seen.add(key);
        if (block.name === "web_search" && input.query) emit({ type: "search", query: input.query });
        if (block.name === "web_fetch" && input.url) emit({ type: "fetch", url: input.url });
      }
    });
    const msg = await stream.finalMessage();
    messages.push({ role: "assistant", content: msg.content });

    if (msg.stop_reason === "refusal") throw new Error("The model declined this request.");
    if (msg.stop_reason === "pause_turn") continue;
    if (msg.stop_reason === "tool_use") {
      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const block of msg.content) {
        if (block.type !== "tool_use") continue;
        if (block.name !== "probe_oauth") {
          results.push({ type: "tool_result", tool_use_id: block.id, content: "unknown tool", is_error: true });
          continue;
        }
        const raw = block.input as { domains?: unknown; authorizeUrl?: unknown };
        const input: ProbeInput = {
          domains: Array.isArray(raw.domains) ? raw.domains.filter((d): d is string => typeof d === "string") : [],
          authorizeUrl: typeof raw.authorizeUrl === "string" && raw.authorizeUrl ? raw.authorizeUrl : undefined,
        };
        const out = await probeOAuth(input);
        const found = out.discovery.filter((d) => d.found).map((d) => d.url);
        emit({
          type: "probe",
          domains: input.domains,
          summary: found.length ? `discovery metadata at ${found.join(", ")}` : "no discovery metadata found",
        });
        results.push({ type: "tool_result", tool_use_id: block.id, content: JSON.stringify(out) });
      }
      messages.push({ role: "user", content: results });
      continue;
    }
    dossier = msg.content.filter((b) => b.type === "text").map((b) => (b as Anthropic.TextBlock).text).join("\n");
    break;
  }
  if (!dossier.trim()) throw new Error("Research ended without a dossier.");

  // ---- Phase 2: compose into the schema ----
  // The schema is too big for constrained decoding ("compiled grammar is too large"), so it goes in the
  // prompt as JSON Schema; zod validates, and one repair round fixes whatever it missed.
  emit({ type: "phase", phase: "compose", text: "Writing the guide" });
  const compose: Anthropic.MessageParam[] = [
    {
      role: "user",
      content: `slug: ${slug}\nApp requested: ${query}\n\nDeveloper profile:\n${JSON.stringify(profile)}\n\nResearch dossier:\n${dossier}`,
    },
  ];
  let guide: Guide | null = null;
  for (let attempt = 0; attempt < 2 && !guide; attempt++) {
    const s = client.messages.stream({
      model: MODEL,
      max_tokens: 32000,
      output_config: { effort: "low" },
      system: [{ type: "text", text: COMPOSE_SYSTEM, cache_control: { type: "ephemeral" } }],
      messages: compose,
    });
    let chars = 0;
    s.on("text", (delta) => {
      const before = Math.floor(chars / 3000);
      chars += delta.length;
      if (Math.floor(chars / 3000) > before) emit({ type: "phase", phase: "compose", text: `Writing the guide (${Math.round(chars / 1000)}k characters)` });
    });
    const res = await s.finalMessage();
    if (res.stop_reason === "refusal") throw new Error("The model declined to write this guide.");
    if (res.stop_reason === "max_tokens") throw new Error("The guide was cut off before it was complete.");
    const text = res.content.filter((b) => b.type === "text").map((b) => (b as Anthropic.TextBlock).text).join("");
    const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
    let problem = "";
    try {
      const parsed = Guide.safeParse({ ...JSON.parse(json), slug });
      if (parsed.success) guide = parsed.data;
      else problem = parsed.error.issues.slice(0, 15).map((i) => `${i.path.join(".")}: ${i.message}`).join("\n");
    } catch (e) {
      problem = `invalid JSON: ${(e as Error).message}`;
    }
    if (!guide) {
      if (attempt === 1) throw new Error(`Guide did not match the schema: ${problem.split("\n")[0]}`);
      emit({ type: "phase", phase: "compose", text: "Fixing schema issues" });
      compose.push({ role: "assistant", content: res.content }, { role: "user", content: `That JSON fails validation:\n${problem}\nReturn the complete corrected JSON object only.` });
    }
  }
  if (!guide) throw new Error("No guide produced.");

  // Every cited id must exist; drop dangling ones rather than ship a broken reference.
  const ids = new Set(guide.sources.map((s) => s.id));
  const clean = JSON.parse(
    JSON.stringify(guide, (k, v) => (k === "sourceIds" ? (v as string[]).filter((id) => ids.has(id)) : v)),
  );
  return Guide.parse(clean);
}
