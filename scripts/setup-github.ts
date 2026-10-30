// Setup agent for GitHub: registers a GitHub App from the developer profile via the App Manifest flow.
//
//   node scripts/setup-github.ts            # opens a browser, hands over for sign-in and the final click
//   node scripts/setup-github.ts --dry-run  # print the manifest the agent would submit, do nothing
//
// The agent does: build the manifest (name, homepage, callback URLs, permissions, webhook) from the profile,
// submit it, wait, exchange the code for credentials, save them to .secrets/ (git-ignored).
// You do: sign in (password, 2FA) and click "Create GitHub App". The agent never sees your password.
// Handoff notifications: terminal bell always; push to your phone if NTFY_TOPIC is set (ntfy.sh, free, no account);
// any chat bot / WhatsApp relay if NOTIFY_WEBHOOK is set (POSTs {"text": "..."}).
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const profile = JSON.parse(readFileSync("src/data/profile/iskaria.json", "utf8"));
const PORT = 3999;
const BASE = `http://127.0.0.1:${PORT}`;
const state = randomBytes(16).toString("hex");
const suffix = randomBytes(2).toString("hex");

const callbackUrls = (profile.redirectUris as string[]).map((u) => u.replace("{provider}", "github"));
const manifest = {
  // GitHub App names are global; the suffix keeps a demo run from colliding with an existing app.
  name: `${profile.appName} agent ${suffix}`,
  url: profile.homepageUrl,
  description: profile.useCases?.github ?? profile.appDescription,
  redirect_url: `${BASE}/callback`,
  callback_urls: callbackUrls,
  public: true,
  request_oauth_on_install: false,
  default_permissions: { issues: "write", pull_requests: "write", contents: "read", metadata: "read" },
  default_events: ["issues", "pull_request"],
  hook_attributes: { url: new URL("/api/github/webhook", `https://${profile.appDomain}`).toString(), active: false },
};

async function notify(text: string) {
  process.stdout.write(`\u0007\n>>> ${text}\n`);
  const jobs: Promise<unknown>[] = [];
  if (process.env.NTFY_TOPIC) jobs.push(fetch(`https://ntfy.sh/${process.env.NTFY_TOPIC}`, { method: "POST", body: text, headers: { Title: "OAuth setup agent" } }));
  if (process.env.NOTIFY_WEBHOOK) jobs.push(fetch(process.env.NOTIFY_WEBHOOK, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) }));
  await Promise.allSettled(jobs);
}

if (process.argv.includes("--dry-run")) {
  console.log(JSON.stringify(manifest, null, 2));
  process.exit(0);
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
let finish: (ok: boolean) => void;
const finished = new Promise<boolean>((r) => (finish = r));

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", BASE);
  if (url.pathname === "/start") {
    // Auto-submitting form: GitHub's manifest flow requires a POST from the user's browser.
    res.writeHead(200, { "content-type": "text/html" });
    res.end(`<form id="f" action="https://github.com/settings/apps/new?state=${state}" method="post">
      <input type="hidden" name="manifest" value="${escapeHtml(JSON.stringify(manifest))}"></form>
      <p>Sending the app definition to GitHub…</p><script>document.getElementById("f").submit()</script>`);
    return;
  }
  if (url.pathname === "/callback") {
    const code = url.searchParams.get("code");
    if (!code || url.searchParams.get("state") !== state) {
      res.writeHead(400).end("state mismatch");
      return;
    }
    const r = await fetch(`https://api.github.com/app-manifests/${code}/conversions`, {
      method: "POST",
      headers: { accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28" },
    });
    const app = (await r.json()) as Record<string, unknown>;
    if (!r.ok) {
      res.writeHead(500).end(`GitHub returned ${r.status}`);
      console.error(app);
      finish(false);
      return;
    }
    mkdirSync(".secrets", { recursive: true });
    const file = join(".secrets", `github-app-${app.slug}.json`);
    writeFileSync(file, JSON.stringify(app, null, 2), "utf8");
    res.writeHead(200, { "content-type": "text/html" });
    res.end(`<h2>Done. ${escapeHtml(String(app.name))} is registered.</h2><p>Credentials saved by the agent to ${escapeHtml(file)}. You can close this window.</p>`);
    console.log(`\nRegistered ${app.name}\n  app id:    ${app.id}\n  client id: ${app.client_id}\n  settings:  ${app.html_url}\n  secrets (client secret, webhook secret, private key) -> ${file}`);
    await notify(`Done: GitHub App "${app.name}" registered (client id ${app.client_id}). Credentials saved locally.`);
    finish(true);
    return;
  }
  res.writeHead(404).end();
});

server.listen(PORT, "127.0.0.1", async () => {
  // A real, visible browser with its own profile so a GitHub sign-in is remembered between runs.
  const { chromium } = await import("playwright");
  const ctx = await chromium.launchPersistentContext(".auth/github-browser", { headless: false, channel: "chrome", viewport: null });
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  let last = "";
  page.on("framenavigated", async (frame) => {
    if (frame !== page.mainFrame()) return;
    const u = frame.url();
    const stage = /\/(login|session|sessions\/two-factor)/.test(u) ? "login" : u.includes("/settings/apps/new") ? "review" : "";
    if (!stage || stage === last) return;
    last = stage;
    if (stage === "login") await notify("Your turn: sign in to GitHub in the browser window the agent opened. It waits.");
    if (stage === "review") await notify('Your turn: every field is filled from the profile. Check it and click "Create GitHub App".');
  });
  console.log("Manifest the agent is submitting:\n" + JSON.stringify(manifest, null, 2));
  await page.goto(`${BASE}/start`);
  const ok = await finished;
  await new Promise((r) => setTimeout(r, 2500));
  await ctx.close();
  server.close();
  process.exit(ok ? 0 : 1);
});
