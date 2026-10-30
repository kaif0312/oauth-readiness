"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { AgentEvent } from "@/lib/agent";

type Item = { kind: "phase" | "search" | "fetch" | "probe" | "error"; text: string; at: number };
type Stage = "research" | "compose" | "save";
const STAGES: { key: Stage; label: string }[] = [
  { key: "research", label: "Read docs and probe endpoints" },
  { key: "compose", label: "Write the guide" },
  { key: "save", label: "Check and publish" },
];

export function LiveRun() {
  const params = useSearchParams();
  const router = useRouter();
  const q = params.get("q") ?? "";
  const force = params.get("force") === "1";
  const [items, setItems] = useState<Item[]>([]);
  const [thinking, setThinking] = useState("");
  const [notes, setNotes] = useState("");
  const [state, setState] = useState<"running" | "done" | "error">("running");
  const [elapsed, setElapsed] = useState(0);
  const [stage, setStage] = useState<Stage>("research");
  // A re-run replaces a published guide and spends a paid run: ask first instead of starting on page load.
  const [go, setGo] = useState(!force);
  const started = useRef(false);

  useEffect(() => {
    if (state !== "running" || !go) return;
    const t0 = Date.now();
    const id = setInterval(() => setElapsed(Math.round((Date.now() - t0) / 1000)), 1000);
    return () => clearInterval(id);
  }, [state, go]);

  useEffect(() => {
    if (!q || !go || started.current) return;
    started.current = true;
    const add = (kind: Item["kind"], text: string) => setItems((xs) => [...xs, { kind, text, at: Date.now() }]);
    (async () => {
      const res = await fetch("/api/generate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: q, force }) });
      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        add("error", err.error ?? "Request failed");
        setState("error");
        return;
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split("\n\n");
        buf = parts.pop() ?? "";
        for (const part of parts) {
          if (!part.startsWith("data: ")) continue;
          const e = JSON.parse(part.slice(6)) as AgentEvent;
          if (e.type === "phase") {
            add("phase", e.text);
            setStage(e.phase);
          }
          else if (e.type === "search") add("search", e.query);
          else if (e.type === "fetch") add("fetch", e.url);
          else if (e.type === "probe") add("probe", `${e.domains.join(", ")}: ${e.summary}`);
          else if (e.type === "thinking") setThinking((t) => (t + e.text).slice(-1200));
          else if (e.type === "note") setNotes((t) => t + e.text);
          else if (e.type === "error") {
            add("error", e.message);
            setState("error");
          } else if (e.type === "done") {
            setState("done");
            router.push(`/guides/${e.slug}`);
          }
        }
      }
    })().catch((err) => {
      add("error", String(err));
      setState("error");
    });
  }, [q, force, go, router]);

  if (!q) return <p>Enter an app on the home page.</p>;
  if (!go)
    return (
      <div className="panel p-5 max-w-xl">
        <h1 className="text-xl font-semibold">Re-research {q}?</h1>
        <p className="text-sm text-muted mt-2">
          The agent researches it from scratch (2-4 minutes) and replaces the current guide. It uses one of the site&apos;s 40 live runs for today.
        </p>
        <div className="mt-4 flex gap-3">
          <button type="button" className="btn" onClick={() => setGo(true)}>Re-run the agent</button>
          <button type="button" className="btn-sm" onClick={() => router.back()}>Cancel</button>
        </div>
      </div>
    );
  const at = STAGES.findIndex((x) => x.key === stage);
  const ICON = { phase: "▸", search: "search", fetch: "read", probe: "probe", error: "error" } as const;

  return (
    <div>
      <div className="label">{state === "running" ? `Researching · ${elapsed}s` : state === "done" ? "Done, opening guide" : "Stopped"}</div>
      <h1 className="text-2xl font-semibold mt-1">{q}</h1>
      <p className="text-sm text-muted mt-1">
        Usually done within 3-4 minutes. Keep this tab open: the guide opens here by itself when it is ready.
      </p>
      <ol className="mt-4 flex flex-wrap gap-2 text-sm" aria-label="Progress">
        {STAGES.map((x, n) => {
          const doneStep = state === "done" || n < at;
          const current = state === "running" && n === at;
          return (
            <li key={x.key} aria-current={current ? "step" : undefined} className={`pill ${doneStep ? "d-easy" : current ? "" : "text-muted opacity-60"}`}>
              {doneStep ? "✓" : current ? <span className="animate-pulse">●</span> : n + 1} {x.label}
            </li>
          );
        })}
      </ol>
      {state === "error" && (
        <div className="panel p-4 mt-4 flex flex-wrap items-center gap-3">
          <span className="text-sm">The run stopped before the guide was finished (see the last line below).</span>
          <button type="button" className="btn" onClick={() => window.location.reload()}>Try again</button>
          <Link href="/#library" className="link text-sm">Browse the library</Link>
        </div>
      )}

      <div className="grid md:grid-cols-5 gap-4 mt-6">
        <div className="md:col-span-3 panel p-4">
          <div className="label mb-2">What the agent is doing</div>
          <ol className="space-y-1.5 text-sm">
            {items.map((it, i) => (
              <li key={i} className="flex gap-2 min-w-0">
                <span className={`ev shrink-0 ${it.kind === "probe" ? "ev-tested" : it.kind === "fetch" ? "ev-sourced" : it.kind === "error" ? "ev-inferred" : ""}`}>{ICON[it.kind]}</span>
                <span className={`min-w-0 break-words ${it.kind === "phase" ? "font-semibold" : ""}`}>{it.text}</span>
              </li>
            ))}
            {state === "running" && <li className="text-muted text-sm animate-pulse">working…</li>}
          </ol>
        </div>
        <div className="md:col-span-2 space-y-4">
          <div className="panel p-4">
            <div className="label mb-2">Reasoning (summary)</div>
            <p className="text-xs text-muted whitespace-pre-wrap max-h-64 overflow-auto">{thinking || "…"}</p>
          </div>
          {notes && (
            <div className="panel p-4">
              <div className="label mb-2">Dossier draft</div>
              <pre className="text-[11px] whitespace-pre-wrap max-h-80 overflow-auto mono">{notes.slice(-4000)}</pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
