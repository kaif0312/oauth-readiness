"use client";

import { useState } from "react";

export function PrintButton() {
  const [copied, setCopied] = useState(false);
  return (
    <span className="inline-flex gap-2">
      <button
        type="button"
        className="btn-sm"
        onClick={() => {
          navigator.clipboard?.writeText(window.location.href).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          });
        }}
      >
        {copied ? "Link copied ✓" : "Copy link"}
      </button>
      <button type="button" className="btn-sm" onClick={() => window.print()}>Print / PDF</button>
    </span>
  );
}
