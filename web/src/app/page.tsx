import { listNodes, getStats, type NodeData } from "@/lib/db";
import { SpaceSidebar } from "@/components/layout/space-sidebar";
import { LiveActivity } from "@/components/nodes/live-activity";

export const dynamic = "force-dynamic";

export default function Home() {
  let spaces: NodeData[] = [];
  let recentActivity: NodeData[] = [];
  let stats = { total: 0, byType: {} as Record<string, number>, byStatus: {} as Record<string, number> };
  let dbError = false;

  try {
    spaces = listNodes({ depth: 0 });
    const types = ["task", "report", "post", "comment", "page"] as const;
    for (const type of types) {
      recentActivity.push(...listNodes({ type, limit: 10 }));
    }
    recentActivity.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    recentActivity = recentActivity.slice(0, 20);
    stats = getStats();
  } catch {
    dbError = true;
  }

  const openTasks = stats.byStatus["open"] ?? 0;
  const inProgress = stats.byStatus["in-progress"] ?? 0;
  const done = stats.byStatus["done"] ?? 0;

  return (
    <div className="flex h-screen bg-stone-50 text-stone-900 overflow-hidden">
      <SpaceSidebar spaces={spaces} dbError={dbError} />

      <main className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <header className="h-14 border-b border-stone-200 flex items-center justify-between px-6 shrink-0 bg-white">
          <h1 className="text-[15px] font-semibold text-stone-900">Overview</h1>
          <span className="font-data text-[11px] text-stone-400">
            {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
          </span>
        </header>

        {/* Stats row */}
        {stats.total > 0 && (
          <div className="border-b border-stone-200 bg-white px-6 py-3">
            <div className="flex items-center gap-6 text-[12px]">
              <Stat label="Nodes" value={stats.total} />
              <Stat label="Open" value={openTasks} className="text-amber-700" />
              <Stat label="Active" value={inProgress} className="text-blue-700" />
              <Stat label="Done" value={done} className="text-emerald-700" />
            </div>
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-y-auto bg-stone-50">
          <div className="max-w-2xl mx-auto py-6 px-6">
            {dbError ? (
              <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-center">
                <p className="text-[13px] text-red-700 font-medium mb-1">Database not connected</p>
                <p className="text-[12px] text-red-500 font-data">
                  Run <code className="bg-red-100 px-1.5 py-0.5 rounded text-[11px]">spacestation setup</code>
                </p>
              </div>
            ) : recentActivity.length === 0 ? (
              <div className="rounded-lg border border-stone-200 bg-white p-8 text-center">
                <p className="text-[13px] text-stone-500 mb-1">No activity yet</p>
                <p className="text-[12px] text-stone-400 font-data">
                  Run <code className="bg-stone-100 px-1.5 py-0.5 rounded text-[11px]">spacestation setup</code>
                </p>
              </div>
            ) : (
              <LiveActivity initialNodes={recentActivity} />
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

function Stat({ label, value, className = "text-stone-900" }: { label: string; value: number; className?: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-stone-400">{label}</span>
      <span className={`font-data font-semibold tabular-nums ${className}`}>{value}</span>
    </div>
  );
}
