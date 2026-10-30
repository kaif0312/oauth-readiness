import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
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

Method:
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
- If the probe found a registration_endpoint (dynamic client registration, common on MCP servers), add an "info" blocker saying an agent may be able to register a client itself with no manual app, and on which surface (e.g. the MCP server but not the REST API).
- verdict.timeToLaunch is calendar time including review waits. summary: 2-3 plain sentences a developer can forward.
- meta.generatedBy = "live-agent", meta.generatedAt = "${today()}", sources[].accessed = "${today()}".`;

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
  { type: "web_search_20260209", name: "web_search", max_uses: 10 },
  { type: "web_fetch_20260209", name: "web_fetch", max_uses: 14, max_content_tokens: 15000 },
] as unknown as Anthropic.ToolUnion[];

export async function generateGuide(query: string, slug: string, emit: (e: AgentEvent) => void): Promise<Guide> {
  const client = new Anthropic();

  // ---- Phase 1: research ----
  emit({ type: "phase", phase: "research", text: `Researching ${query}` });
  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: `App to research: ${query}\nProduce the dossier.` },
  ];
  let dossier = "";
  for (let turn = 0; turn < 12; turn++) {
    const stream = client.messages.stream({
      model: MODEL,
      max_tokens: 32000,
      thinking: { type: "adaptive", display: "summarized" },
      output_config: { effort: "medium" },
      system: RESEARCH_SYSTEM,
      tools: [...serverTools, probeTool],
      messages,
    });
    stream.on("thinking", (delta) => emit({ type: "thinking", text: delta }));
    stream.on("text", (delta) => emit({ type: "note", text: delta }));
    stream.on("contentBlock", (block) => {
      if (block.type === "server_tool_use") {
        const input = block.input as { query?: string; url?: string };
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
  emit({ type: "phase", phase: "compose", text: "Writing the guide" });
  const res = await client.messages.parse({
    model: MODEL,
    max_tokens: 32000,
    output_config: { effort: "medium", format: zodOutputFormat(Guide) },
    system: COMPOSE_SYSTEM,
    messages: [
      {
        role: "user",
        content: `slug: ${slug}\nApp requested: ${query}\n\nDeveloper profile:\n${JSON.stringify(profile)}\n\nResearch dossier:\n${dossier}`,
      },
    ],
  });
  if (res.stop_reason === "refusal") throw new Error("The model declined to write this guide.");
  if (!res.parsed_output) throw new Error(`Guide did not match the schema (stop: ${res.stop_reason}).`);
  const guide = Guide.parse({ ...res.parsed_output, slug });

  // Every cited id must exist; drop dangling ones rather than ship a broken reference.
  const ids = new Set(guide.sources.map((s) => s.id));
  const clean = JSON.parse(
    JSON.stringify(guide, (k, v) => (k === "sourceIds" ? (v as string[]).filter((id) => ids.has(id)) : v)),
  );
  return Guide.parse(clean);
}
