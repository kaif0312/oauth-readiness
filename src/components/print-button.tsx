"use client";

import { useState } from "react";

export function PrintButton() {
  const [copied, setCopied] = useState(false);
  return (
    <span className="inline-flex gap-3">
      <button
        className="link"
        onClick={() => {
          navigator.clipboard?.writeText(window.location.href).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          });
        }}
      >
        {copied ? "Link copied" : "Copy link"}
      </button>
      <button className="link" onClick={() => window.print()}>Print / PDF</button>
    </span>
  );
}
