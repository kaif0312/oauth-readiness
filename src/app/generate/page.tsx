import { Suspense } from "react";
import { LiveRun } from "@/components/live-run";

export const metadata = { title: "Generating guide" };

export default function GeneratePage() {
  return (
    <div className="wrap py-10">
      <Suspense>
        <LiveRun />
      </Suspense>
    </div>
  );
}
