"use client";

import Link from "next/link";
import { type NodeData } from "@/lib/db";
import { StatusToggle } from "./status-toggle";

const COLUMNS = [
  { key: "open", label: "Open", color: "border-amber-400", dot: "bg-amber-500" },
  { key: "in-progress", label: "Active", color: "border-blue-400", dot: "bg-blue-500" },
  { key: "review", label: "Review", color: "border-violet-400", dot: "bg-violet-500" },
  { key: "done", label: "Done", color: "border-emerald-400", dot: "bg-emerald-500" },
] as const;

const PRIORITY_BADGE: Record<string, string> = {
  critical: "text-red-600 bg-red-50 border-red-200",
  high: "text-orange-600 bg-orange-50 border-orange-200",
  medium: "text-stone-500 bg-stone-50 border-stone-200",
  low: "text-stone-400 bg-stone-50 border-stone-200",
};

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function TaskCard({ task }: { task: NodeData }) {
  return (
    <div className="bg-white border border-stone-200 rounded-lg p-3 card-hover group">
      <div className="flex items-start justify-between gap-2">
        <Link href={`/nodes/${task.id}`} className="text-[12px] font-medium text-stone-800 hover:text-stone-600 transition-colors line-clamp-2 leading-snug">
          {task.title}
        </Link>
        {task.priority && PRIORITY_BADGE[task.priority] && (
          <span className={`text-[9px] px-1.5 py-0 rounded-full border shrink-0 font-medium ${PRIORITY_BADGE[task.priority]}`}>
            {task.priority}
          </span>
        )}
      </div>
      <div className="mt-2 flex items-center justify-between text-[10px] text-stone-400">
        <div className="flex items-center gap-1">
          {task.author && <span>{task.author}</span>}
          {task.assignee && <><span className="text-stone-200">/</span><span>{task.assignee}</span></>}
        </div>
        <span className="font-data">{timeAgo(task.updatedAt)}</span>
      </div>
      <div className="mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
        <StatusToggle nodeId={task.id} currentStatus={task.status} />
      </div>
    </div>
  );
}

export function KanbanBoard({ tasks }: { tasks: NodeData[] }) {
  const grouped: Record<string, NodeData[]> = {};
  for (const col of COLUMNS) grouped[col.key] = tasks.filter(t => t.status === col.key);

  return (
    <div className="flex gap-4 p-6 min-w-max h-full">
      {COLUMNS.map(col => (
        <div key={col.key} className={`w-64 shrink-0 flex flex-col border-t-2 ${col.color}`}>
          <div className="flex items-center gap-2 py-3 px-1">
            <div className={`w-2 h-2 rounded-full ${col.dot}`} />
            <span className="text-[12px] font-medium text-stone-600">{col.label}</span>
            <span className="text-[10px] font-data text-stone-300 ml-auto">{grouped[col.key].length}</span>
          </div>
          <div className="space-y-2 flex-1 overflow-y-auto pb-4">
            {grouped[col.key].map(task => <TaskCard key={task.id} task={task} />)}
            {grouped[col.key].length === 0 && (
              <div className="text-[11px] text-stone-300 text-center py-8 border border-dashed border-stone-200 rounded-lg">
                No tasks
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
