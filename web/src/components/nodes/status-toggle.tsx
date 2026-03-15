"use client";

import { useState } from "react";

const STATUS_FLOW = ["open", "in-progress", "review", "done", "closed"] as const;

const STATUS_STYLES: Record<string, { dot: string; label: string }> = {
  open: { dot: "bg-amber-500", label: "Open" },
  "in-progress": { dot: "bg-blue-500", label: "Active" },
  review: { dot: "bg-violet-500", label: "Review" },
  done: { dot: "bg-emerald-500", label: "Done" },
  closed: { dot: "bg-stone-400", label: "Closed" },
};

export function StatusToggle({ nodeId, currentStatus }: { nodeId: string; currentStatus: string | null }) {
  const [status, setStatus] = useState(currentStatus ?? "open");
  const [loading, setLoading] = useState(false);

  async function cycleStatus() {
    const currentIdx = STATUS_FLOW.indexOf(status as typeof STATUS_FLOW[number]);
    const nextIdx = (currentIdx + 1) % STATUS_FLOW.length;
    const nextStatus = STATUS_FLOW[nextIdx];
    setLoading(true);
    try {
      const res = await fetch("/api/nodes/update", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: nodeId, status: nextStatus }),
      });
      if (res.ok) setStatus(nextStatus);
    } finally { setLoading(false); }
  }

  const style = STATUS_STYLES[status] ?? STATUS_STYLES.open;

  return (
    <button
      onClick={cycleStatus}
      disabled={loading}
      className="flex items-center gap-1.5 text-[11px] px-2 py-0.5 rounded-md border border-stone-200 hover:border-stone-300 transition-colors disabled:opacity-50 text-stone-500"
      title="Click to change status"
    >
      <div className={`w-1.5 h-1.5 rounded-full ${style.dot} ${loading ? "animate-pulse" : ""}`} />
      {style.label}
    </button>
  );
}
