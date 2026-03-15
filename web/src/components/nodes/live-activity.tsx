"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

interface ActivityNode {
  id: string;
  type: string;
  title: string | null;
  path: string | null;
  author: string | null;
  status: string | null;
  priority: string | null;
  updatedAt: string;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 10) return "now";
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

const TYPE_DOTS: Record<string, string> = {
  task: "bg-amber-500",
  report: "bg-violet-500",
  page: "bg-sky-500",
  post: "bg-stone-400",
  comment: "bg-stone-300",
  space: "bg-stone-700",
};

export function LiveActivity({ initialNodes }: { initialNodes: ActivityNode[] }) {
  const [nodes, setNodes] = useState<ActivityNode[]>(initialNodes);
  const [lastUpdate, setLastUpdate] = useState<string>(new Date().toISOString());
  const [isLive, setIsLive] = useState(true);

  useEffect(() => {
    if (!isLive) return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/activity?limit=20&since=${encodeURIComponent(lastUpdate)}`);
        if (res.ok) {
          const newNodes: ActivityNode[] = await res.json();
          if (newNodes.length > 0) {
            setNodes(prev => {
              const ids = new Set(prev.map(n => n.id));
              const merged = [...prev];
              for (const n of newNodes) {
                if (!ids.has(n.id)) merged.unshift(n);
                else { const idx = merged.findIndex(m => m.id === n.id); if (idx >= 0) merged[idx] = n; }
              }
              return merged.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()).slice(0, 30);
            });
            setLastUpdate(newNodes[0].updatedAt);
          }
        }
      } catch { /* ignore */ }
    }, 10000);
    return () => clearInterval(interval);
  }, [isLive, lastUpdate]);

  const [, setTick] = useState(0);
  useEffect(() => { const t = setInterval(() => setTick(n => n + 1), 30000); return () => clearInterval(t); }, []);

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-[11px] font-medium text-stone-400 uppercase tracking-wider">Activity</h2>
        <button
          onClick={() => setIsLive(l => !l)}
          className="flex items-center gap-1.5 text-[11px] text-stone-400 hover:text-stone-600 transition-colors"
        >
          <div className={`w-1.5 h-1.5 rounded-full ${isLive ? "bg-emerald-500 status-pulse" : "bg-stone-300"}`} />
          {isLive ? "Live" : "Paused"}
        </button>
      </div>

      <div className="bg-white rounded-lg border border-stone-200 divide-y divide-stone-100">
        {nodes.map((node, i) => (
          <Link
            key={node.id}
            href={node.type === "space" ? `/spaces/${node.path}` : `/nodes/${node.id}`}
            className="flex items-center gap-3 px-4 py-2.5 hover:bg-stone-50 transition-colors group animate-fade-up"
            style={{ animationDelay: `${i * 15}ms` }}
          >
            <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${TYPE_DOTS[node.type] ?? "bg-stone-300"}`} />
            <span className="text-[13px] text-stone-600 truncate flex-1 group-hover:text-stone-900 transition-colors">
              {node.title ?? "(untitled)"}
            </span>
            {node.author && (
              <span className="text-[11px] text-stone-400 shrink-0">{node.author}</span>
            )}
            <span className="font-data text-[10px] text-stone-300 shrink-0 w-6 text-right tabular-nums">
              {timeAgo(node.updatedAt)}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
