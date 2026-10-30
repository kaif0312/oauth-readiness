"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Guides", match: (p: string) => p === "/" || p.startsWith("/guides") || p.startsWith("/generate") },
  { href: "/#agent", label: "Use with your agent", short: "Agent", match: () => false },
  { href: "/method", label: "Method", match: (p: string) => p.startsWith("/method") },
];

export function Nav() {
  const path = usePathname();
  return (
    <nav className="flex gap-4 sm:gap-5 text-sm text-muted whitespace-nowrap">
      {LINKS.map((l) => (
        <Link key={l.href} href={l.href} className="nav-link hover:text-ink" aria-current={l.match(path) ? "page" : undefined}>
          {l.short ? (
            <>
              <span className="sm:hidden">{l.short}</span>
              <span className="hidden sm:inline">{l.label}</span>
            </>
          ) : (
            l.label
          )}
        </Link>
      ))}
    </nav>
  );
}
