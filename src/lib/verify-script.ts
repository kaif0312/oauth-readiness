// One self-contained Node 20+ ESM script (no npm deps) that proves an OAuth app works end to end: it opens a localhost
// callback, prints the authorize URL for the human, exchanges the code and makes one test call. It never prints tokens
// or secrets. The text is returned inside get_setup_plan; the developer's agent writes it to a scratch file and runs it.
// Keep it free of backticks, `${` and backslashes: it lives inside a template literal.

export type VerifyConfig = {
  idEnv: string;
  secretEnv: string;
  authorizeUrl: string;
  tokenUrl: string;
  redirect: string;
  scopes: string[];
  sep: " " | ",";
  pkce: boolean;
  clientAuth: "client_secret_post" | "client_secret_basic" | "none" | "unknown";
  extra: Record<string, string>;
  test: { method: "GET" | "POST"; url: string; note?: string } | null;
};

export function verifyScript(c: VerifyConfig): string {
  return `// verify-oauth.mjs - run with: node verify-oauth.mjs (Node 20+). Prints no tokens or secrets. Delete after use.
import http from "node:http";
import crypto from "node:crypto";
const C = ${JSON.stringify(c)};
const id = process.env[C.idEnv];
const secret = process.env[C.secretEnv];
const fail = (m) => { console.log("FAIL: " + m); process.exit(1); };
if (!id || (C.clientAuth !== "none" && !secret)) fail("set " + C.idEnv + (C.clientAuth !== "none" ? " and " + C.secretEnv : "") + " in the environment first");
const redirect = new URL(C.redirect);
const state = crypto.randomBytes(16).toString("hex");
const verifier = crypto.randomBytes(32).toString("base64url");
const auth = new URL(C.authorizeUrl);
const q = { client_id: id, redirect_uri: C.redirect, response_type: "code", state };
if (C.scopes.length) q.scope = C.scopes.join(C.sep);
if (C.pkce) { q.code_challenge = crypto.createHash("sha256").update(verifier).digest("base64url"); q.code_challenge_method = "S256"; }
for (const [k, v] of Object.entries({ ...q, ...C.extra })) auth.searchParams.set(k, v);
const params = await new Promise((resolve) => {
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, redirect.origin);
    if (u.pathname !== redirect.pathname) { res.writeHead(404).end(); return; }
    res.end("Done. You can close this tab.");
    srv.close();
    resolve(u.searchParams);
  });
  srv.on("error", (e) => fail("cannot listen on " + C.redirect + ": " + e.message));
  srv.listen(Number(redirect.port) || 80, redirect.hostname, () => {
    console.log("Open this URL in your browser, sign in and approve:");
    console.log(auth.href);
  });
  setTimeout(() => fail("no callback within 5 minutes"), 300000).unref();
});
if (params.get("error")) fail("provider returned error=" + params.get("error") + " " + (params.get("error_description") || ""));
if (params.get("state") !== state) fail("state mismatch");
const body = new URLSearchParams({ grant_type: "authorization_code", code: params.get("code") || "", redirect_uri: C.redirect });
const headers = { "content-type": "application/x-www-form-urlencoded", accept: "application/json" };
if (C.pkce) body.set("code_verifier", verifier);
if (C.clientAuth === "client_secret_basic") headers.authorization = "Basic " + Buffer.from(encodeURIComponent(id) + ":" + encodeURIComponent(secret)).toString("base64");
else { body.set("client_id", id); if (C.clientAuth !== "none") body.set("client_secret", secret); }
const res = await fetch(C.tokenUrl, { method: "POST", headers, body });
const text = await res.text();
let t = {};
try { t = JSON.parse(text); } catch { t = Object.fromEntries(new URLSearchParams(text)); }
const token = t.access_token || (t.authed_user && t.authed_user.access_token);
if (!res.ok || !token) fail("token exchange HTTP " + res.status + " " + (t.error || "") + " " + (t.error_description || ""));
console.log("SUCCESS: token exchange worked");
console.log("granted scopes: " + (t.scope || (t.authed_user && t.authed_user.scope) || "(not reported)"));
console.log("token type: " + (t.token_type || "(not reported)") + ", expires_in: " + (t.expires_in ?? "(none)") + ", refresh token: " + (t.refresh_token ? "yes" : "no"));
if (C.test) {
  const r = await fetch(C.test.url, { method: C.test.method, headers: { authorization: "Bearer " + token, accept: "application/json" } });
  console.log("test call " + C.test.method + " " + C.test.url + " -> HTTP " + r.status);
  process.exit(r.ok ? 0 : 1);
}
console.log("no test call in this guide: make one read-only API call with the token yourself");
`;
}
