"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { IconPlus } from "@tabler/icons-react";

const NODE_TYPES = ["task", "post", "page", "report", "comment"] as const;
const PRIORITIES = ["low", "medium", "high", "critical"] as const;

interface CreateNodeFormProps {
  parentId?: string;
  parentPath?: string;
}

export function CreateNodeForm({ parentId, parentPath }: CreateNodeFormProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [type, setType] = useState<string>("task");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [author, setAuthor] = useState("");
  const [priority, setPriority] = useState<string>("");
  const [assignee, setAssignee] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/nodes/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type, title, content: content || undefined, author: author || undefined,
          parentId: parentId || undefined, priority: priority || undefined, assignee: assignee || undefined,
        }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error ?? "Failed"); }
      setSuccess(true);
      setTimeout(() => { setSuccess(false); setOpen(false); setTitle(""); setContent(""); window.location.reload(); }, 600);
    } catch (err) { setError(err instanceof Error ? err.message : "Error"); }
    finally { setLoading(false); }
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="flex items-center gap-1.5 text-[12px] text-stone-400 hover:text-stone-600 transition-colors">
        <IconPlus size={14} /> New
      </button>
    );
  }

  return (
    <div className="bg-white border border-stone-200 rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[13px] font-medium text-stone-800">
          New item {parentPath && <span className="text-stone-400 font-normal">in {parentPath}</span>}
        </h3>
        <button onClick={() => setOpen(false)} className="text-stone-400 hover:text-stone-600 text-[12px]">Cancel</button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-2.5">
        <div className="flex gap-1.5">
          {NODE_TYPES.map(t => (
            <button key={t} type="button" onClick={() => setType(t)}
              className={`text-[11px] px-2 py-1 rounded-md border transition-colors capitalize ${
                type === t ? "bg-stone-900 text-white border-stone-900" : "border-stone-200 text-stone-500 hover:border-stone-300"
              }`}>{t}</button>
          ))}
        </div>
        <Input placeholder="Title" value={title} onChange={e => setTitle(e.target.value)} required className="text-[13px]" />
        <Textarea placeholder="Description" value={content} onChange={e => setContent(e.target.value)} rows={2} className="text-[13px] resize-none" />
        <div className="grid grid-cols-2 gap-2">
          <Input placeholder="Author" value={author} onChange={e => setAuthor(e.target.value)} className="text-[13px]" />
          <Input placeholder="Assignee" value={assignee} onChange={e => setAssignee(e.target.value)} className="text-[13px]" />
        </div>
        {type === "task" && (
          <select value={priority} onChange={e => setPriority(e.target.value)} className="w-full border border-stone-200 rounded-md px-3 py-2 text-[13px] text-stone-700 bg-white">
            <option value="">No priority</option>
            {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        )}
        {error && <p className="text-[11px] text-red-600">{error}</p>}
        {success && <p className="text-[11px] text-emerald-600">Created!</p>}
        <div className="flex justify-end">
          <Button type="submit" size="sm" disabled={loading || !title}>{loading ? "Creating..." : "Create"}</Button>
        </div>
      </form>
    </div>
  );
}
