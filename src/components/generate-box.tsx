"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function GenerateBox() {
  const router = useRouter();
  const [q, setQ] = useState("");
  return (
    <form
      className="flex flex-col sm:flex-row gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (q.trim().length >= 2) router.push(`/generate?q=${encodeURIComponent(q.trim())}`);
      }}
    >
      <input className="input" placeholder="App name or website, e.g. Calendly, notion.so, Xero" value={q} onChange={(e) => setQ(e.target.value)} />
      <button className="btn justify-center whitespace-nowrap shrink-0" disabled={q.trim().length < 2}>Generate guide</button>
    </form>
  );
}
