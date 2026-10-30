import { generateGuide, type AgentEvent } from "@/lib/agent";
import { getGuide, saveGuide, slugify, takeGenerationSlot } from "@/lib/store";

export const maxDuration = 300;

// POST { query, force? } -> text/event-stream of AgentEvent lines.
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { query?: string; force?: boolean };
  const query = (body.query ?? "").trim().slice(0, 120);
  if (query.length < 2) return Response.json({ error: "Enter an app name or website." }, { status: 400 });
  const slug = slugify(query);
  if (!slug) return Response.json({ error: "Could not make a slug from that name." }, { status: 400 });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (e: AgentEvent) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
      try {
        const existing = body.force ? null : await getGuide(slug);
        if (existing) {
          emit({ type: "phase", phase: "save", text: "A guide for this app already exists" });
          emit({ type: "done", slug });
          return;
        }
        if (!(await takeGenerationSlot())) {
          emit({ type: "error", message: "Today's limit of live generations is used up. Try again tomorrow, or browse the library." });
          return;
        }
        const guide = await generateGuide(query, slug, emit);
        emit({ type: "phase", phase: "save", text: "Saving" });
        await saveGuide(guide);
        emit({ type: "done", slug });
      } catch (err) {
        emit({ type: "error", message: err instanceof Error ? err.message : String(err) });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", "x-accel-buffering": "no" },
  });
}
