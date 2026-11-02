import { kvGet, kvList, kvPut, takeDailyCounter } from "./store";

// Reports from setup agents: stored at feedback/<slug>/<timestamp>-<random>.json (R2, or .data/feedback locally).

export const REPORT_KINDS = ["console-changed", "wrong-fact", "missing-step", "worked"] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];
export const MAX_TEXT = 2000;
export const DAILY_REPORT_LIMIT = 200;

export type Report = { slug: string; kind: ReportKind; step?: number; text: string; evidenceUrl?: string; at: string };

// Things that look like credentials. A setup agent pasting a client secret into a report must not get it stored.
const SECRET_PATTERNS: RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{16,}/,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bAIza[0-9A-Za-z_-]{30,}/,
  /\bGOCSPX-[A-Za-z0-9_-]{10,}/,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./, // JWT
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bbearer\s+[A-Za-z0-9._~+/-]{20,}/i,
  /\b(?:client[_ -]?secret|secret|api[_ -]?key|access[_ -]?token|refresh[_ -]?token|password|token)\b["']?\s*[:=]\s*["']?[A-Za-z0-9._~+/-]{8,}/i,
];

export function looksLikeSecret(text: string): boolean {
  if (SECRET_PATTERNS.some((re) => re.test(text))) return true;
  const withoutUrls = text.replace(/https?:\/\/\S+/g, " ");
  // any unbroken run of 32+ token characters that mixes letters and digits
  return (withoutUrls.match(/[A-Za-z0-9_+/=-]{32,}/g) ?? []).some((m) => /[A-Za-z]/.test(m) && /\d/.test(m));
}

export type SubmitResult = { ok: true; key: string } | { ok: false; error: string };

export async function submitReport(input: { slug: string; kind: ReportKind; step?: number; text: string; evidenceUrl?: string }): Promise<SubmitResult> {
  const text = input.text.trim();
  if (!text) return { ok: false, error: "text is empty." };
  if (text.length > MAX_TEXT) return { ok: false, error: `text is longer than ${MAX_TEXT} characters.` };
  if (looksLikeSecret(text) || (input.evidenceUrl && looksLikeSecret(input.evidenceUrl))) {
    return { ok: false, error: "The report looks like it contains a secret (token, key or password). Remove it and send the report again; never include credentials." };
  }
  let evidenceUrl: string | undefined;
  if (input.evidenceUrl) {
    try {
      const u = new URL(input.evidenceUrl);
      if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error("scheme");
      u.username = "";
      u.password = "";
      evidenceUrl = u.toString().slice(0, 500);
    } catch {
      return { ok: false, error: "evidenceUrl is not a valid http(s) URL." };
    }
  }
  if (!(await takeDailyCounter("reports", DAILY_REPORT_LIMIT))) return { ok: false, error: "Today's limit of reports is used up. Try again tomorrow." };
  const at = new Date().toISOString();
  const rand = Math.random().toString(36).slice(2, 8);
  const key = `feedback/${input.slug}/${at.toLowerCase().replace(/:/g, "-")}-${rand}.json`;
  const report: Report = { slug: input.slug, kind: input.kind, text, at, ...(input.step !== undefined ? { step: input.step } : {}), ...(evidenceUrl ? { evidenceUrl } : {}) };
  await kvPut(key, JSON.stringify(report));
  return { ok: true, key };
}

/** Count and the newest `n` reports for a guide (the list call covers the first 1000 keys). */
export async function recentReports(slug: string, n = 5): Promise<{ count: number; recent: Report[] }> {
  const keys = await kvList(`feedback/${slug}/`);
  const newest = keys.slice(-n).reverse();
  const recent = (
    await Promise.all(
      newest.map(async (k) => {
        try {
          const raw = await kvGet(k);
          return raw ? (JSON.parse(raw) as Report) : null;
        } catch {
          return null;
        }
      }),
    )
  ).filter((r): r is Report => !!r);
  return { count: keys.length, recent };
}
