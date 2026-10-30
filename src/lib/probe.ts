// probe_oauth: a real, read-only test the agent can run against a provider.
// Fetches OAuth / OIDC discovery metadata and, if given, hits the authorize endpoint
// with a dummy client id to see how it rejects unknown clients. No credentials involved.

const TIMEOUT_MS = 8000;
const MAX_BODY = 20_000;

function safeUrl(raw: string): URL | null {
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:") return null;
    const h = u.hostname;
    // Public hostnames only: no IP literals, no localhost / internal names.
    if (!h.includes(".") || /^[\d.]+$/.test(h) || h.includes(":") || h.endsWith(".local") || h.endsWith(".internal")) return null;
    return u;
  } catch {
    return null;
  }
}

async function get(url: URL, redirect: RequestRedirect = "follow") {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { redirect, signal: ctrl.signal, headers: { "user-agent": "oauth-guides-probe/1.0" } });
    const text = (await res.text()).slice(0, MAX_BODY);
    return { status: res.status, location: res.headers.get("location"), contentType: res.headers.get("content-type"), text };
  } catch (e) {
    return { status: 0, location: null, contentType: null, text: `fetch failed: ${(e as Error).message}` };
  } finally {
    clearTimeout(t);
  }
}

const METADATA_KEYS = [
  "issuer", "authorization_endpoint", "token_endpoint", "registration_endpoint", "scopes_supported",
  "response_types_supported", "grant_types_supported", "code_challenge_methods_supported",
  "token_endpoint_auth_methods_supported", "revocation_endpoint", "device_authorization_endpoint",
];

export type ProbeInput = { domains: string[]; authorizeUrl?: string };

export async function probeOAuth(input: ProbeInput) {
  const results: Record<string, unknown>[] = [];
  for (const d of input.domains.slice(0, 4)) {
    // "host" or "host/issuer/path" (e.g. login.microsoftonline.com/common/v2.0): try the issuer path too.
    const [host, ...rest] = d.replace(/^https?:\/\//, "").replace(/\/+$/, "").split("/");
    const prefixes = rest.length ? ["", `/${rest.join("/")}`] : [""];
    const candidates = prefixes.flatMap((p) => [`${p}/.well-known/oauth-authorization-server`, `${p}/.well-known/openid-configuration`]);
    for (const path of candidates) {
      const url = safeUrl(`https://${host}${path}`);
      if (!url) continue;
      const r = await get(url);
      let metadata: Record<string, unknown> | null = null;
      if (r.status === 200) {
        try {
          const json = JSON.parse(r.text);
          metadata = Object.fromEntries(METADATA_KEYS.filter((k) => k in json).map((k) => [k, json[k]]));
        } catch {
          /* not JSON */
        }
      }
      results.push({
        url: url.toString(),
        status: r.status,
        found: !!metadata,
        metadata,
        dynamicClientRegistration: metadata ? !!metadata.registration_endpoint : undefined,
      });
    }
  }

  let authorize: Record<string, unknown> | undefined;
  if (input.authorizeUrl) {
    const u = safeUrl(input.authorizeUrl);
    if (u) {
      u.searchParams.set("client_id", "probe-nonexistent-client");
      u.searchParams.set("response_type", "code");
      u.searchParams.set("redirect_uri", "https://example.com/callback");
      const r = await get(u, "manual");
      authorize = {
        url: u.toString(),
        status: r.status,
        redirectsTo: r.location,
        bodySnippet: r.text.replace(/\s+/g, " ").slice(0, 600),
      };
    } else authorize = { error: "authorizeUrl must be a public https URL" };
  }

  return { testedAt: new Date().toISOString(), discovery: results, authorize };
}
