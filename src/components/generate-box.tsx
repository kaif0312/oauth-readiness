"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

// `known` lets the box point at an existing guide as you type, so nobody waits 3 minutes for a guide that already exists.
export function GenerateBox({ known = [] }: { known?: { slug: string; app: string }[] }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [hint, setHint] = useState("");
  const needle = q.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split(/[./\s]/)[0];
  const match = needle.length >= 3 ? known.find((k) => k.slug.includes(needle) || k.app.toLowerCase().includes(needle)) : undefined;
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (q.trim().length < 2) return setHint("Type an app name or website first, e.g. Calendly or notion.so.");
        router.push(`/generate?q=${encodeURIComponent(q.trim())}`);
      }}
    >
      <div className="flex flex-col sm:flex-row gap-2">
        <input
          className="input"
          aria-label="App name or website"
          placeholder="App name or website, e.g. Calendly, notion.so, Xero"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setHint("");
          }}
        />
        <button className="btn justify-center whitespace-nowrap shrink-0">Research it</button>
      </div>
      {match && (
        <p className="text-sm">
          Already in the library: <Link className="link" href={`/guides/${match.slug}`}>{match.app} →</Link>
        </p>
      )}
      {hint && <p className="text-sm text-[var(--hard)]">{hint}</p>}
    </form>
  );
}
