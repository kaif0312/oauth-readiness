// One place for "how do I use this from my coding agent": the site's install panel, /llms.txt and a browser opening
// /api/mcp all read from here, so the snippets never drift apart.

export const SITE = "https://oauth-readiness-five.vercel.app";
export const MCP_URL = `${SITE}/api/mcp`;
const NAME = "oauth-readiness";

export type Install = { client: string; where: string; code: string; link?: { label: string; href: string } };

export const INSTALLS: Install[] = [
  { client: "Claude Code", where: "terminal", code: `claude mcp add --transport http ${NAME} ${MCP_URL}` },
  {
    client: "Cursor",
    where: "~/.cursor/mcp.json",
    code: JSON.stringify({ mcpServers: { [NAME]: { url: MCP_URL } } }, null, 2),
    link: { label: "Add to Cursor", href: `cursor://anysphere.cursor-deeplink/mcp/install?name=${NAME}&config=${Buffer.from(JSON.stringify({ url: MCP_URL })).toString("base64")}` },
  },
  {
    client: "VS Code",
    where: "terminal",
    code: `code --add-mcp '${JSON.stringify({ name: NAME, type: "http", url: MCP_URL })}'`,
    link: { label: "Add to VS Code", href: `vscode:mcp/install?${encodeURIComponent(JSON.stringify({ name: NAME, type: "http", url: MCP_URL }))}` },
  },
  { client: "Codex", where: "~/.codex/config.toml", code: `[mcp_servers.${NAME}]\nurl = "${MCP_URL}"` },
  { client: "Windsurf", where: "~/.codeium/windsurf/mcp_config.json", code: JSON.stringify({ mcpServers: { [NAME]: { serverUrl: MCP_URL } } }, null, 2) },
];

// What the developer pastes into their agent once the MCP is connected.
export function agentPrompt(slug?: string, app?: string): string {
  const target = slug ? `${app ?? slug} (guide "${slug}")` : "<provider, e.g. Slack>";
  return [
    `Set up the ${target} OAuth app for this project with the ${NAME} MCP.`,
    `1. Call get_profile with template: true, fill it from this repo (app name, site, privacy policy, support email, domains, redirect URIs) and ask me for anything you cannot find. Never invent values.`,
    `2. Call get_setup_plan with ${slug ? `slug "${slug}"` : "the provider's slug from list_guides"} and that profile.`,
    `3. Walk me through it in my signed-in browser: fill the forms, stop at every STOP step, never type passwords or paste the client secret into chat.`,
    `4. Put the env var names from the plan in .env.example, then verify one login works.`,
  ].join("\n");
}

export const TOOLS = [
  ["list_guides", "providers with a guide, difficulty, time to first token and to real users"],
  ["get_setup_plan", "steps for your agent to fill the provider's console from your profile, with STOP points for you"],
  ["get_profile", "template: true gives the profile keys the forms ask for"],
  ["get_guide", "the full research: review timelines, scopes, blockers, sources"],
  ["research_app", "research a provider that is not listed yet (2-4 min, paid, ask first)"],
] as const;

const esc = (s: string) => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

export function installHtml(): string {
  const blocks = INSTALLS.map(
    (i) =>
      `<h2>${i.client} <small>${esc(i.where)}</small></h2><pre>${esc(i.code)}</pre>${i.link ? `<p><a href="${esc(i.link.href)}">${i.link.label}</a></p>` : ""}`,
  ).join("\n");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>OAuth Readiness MCP</title><style>body{font:16px/1.5 system-ui,sans-serif;max-width:720px;margin:2rem auto;padding:0 16px;color:#111}pre{background:#f4f4f5;padding:12px;border-radius:6px;overflow-x:auto;white-space:pre-wrap}small{color:#666;font-weight:normal;font-size:.8em}h2{font-size:1.05rem;margin-top:1.5rem}</style></head>
<body><h1>OAuth Readiness MCP server</h1><p>This URL is an MCP endpoint for coding agents, not a web page. Add it to your agent, then ask it to set up an OAuth app. <a href="${SITE}">Browse the guides</a>.</p>
${blocks}
<h2>Then ask your agent</h2><pre>${esc(agentPrompt())}</pre></body></html>`;
}

export function llmsTxt(guides: { slug: string; app: string; difficulty: string; firstToken: string; launch: string }[]): string {
  return `# OAuth Readiness

> How long a provider's OAuth app takes to get approved, what it needs, what can block it, and which setup steps an AI agent can do for the developer. Every claim is marked tested, sourced or inferred.

MCP server (Streamable HTTP, no auth): ${MCP_URL}
Claude Code: ${INSTALLS[0].code}

## Tools
${TOOLS.map(([n, d]) => `- ${n}: ${d}`).join("\n")}

Typical flow: list_guides -> get_profile {template: true} (fill from the project, ask the developer for the rest) -> get_setup_plan {slug, profile} -> drive the developer's browser, stopping at STOP steps.

## Guides
${guides.map((g) => `- [${g.app}](${SITE}/guides/${g.slug}): slug \`${g.slug}\`, ${g.difficulty}, first token ${g.firstToken}, real users ${g.launch}`).join("\n")}

## Prompt for your agent
${agentPrompt()}
`;
}
