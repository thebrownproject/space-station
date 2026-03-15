import { listNodes } from "@/lib/db";
import { SpaceSidebar } from "@/components/layout/space-sidebar";
import { AutoRefresh } from "@/components/layout/auto-refresh";
import Link from "next/link";

export const dynamic = "force-dynamic";

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function BriefingPage() {
  const spaces = listNodes({ depth: 0 });

  // Gather data
  const types = ["task", "report", "post", "comment", "page", "space"] as const;
  const all: any[] = [];
  for (const type of types) {
    all.push(...listNodes({ type, limit: 500 }));
  }

  const tasks = all.filter(n => n.type === "task");
  const openTasks = tasks.filter(t => t.status === "open");
  const inProgress = tasks.filter(t => t.status === "in-progress");
  const done = tasks.filter(t => t.status === "done");
  const critical = tasks.filter(t => t.priority === "critical" && t.status !== "done" && t.status !== "closed");
  const reports = all.filter(n => n.type === "report");

  const dayAgo = new Date(Date.now() - 86400000).toISOString();
  const recentCreated = all.filter(n => n.createdAt > dayAgo);
  const recentUpdated = all.filter(n => n.updatedAt > dayAgo);
  const activeAuthors = [...new Set(recentUpdated.filter(n => n.author).map(n => n.author))];

  const twoDaysAgo = new Date(Date.now() - 172800000).toISOString();
  const staleTasks = tasks.filter(t =>
    (t.status === "open" || t.status === "in-progress") && t.updatedAt < twoDaysAgo
  );

  return (
    <div className="flex h-screen bg-stone-50 overflow-hidden">
      <SpaceSidebar spaces={spaces} dbError={false} />
      <AutoRefresh interval={30} />

      <main className="flex-1 flex flex-col min-w-0">
        <header className="h-14 border-b border-stone-200 flex items-center px-6 shrink-0 bg-white">
          <h1 className="text-[15px] font-semibold text-stone-900">Mission Briefing</h1>
        </header>

        <div className="flex-1 overflow-y-auto bg-stone-50">
          <div className="max-w-3xl mx-auto py-8 px-6">

            {/* Key Metrics */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
              <MetricCard label="Open Tasks" value={openTasks.length} color="text-amber-600" />
              <MetricCard label="In Progress" value={inProgress.length} color="text-blue-600" />
              <MetricCard label="Critical" value={critical.length} color={critical.length > 0 ? "text-red-600" : "text-emerald-600"} />
              <MetricCard label="Done (24h)" value={done.filter(t => t.updatedAt > dayAgo).length} color="text-emerald-600" />
            </div>

            {/* Critical Items */}
            {critical.length > 0 && (
              <div className="mb-6">
                <h2 className="text-[11px] font-medium text-red-600 uppercase tracking-wider mb-3 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                  Critical Items
                </h2>
                <div className="space-y-2">
                  {critical.map(t => (
                    <Link
                      key={t.id}
                      href={`/nodes/${t.id}`}
                      className="flex items-center justify-between p-3 rounded-lg bg-white border border-red-200 hover:border-red-300 transition-colors"
                    >
                      <span className="text-[13px] font-medium text-stone-900">{t.title}</span>
                      {t.assignee && <span className="text-[12px] text-stone-400">{t.assignee}</span>}
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {/* Active Agents */}
            {activeAuthors.length > 0 && (
              <div className="mb-6">
                <h2 className="text-[11px] font-medium text-stone-400 uppercase tracking-wider mb-3">
                  Active Agents (24h)
                </h2>
                <div className="flex gap-2 flex-wrap">
                  {activeAuthors.map(a => (
                    <div key={a} className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-white border border-stone-200">
                      <div className="w-2 h-2 rounded-full bg-emerald-500" />
                      <span className="text-[13px] text-stone-700">{a}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 24h Activity */}
            <div className="mb-6">
              <h2 className="text-[11px] font-medium text-stone-400 uppercase tracking-wider mb-3">
                Last 24 Hours
              </h2>
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-white border border-stone-200 rounded-md p-3 text-center">
                  <div className="text-2xl font-bold font-data text-stone-800">{recentCreated.length}</div>
                  <div className="text-[10px] text-stone-400 uppercase">Created</div>
                </div>
                <div className="bg-white border border-stone-200 rounded-md p-3 text-center">
                  <div className="text-2xl font-bold font-data text-stone-800">{recentUpdated.length}</div>
                  <div className="text-[10px] text-stone-400 uppercase">Updated</div>
                </div>
                <div className="bg-white border border-stone-200 rounded-md p-3 text-center">
                  <div className="text-2xl font-bold font-data text-stone-800">{reports.filter(r => r.createdAt > dayAgo).length}</div>
                  <div className="text-[10px] text-stone-400 uppercase">Reports</div>
                </div>
              </div>
            </div>

            {/* Stale Tasks */}
            {staleTasks.length > 0 && (
              <div className="mb-6">
                <h2 className="text-[11px] font-medium text-amber-600 uppercase tracking-wider mb-3">
                  Stale Tasks (48h+ inactive)
                </h2>
                <div className="space-y-2">
                  {staleTasks.map(t => (
                    <Link
                      key={t.id}
                      href={`/nodes/${t.id}`}
                      className="flex items-center justify-between p-3 rounded-lg bg-white border border-amber-200 hover:border-amber-300 transition-colors"
                    >
                      <span className="text-[13px] text-stone-900">{t.title}</span>
                      <span className="text-[11px] text-stone-400">{timeAgo(t.updatedAt)}</span>
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {/* Total stats */}
            <div className="text-[12px] text-stone-400 text-center mt-8">
              {all.length} total nodes across {spaces.length} spaces
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

function MetricCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="bg-white border border-stone-200 rounded-lg p-4 text-center">
      <div className={`text-3xl font-bold font-data tabular-nums ${color}`}>{value}</div>
      <div className="text-[10px] text-stone-400 uppercase tracking-wider mt-1">{label}</div>
    </div>
  );
}
