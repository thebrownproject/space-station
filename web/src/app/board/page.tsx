import { listNodes } from "@/lib/db";
import { SpaceSidebar } from "@/components/layout/space-sidebar";
import { KanbanBoard } from "@/components/nodes/kanban-board";
import { AutoRefresh } from "@/components/layout/auto-refresh";

export const dynamic = "force-dynamic";

export default function BoardPage() {
  const spaces = listNodes({ depth: 0 });
  const tasks = listNodes({ type: "task", limit: 200 });

  return (
    <div className="flex h-screen bg-stone-50 overflow-hidden">
      <SpaceSidebar spaces={spaces} dbError={false} />
      <AutoRefresh interval={15} />

      <main className="flex-1 flex flex-col min-w-0">
        <header className="h-14 border-b border-stone-200 flex items-center justify-between px-6 shrink-0 bg-white">
          <h1 className="text-[15px] font-semibold text-stone-900">Board</h1>
          <span className="text-[12px] text-stone-400">{tasks.length} tasks</span>
        </header>

        <div className="flex-1 overflow-x-auto bg-stone-50">
          <KanbanBoard tasks={tasks} />
        </div>
      </main>
    </div>
  );
}
