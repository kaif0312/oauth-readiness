import type { Metadata } from "next";
import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Nav } from "@/components/nav";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "OAuth Readiness",
  description: "How long it really takes to get an OAuth app approved, per provider, with sources, and what an agent can do for you.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <header className="border-b border-line no-print">
          <div className="wrap flex items-center justify-between h-14">
            <Link href="/" className="font-semibold tracking-tight whitespace-nowrap">OAuth Readiness</Link>
            <Nav />
          </div>
        </header>
        <main className="flex-1">{children}</main>
        <footer className="border-t border-line mt-16 no-print">
          <div className="wrap py-6 text-xs text-muted">
            Guides are researched by agents from provider docs, checked against live endpoints where possible, and marked tested / sourced / inferred. Verify before you rely on a wait time.
          </div>
        </footer>
      </body>
    </html>
  );
}
