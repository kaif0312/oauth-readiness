"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { AgentEvent } from "@/lib/agent";

type Item = { kind: "phase" | "search" | "fetch" | "probe" | "error"; text: string; at: number };

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
  const started = useRef(false);

  useEffect(() => {
    if (state !== "running") return;
    const t0 = Date.now();
    const id = setInterval(() => setElapsed(Math.round((Date.now() - t0) / 1000)), 1000);
    return () => clearInterval(id);
  }, [state]);

  useEffect(() => {
    if (!q || started.current) return;
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
          if (e.type === "phase") add("phase", e.text);
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
  }, [q, force, router]);

  if (!q) return <p>Enter an app on the home page.</p>;
  const ICON = { phase: "▸", search: "search", fetch: "read", probe: "probe", error: "error" } as const;

  return (
    <div>
      <div className="label">{state === "running" ? `Researching · ${elapsed}s` : state === "done" ? "Done, opening guide" : "Stopped"}</div>
      <h1 className="text-2xl font-semibold mt-1">{q}</h1>
      <p className="text-sm text-muted mt-1">The agent reads the provider&apos;s docs, tests its OAuth endpoints, re-checks key claims, then writes the guide. Usually 2-4 minutes.</p>

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
