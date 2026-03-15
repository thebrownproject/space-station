"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { IconSearch } from "@tabler/icons-react";

interface SearchResult {
  id: string;
  type: string;
  title: string | null;
  path: string | null;
  author: string | null;
  status: string | null;
}

const TYPE_DOTS: Record<string, string> = {
  space: "bg-stone-700", task: "bg-amber-500", page: "bg-sky-500",
  report: "bg-violet-500", post: "bg-stone-400", comment: "bg-stone-300",
};

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selected, setSelected] = useState(0);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen(prev => !prev);
        setQuery("");
        setResults([]);
        setSelected(0);
      }
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    if (!query || query.length < 2) { setResults([]); return; }
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/nodes/search?q=${encodeURIComponent(query)}&limit=10`);
        if (res.ok) { setResults(await res.json()); setSelected(0); }
      } catch { /* ignore */ }
      finally { setLoading(false); }
    }, 200);
    return () => clearTimeout(timer);
  }, [query]);

  const navigate = useCallback((result: SearchResult) => {
    setOpen(false);
    router.push(result.type === "space" && result.path ? `/spaces/${result.path}` : `/nodes/${result.id}`);
  }, [router]);

  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "ArrowDown") { e.preventDefault(); setSelected(prev => Math.min(prev + 1, results.length - 1)); }
      else if (e.key === "ArrowUp") { e.preventDefault(); setSelected(prev => Math.max(prev - 1, 0)); }
      else if (e.key === "Enter" && results[selected]) { e.preventDefault(); navigate(results[selected]); }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, results, selected, navigate]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh]" onClick={() => setOpen(false)}>
      <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" />

      <div
        className="relative w-full max-w-lg bg-white border border-stone-200 rounded-xl shadow-xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center border-b border-stone-100 px-4">
          <IconSearch size={15} className="text-stone-300 mr-2" />
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search..."
            className="flex-1 bg-transparent py-3 text-[14px] outline-none placeholder:text-stone-300 text-stone-900"
            autoFocus
          />
          <kbd className="text-[10px] text-stone-300 bg-stone-50 px-1.5 py-0.5 rounded border border-stone-100 font-data">esc</kbd>
        </div>

        {results.length > 0 && (
          <div className="max-h-72 overflow-y-auto py-1">
            {results.map((result, i) => (
              <button
                key={result.id}
                onClick={() => navigate(result)}
                className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                  i === selected ? "bg-stone-50" : "hover:bg-stone-50"
                }`}
              >
                <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${TYPE_DOTS[result.type] ?? "bg-stone-300"}`} />
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] text-stone-800 truncate">{result.title ?? "(untitled)"}</div>
                  <div className="text-[11px] text-stone-400 truncate">{result.path}</div>
                </div>
              </button>
            ))}
          </div>
        )}

        {query.length >= 2 && results.length === 0 && !loading && (
          <div className="py-8 text-center text-[13px] text-stone-400">No results</div>
        )}

        {query.length < 2 && (
          <div className="py-1">
            {[
              { label: "Overview", path: "/" },
              { label: "Briefing", path: "/briefing" },
              { label: "Board", path: "/board" },
              { label: "Agents", path: "/agents" },
            ].map(link => (
              <button
                key={link.path}
                onClick={() => { setOpen(false); router.push(link.path); }}
                className="w-full flex items-center gap-3 px-4 py-2 text-left hover:bg-stone-50 transition-colors text-[13px] text-stone-500"
              >
                {link.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
