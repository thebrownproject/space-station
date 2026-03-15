import Link from "next/link";
import { type NodeData } from "@/lib/db";

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "now";
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

const PRIORITY_LABELS: Record<string, { text: string; className: string }> = {
  critical: { text: "Critical", className: "text-red-600 bg-red-50 border-red-200" },
  high: { text: "High", className: "text-orange-600 bg-orange-50 border-orange-200" },
  medium: { text: "Medium", className: "text-stone-500 bg-stone-50 border-stone-200" },
  low: { text: "Low", className: "text-stone-400 bg-stone-50 border-stone-200" },
};

const STATUS_LABELS: Record<string, { text: string; className: string }> = {
  open: { text: "Open", className: "text-amber-700 bg-amber-50 border-amber-200" },
  "in-progress": { text: "Active", className: "text-blue-700 bg-blue-50 border-blue-200" },
  review: { text: "Review", className: "text-violet-700 bg-violet-50 border-violet-200" },
  done: { text: "Done", className: "text-emerald-700 bg-emerald-50 border-emerald-200" },
  closed: { text: "Closed", className: "text-stone-400 bg-stone-50 border-stone-200" },
};

function NodeCard({ node }: { node: NodeData }) {
  const dot = TYPE_DOTS[node.type] ?? "bg-stone-300";

  return (
    <div className="bg-white border border-stone-200 rounded-lg p-4 card-hover">
      <div className="flex items-start gap-3">
        <div className={`w-2 h-2 rounded-full shrink-0 mt-1.5 ${dot}`} />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Link
              href={`/nodes/${node.id}`}
              className="text-[13px] font-medium text-stone-900 hover:text-stone-600 transition-colors"
            >
              {node.title ?? "(untitled)"}
            </Link>
            {node.priority && PRIORITY_LABELS[node.priority] && (
              <span className={`text-[10px] px-1.5 py-0 rounded-full border font-medium ${PRIORITY_LABELS[node.priority].className}`}>
                {PRIORITY_LABELS[node.priority].text}
              </span>
            )}
            {node.status && STATUS_LABELS[node.status] && (
              <span className={`text-[10px] px-1.5 py-0 rounded-full border font-medium ${STATUS_LABELS[node.status].className}`}>
                {STATUS_LABELS[node.status].text}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 mt-1 text-[11px] text-stone-400">
            <span className="capitalize">{node.type}</span>
            {node.author && (
              <>
                <span className="text-stone-200">by</span>
                <span className="text-stone-500">{node.author}</span>
              </>
            )}
            {node.assignee && (
              <>
                <span className="text-stone-200">for</span>
                <span className="text-stone-500">{node.assignee}</span>
              </>
            )}
            <span className="ml-auto font-data text-stone-300">{timeAgo(node.updatedAt)}</span>
          </div>

          {node.content && (
            <p className="mt-2 text-[12px] text-stone-500 line-clamp-2 leading-relaxed">
              {node.content}
            </p>
          )}

          {node.tags.length > 0 && (
            <div className="flex gap-1 mt-2">
              {node.tags.map((tag) => (
                <span key={tag} className="text-[10px] font-data text-stone-400 bg-stone-50 px-1.5 py-0 rounded border border-stone-100">
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function NodeFeed({ nodes }: { nodes: NodeData[] }) {
  return (
    <div className="space-y-2">
      {nodes.map((node, i) => (
        <div key={node.id} className="animate-fade-up" style={{ animationDelay: `${i * 20}ms` }}>
          <NodeCard node={node} />
        </div>
      ))}
    </div>
  );
}
