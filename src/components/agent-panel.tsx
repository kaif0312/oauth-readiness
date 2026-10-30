"use client";

import { useState } from "react";
import type { Install } from "@/lib/install";

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="btn-sm"
      onClick={() =>
        navigator.clipboard?.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        })
      }
    >
      {copied ? "Copied ✓" : label}
    </button>
  );
}

function Code({ text, prose }: { text: string; prose?: boolean }) {
  return (
    <div className="relative">
      <pre className={`${prose ? "font-sans text-sm leading-relaxed" : "mono text-[13px]"} bg-soft rounded-lg p-3 pr-20 whitespace-pre-wrap [overflow-wrap:anywhere]`}>{text}</pre>
      <div className="absolute top-2 right-2"><CopyButton text={text} /></div>
    </div>
  );
}

// Two steps a developer can follow without reading anything else: 1 connect the MCP, 2 paste the prompt.
export function AgentPanel({ installs, prompt, title, compact }: { installs: Install[]; prompt: string; title: string; compact?: boolean }) {
  const [tab, setTab] = useState(0);
  const i = installs[tab];
  return (
    <section id="agent" className="panel p-4 sm:p-5 no-print scroll-mt-4">
      <h2 className="font-semibold">{title}</h2>
      <p className="text-sm text-muted mt-1">
        Your agent fills the provider&apos;s forms in your own browser and stops where you must sign in, accept terms or submit. Free, no sign-up.
      </p>
      <ol className={`mt-4 grid gap-4 ${compact ? "" : "md:grid-cols-2"}`}>
        <li>
          <div className="text-sm font-semibold mb-2"><span className="step-n">1</span>Connect the MCP server</div>
          <div role="tablist" aria-label="Coding agent" className="flex flex-wrap gap-1 mb-2">
            {installs.map((x, n) => (
              <button key={x.client} role="tab" type="button" aria-selected={n === tab} className={`tab ${n === tab ? "tab-on" : ""}`} onClick={() => setTab(n)}>
                {x.client}
              </button>
            ))}
          </div>
          <Code text={i.code} />
          <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted">
            <span>{i.where === "terminal" ? "Run in your terminal" : <>Add to <span className="mono">{i.where}</span></>}</span>
            {i.link && <a className="link" href={i.link.href}>{i.link.label} (one click)</a>}
          </div>
        </li>
        <li>
          <div className="text-sm font-semibold mb-2"><span className="step-n">2</span>Paste this into your agent</div>
          <Code text={prompt} prose />
        </li>
      </ol>
    </section>
  );
}
