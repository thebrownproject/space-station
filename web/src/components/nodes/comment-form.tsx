"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";

export function CommentForm({ parentId }: { parentId: string }) {
  const [content, setContent] = useState("");
  const [author, setAuthor] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!content.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/nodes/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "comment", title: null, content: content.trim(), author: author.trim() || "anonymous", parentId }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error ?? "Failed"); }
      setContent("");
      window.location.reload();
    } catch (err) { setError(err instanceof Error ? err.message : "Error"); }
    finally { setLoading(false); }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-4 bg-white border border-stone-200 rounded-lg p-3">
      <Textarea placeholder="Write a comment..." value={content} onChange={e => setContent(e.target.value)} rows={2} className="text-[13px] resize-none border-stone-200 mb-2" />
      <div className="flex items-center gap-2">
        <Input placeholder="Your name" value={author} onChange={e => setAuthor(e.target.value)} className="text-[13px] w-36 border-stone-200" />
        {error && <span className="text-[11px] text-red-600">{error}</span>}
        <Button type="submit" size="sm" disabled={loading || !content.trim()} className="ml-auto">
          {loading ? "Posting..." : "Comment"}
        </Button>
      </div>
    </form>
  );
}
