import { createHash, createHmac } from "node:crypto";

// Minimal Cloudflare R2 client: the S3 API signed with SigV4 (region "auto") via node:crypto, no SDK. The bucket is
// PRIVATE; guides are read back through our own pages and routes, never a public URL. Free tier: 10 GB, 1M writes and
// 10M reads a month, then pay per use instead of a blocked store (Vercel Blob's Hobby plan blocked ours, 2026-10-30).
// Env: R2_ENDPOINT (https://<account_id>.r2.cloudflarestorage.com), R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET.

const cfg = () => ({
  endpoint: (process.env.R2_ENDPOINT || "").replace(/\/+$/, ""),
  accessKeyId: process.env.R2_ACCESS_KEY_ID || "",
  secret: process.env.R2_SECRET_ACCESS_KEY || "",
  bucket: process.env.R2_BUCKET || "",
});

export function r2Configured(): boolean {
  const c = cfg();
  return !!(c.endpoint && c.accessKeyId && c.secret && c.bucket);
}

const sha256Hex = (data: string) => createHash("sha256").update(data).digest("hex");
const hmac = (key: Buffer | string, data: string) => createHmac("sha256", key).update(data).digest();
// RFC 3986 encoding, as SigV4 wants it in the canonical query string.
const enc = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`);

function safeKey(key: string): string {
  if (!/^[a-z0-9/_.-]+$/.test(key) || key.includes("..") || key.startsWith("/")) throw new Error(`bad storage key: ${key}`);
  return key;
}

async function request(method: "GET" | "PUT", key: string, query: Record<string, string> = {}, body?: string, contentType?: string): Promise<Response> {
  const c = cfg();
  const path = `/${c.bucket}${key ? `/${safeKey(key)}` : ""}`;
  const qs = Object.keys(query).sort().map((k) => `${enc(k)}=${enc(query[k])}`).join("&");
  const url = new URL(`${c.endpoint}${path}${qs ? `?${qs}` : ""}`);
  const amzDate = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const day = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(body ?? "");
  const headers: Record<string, string> = { host: url.host, "x-amz-content-sha256": payloadHash, "x-amz-date": amzDate };
  if (contentType) headers["content-type"] = contentType;
  const names = Object.keys(headers).sort();
  const canonical = [method, path, qs, ...names.map((n) => `${n}:${headers[n]}`), "", names.join(";"), payloadHash].join("\n");
  const scope = `${day}/auto/s3/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256Hex(canonical)].join("\n");
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${c.secret}`, day), "auto"), "s3"), "aws4_request");
  const signature = createHmac("sha256", signingKey).update(toSign).digest("hex");
  delete headers.host; // fetch sets Host itself
  return fetch(url, {
    method,
    headers: { ...headers, authorization: `AWS4-HMAC-SHA256 Credential=${c.accessKeyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}` },
    body,
    cache: "no-store",
  });
}

async function fail(what: string, res: Response): Promise<never> {
  throw new Error(`R2 ${what} failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
}

export async function r2Get(key: string): Promise<string | null> {
  const res = await request("GET", key);
  if (res.status === 404) {
    await res.arrayBuffer().catch(() => {}); // read the tiny XML reply so the connection is released (not body.cancel(): it hung on Vercel, Iskaria app #52)
    return null;
  }
  if (!res.ok) await fail(`GET ${key}`, res);
  return res.text();
}

export async function r2Put(key: string, body: string, contentType = "application/json"): Promise<void> {
  const res = await request("PUT", key, {}, body, contentType);
  if (!res.ok) await fail(`PUT ${key}`, res);
}

// ListObjectsV2, first page only (up to 1000 keys), which is plenty for a guide library.
export async function r2List(prefix: string): Promise<{ key: string; lastModified: Date }[]> {
  const res = await request("GET", "", { "list-type": "2", prefix });
  if (!res.ok) await fail(`LIST ${prefix}`, res);
  const xml = await res.text();
  return [...xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)].map(([, item]) => ({
    key: item.match(/<Key>([^<]*)<\/Key>/)?.[1] ?? "",
    lastModified: new Date(item.match(/<LastModified>([^<]*)<\/LastModified>/)?.[1] ?? 0),
  }));
}
