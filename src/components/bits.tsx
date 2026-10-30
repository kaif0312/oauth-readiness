import type { Evidence, Guide } from "@/lib/guide";

export function Difficulty({ value }: { value: Guide["verdict"]["difficulty"] }) {
  return <span className={`pill d-${value}`}>{value}</span>;
}

const WHO_LABEL = { agent: "Agent", you: "You", "agent-then-you": "Agent drafts, you submit" } as const;

export function WhoTag({ who }: { who: keyof typeof WHO_LABEL }) {
  return <span className={`pill w-${who}`}>{WHO_LABEL[who]}</span>;
}

// Evidence chip: status plus links to the cited sources.
export function EvidenceTag({ e, guide }: { e: Evidence; guide: Guide }) {
  const cited = e.sourceIds.map((id) => guide.sources.find((s) => s.id === id)).filter((s) => !!s);
  return (
    <span className="inline-flex flex-wrap items-center gap-1 align-middle">
      <span className={`ev ev-${e.status}`} title={e.note ?? undefined}>
        {e.status}
      </span>
      {cited.map((s) => (
        <a key={s.id} href={`#src-${s.id}`} className="ev hover:underline" title={s.title}>
          {s.id}
        </a>
      ))}
    </span>
  );
}
