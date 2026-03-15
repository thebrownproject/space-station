"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { IconPlus } from "@tabler/icons-react";

const NODE_TYPES = ["task", "post", "page", "report"] as const;
const PRIORITIES = ["low", "medium", "high", "critical"] as const;

interface Space { id: string; title: string | null; path: string | null; }

export function QuickCreate() {
  const [open, setOpen] = useState(false);
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [type, setType] = useState<string>("task");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [parentId, setParentId] = useState<string>("");
  const [author, setAuthor] = useState("");
  const [priority, setPriority] = useState<string>("");
  const [assignee, setAssignee] = useState("");

  useEffect(() => {
    if (!open) return;
    fetch("/api/nodes?depth=0&limit=50").then(r => r.json()).then(d => { if (Array.isArray(d)) setSpaces(d); }).catch(() => {});
  }, [open]);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "n") { e.preventDefault(); setOpen(true); }
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/nodes/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type, title: title.trim(), content: content.trim() || undefined,
          parentId: parentId || undefined, author: author.trim() || undefined,
          priority: priority || undefined, assignee: assignee.trim() || undefined,
        }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error ?? "Failed"); }
      setSuccess(true);
      setTimeout(() => { setOpen(false); setSuccess(false); setTitle(""); setContent(""); window.location.reload(); }, 600);
    } catch (err) { setError(err instanceof Error ? err.message : "Error"); }
    finally { setLoading(false); }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-40 w-10 h-10 rounded-full bg-stone-900 text-white shadow-lg hover:bg-stone-800 transition-colors flex items-center justify-center"
        title="Create (Cmd+N)"
      >
        <IconPlus size={18} />
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={() => setOpen(false)}>
          <div className="absolute inset-0 bg-black/15 backdrop-blur-sm" />
          <div className="relative w-full max-w-md bg-white border border-stone-200 rounded-xl shadow-xl p-5" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-[14px] font-semibold text-stone-900">Create</h2>
              <button onClick={() => setOpen(false)} className="text-stone-400 hover:text-stone-600 text-[12px]">Cancel</button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-3">
              <div className="flex gap-1.5">
                {NODE_TYPES.map(t => (
                  <button key={t} type="button" onClick={() => setType(t)}
                    className={`text-[12px] px-2.5 py-1 rounded-md border transition-colors capitalize ${
                      type === t ? "bg-stone-900 text-white border-stone-900" : "border-stone-200 text-stone-500 hover:border-stone-300"
                    }`}>{t}</button>
                ))}
              </div>

              <Input placeholder="Title" value={title} onChange={e => setTitle(e.target.value)} required autoFocus className="text-[13px]" />
              <Textarea placeholder="Description (optional)" value={content} onChange={e => setContent(e.target.value)} rows={2} className="text-[13px] resize-none" />

              <select value={parentId} onChange={e => setParentId(e.target.value)} className="w-full border border-stone-200 rounded-md px-3 py-2 text-[13px] text-stone-700 bg-white">
                <option value="">No parent</option>
                {spaces.map(s => <option key={s.id} value={s.id}>#{(s.title ?? s.path ?? "").toLowerCase()}</option>)}
              </select>

              <div className="grid grid-cols-2 gap-2">
                <Input placeholder="Author" value={author} onChange={e => setAuthor(e.target.value)} className="text-[13px]" />
                <Input placeholder="Assignee" value={assignee} onChange={e => setAssignee(e.target.value)} className="text-[13px]" />
              </div>

              {type === "task" && (
                <select value={priority} onChange={e => setPriority(e.target.value)} className="w-full border border-stone-200 rounded-md px-3 py-2 text-[13px] text-stone-700 bg-white">
                  <option value="">No priority</option>
                  {PRIORITIES.map(p => <option key={p} value={p} className="capitalize">{p}</option>)}
                </select>
              )}

              {error && <p className="text-[12px] text-red-600">{error}</p>}
              {success && <p className="text-[12px] text-emerald-600">Created!</p>}

              <div className="flex justify-end">
                <Button type="submit" size="sm" disabled={loading || !title.trim()}>
                  {loading ? "Creating..." : "Create"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
