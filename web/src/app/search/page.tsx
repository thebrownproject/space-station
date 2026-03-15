import { listNodes } from "@/lib/db";
import { SpaceSidebar } from "@/components/layout/space-sidebar";
import { NodeFeed } from "@/components/nodes/node-feed";
import { IconSearch } from "@tabler/icons-react";

export const dynamic = "force-dynamic";

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; type?: string }>;
}) {
  const params = await searchParams;
  const q = params.q ?? "";
  const typeFilter = params.type as string | undefined;
  const spaces = listNodes({ depth: 0 });

  let results: any[] = [];
  if (q) {
    results = listNodes({ search: q, type: typeFilter as any || undefined, limit: 50 });
  }

  return (
    <div className="flex h-screen bg-stone-50 overflow-hidden">
      <SpaceSidebar spaces={spaces} dbError={false} />

      <main className="flex-1 flex flex-col min-w-0">
        <header className="h-14 border-b border-stone-200 flex items-center px-6 shrink-0 bg-white">
          <h1 className="text-[15px] font-semibold text-stone-900">Search</h1>
        </header>

        <div className="border-b border-stone-200 px-6 py-4 bg-white">
          <form action="/search" method="GET" className="flex gap-2 max-w-xl">
            <div className="flex-1 relative">
              <IconSearch size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-300" />
              <input name="q" type="text" defaultValue={q} placeholder="Search nodes..."
                className="w-full bg-stone-50 border border-stone-200 rounded-lg pl-9 pr-3 py-2 text-[13px] placeholder:text-stone-300 focus:outline-none focus:ring-1 focus:ring-stone-300 focus:border-stone-300"
                autoFocus />
            </div>
            <select name="type" defaultValue={typeFilter ?? ""}
              className="bg-stone-50 border border-stone-200 rounded-lg px-3 py-2 text-[13px] text-stone-600">
              <option value="">All types</option>
              <option value="task">Tasks</option>
              <option value="page">Pages</option>
              <option value="report">Reports</option>
              <option value="post">Posts</option>
            </select>
            <button type="submit" className="bg-stone-900 text-white px-4 py-2 rounded-lg text-[13px] font-medium hover:bg-stone-800 transition-colors">
              Search
            </button>
          </form>
        </div>

        <div className="flex-1 overflow-y-auto bg-stone-50">
          <div className="max-w-2xl mx-auto py-6 px-6">
            {q ? (
              <>
                <p className="text-[12px] text-stone-400 mb-3">
                  {results.length} result{results.length !== 1 ? "s" : ""} for &quot;{q}&quot;
                </p>
                {results.length > 0 ? (
                  <NodeFeed nodes={results} />
                ) : (
                  <div className="bg-white border border-stone-200 rounded-lg p-8 text-center">
                    <p className="text-[13px] text-stone-400">No results found</p>
                  </div>
                )}
              </>
            ) : (
              <div className="bg-white border border-stone-200 rounded-lg p-8 text-center">
                <p className="text-[13px] text-stone-400">Enter a search query</p>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
