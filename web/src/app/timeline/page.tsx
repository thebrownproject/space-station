import { listNodes, type NodeData } from "@/lib/db";
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

const TYPE_DOTS: Record<string, string> = {
  task: "bg-amber-500", report: "bg-violet-500", page: "bg-sky-500",
  post: "bg-stone-400", comment: "bg-stone-300", space: "bg-stone-700",
};

function groupByDate(nodes: NodeData[]): Map<string, NodeData[]> {
  const groups = new Map<string, NodeData[]>();
  for (const node of nodes) {
    const date = new Date(node.updatedAt).toLocaleDateString("en-US", {
      weekday: "long", month: "short", day: "numeric",
    });
    if (!groups.has(date)) groups.set(date, []);
    groups.get(date)!.push(node);
  }
  return groups;
}

export default function TimelinePage() {
  const spaces = listNodes({ depth: 0 });

  // Get all recent items
  const types = ["task", "report", "post", "comment", "page", "space"] as const;
  const all: NodeData[] = [];
  for (const type of types) {
    all.push(...listNodes({ type, limit: 50 }));
  }
  all.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  const timeline = all.slice(0, 100);
  const grouped = groupByDate(timeline);

  return (
    <div className="flex h-screen bg-stone-50 overflow-hidden">
      <SpaceSidebar spaces={spaces} dbError={false} />
      <AutoRefresh interval={30} />

      <main className="flex-1 flex flex-col min-w-0">
        <header className="h-14 border-b border-stone-200 flex items-center px-6 shrink-0 bg-white">
          <h1 className="text-[15px] font-semibold text-stone-900">Timeline</h1>
        </header>

        <div className="flex-1 overflow-y-auto bg-stone-50">
          <div className="max-w-2xl mx-auto py-6 px-6">
            {grouped.size === 0 ? (
              <div className="bg-white border border-stone-200 rounded-lg p-8 text-center">
                <p className="text-[13px] text-stone-400">No activity yet</p>
              </div>
            ) : (
              <div className="relative">
                {/* Timeline line */}
                <div className="absolute left-[11px] top-6 bottom-0 w-px bg-stone-200" />

                {Array.from(grouped.entries()).map(([date, nodes]) => (
                  <div key={date} className="mb-6">
                    {/* Date header */}
                    <div className="flex items-center gap-3 mb-3 relative">
                      <div className="w-6 h-6 rounded-full bg-white border-2 border-stone-200 flex items-center justify-center z-10">
                        <div className="w-2 h-2 rounded-full bg-stone-400" />
                      </div>
                      <span className="text-[12px] font-medium text-stone-600">{date}</span>
                      <span className="text-[11px] text-stone-300 font-data">{nodes.length} events</span>
                    </div>

                    {/* Events */}
                    <div className="ml-[23px] pl-4 border-l border-stone-200 space-y-1">
                      {nodes.map(node => (
                        <Link
                          key={node.id}
                          href={node.type === "space" ? `/spaces/${node.path}` : `/nodes/${node.id}`}
                          className="flex items-center gap-3 px-3 py-2 rounded-md hover:bg-white hover:shadow-sm transition-all group"
                        >
                          <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${TYPE_DOTS[node.type] ?? "bg-stone-300"}`} />
                          <div className="flex-1 min-w-0">
                            <span className="text-[13px] text-stone-600 group-hover:text-stone-900 transition-colors truncate block">
                              {node.title ?? node.content?.slice(0, 60) ?? "(untitled)"}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            {node.author && (
                              <span className="text-[11px] text-stone-400">{node.author}</span>
                            )}
                            <span className="text-[10px] text-stone-300 font-data">
                              {new Date(node.updatedAt).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
                            </span>
                          </div>
                        </Link>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
