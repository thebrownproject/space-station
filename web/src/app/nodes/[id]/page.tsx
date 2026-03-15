import { getNode, getChildren } from "@/lib/db";
import { listNodes } from "@/lib/db";
import { SpaceSidebar } from "@/components/layout/space-sidebar";
import { NodeFeed } from "@/components/nodes/node-feed";
import { CommentForm } from "@/components/nodes/comment-form";
import Link from "next/link";
import { IconArrowLeft } from "@tabler/icons-react";

export const dynamic = "force-dynamic";

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

const PRIORITY_BADGE: Record<string, string> = {
  critical: "text-red-600 bg-red-50 border-red-200",
  high: "text-orange-600 bg-orange-50 border-orange-200",
  medium: "text-stone-500 bg-stone-50 border-stone-200",
  low: "text-stone-400 bg-stone-50 border-stone-200",
};

const STATUS_DOT: Record<string, string> = {
  open: "bg-amber-500", "in-progress": "bg-blue-500", review: "bg-violet-500",
  done: "bg-emerald-500", closed: "bg-stone-400",
};

export default async function NodePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const spaces = listNodes({ depth: 0 });
  const node = getNode(id);

  if (!node) {
    return (
      <div className="flex h-screen bg-stone-50">
        <SpaceSidebar spaces={spaces} dbError={false} />
        <main className="flex-1 flex items-center justify-center">
          <p className="text-[14px] text-stone-500">Node not found</p>
        </main>
      </div>
    );
  }

  const children = getChildren(node.id);
  const comments = children.filter(n => n.type === "comment");
  const subtasks = children.filter(n => n.type === "task");
  const otherChildren = children.filter(n => n.type !== "comment" && n.type !== "task");

  return (
    <div className="flex h-screen bg-stone-50 overflow-hidden">
      <SpaceSidebar spaces={spaces} dbError={false} />

      <main className="flex-1 flex flex-col min-w-0">
        <header className="h-14 border-b border-stone-200 flex items-center px-6 shrink-0 bg-white gap-3">
          <Link href="/" className="text-stone-400 hover:text-stone-600 transition-colors">
            <IconArrowLeft size={16} />
          </Link>
          {node.path && <span className="text-[12px] text-stone-400 font-data truncate">{node.path}</span>}
        </header>

        <div className="flex-1 overflow-y-auto bg-stone-50">
          <div className="max-w-2xl mx-auto py-8 px-6">
            {/* Title */}
            <div className="mb-6">
              <div className="flex items-center gap-2.5 mb-2 flex-wrap">
                <h1 className="text-xl font-semibold text-stone-900">{node.title ?? "(untitled)"}</h1>
                {node.priority && PRIORITY_BADGE[node.priority] && (
                  <span className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${PRIORITY_BADGE[node.priority]}`}>
                    {node.priority}
                  </span>
                )}
                {node.status && (
                  <div className="flex items-center gap-1.5">
                    <div className={`w-2 h-2 rounded-full ${STATUS_DOT[node.status] ?? "bg-stone-400"}`} />
                    <span className="text-[12px] text-stone-500 capitalize">{node.status}</span>
                  </div>
                )}
              </div>

              {/* Metadata */}
              <div className="flex flex-wrap gap-4 text-[12px] text-stone-500 mt-3">
                <span className="capitalize">{node.type}</span>
                {node.author && <span>by <strong className="text-stone-700">{node.author}</strong></span>}
                {node.assignee && <span>for <strong className="text-stone-700">{node.assignee}</strong></span>}
                <span>{timeAgo(node.updatedAt)}</span>
              </div>

              {node.tags.length > 0 && (
                <div className="flex gap-1.5 mt-3">
                  {node.tags.map(tag => (
                    <span key={tag} className="text-[11px] text-stone-500 bg-stone-100 px-2 py-0.5 rounded-full border border-stone-200">
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Content */}
            {node.content && (
              <div className="mb-8 bg-white border border-stone-200 rounded-lg p-5 text-[13px] text-stone-700 leading-relaxed whitespace-pre-wrap">
                {node.content}
              </div>
            )}

            {subtasks.length > 0 && (
              <div className="mb-6">
                <h2 className="text-[11px] font-medium text-stone-400 uppercase tracking-wider mb-2">Subtasks</h2>
                <NodeFeed nodes={subtasks} />
              </div>
            )}

            {otherChildren.length > 0 && (
              <div className="mb-6">
                <h2 className="text-[11px] font-medium text-stone-400 uppercase tracking-wider mb-2">Related</h2>
                <NodeFeed nodes={otherChildren} />
              </div>
            )}

            {comments.length > 0 && (
              <div>
                <h2 className="text-[11px] font-medium text-stone-400 uppercase tracking-wider mb-2">Comments ({comments.length})</h2>
                <div className="space-y-2">
                  {comments.map(c => (
                    <div key={c.id} className="flex gap-3 bg-white border border-stone-200 rounded-lg p-3">
                      <div className="w-6 h-6 rounded-full bg-stone-100 flex items-center justify-center text-[10px] font-medium text-stone-500 shrink-0">
                        {(c.author ?? "?")[0].toUpperCase()}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-[12px] font-medium text-stone-700">{c.author ?? "unknown"}</span>
                          <span className="text-[10px] text-stone-300">{timeAgo(c.updatedAt)}</span>
                        </div>
                        <p className="text-[12px] text-stone-600 mt-0.5 leading-relaxed whitespace-pre-wrap">{c.content}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <CommentForm parentId={node.id} />

            <div className="mt-8 pt-3 border-t border-stone-100">
              <p className="font-data text-[10px] text-stone-300">{node.id}</p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
