import { listNodes } from "@/lib/db";
import { SpaceSidebar } from "@/components/layout/space-sidebar";
import { getDb } from "@/lib/db";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

interface AgentRunRow {
  id: string;
  agent_name: string;
  job_id: string | null;
  trigger: string;
  status: string;
  duration_ms: number | null;
  error: string | null;
  started_at: string;
  completed_at: string | null;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function formatDuration(ms: number | null): string {
  if (ms == null) return "-";
  if (ms < 1000) return `${ms}ms`;
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  return `${Math.floor(secs / 60)}m ${secs % 60}s`;
}

const STATUS_STYLES: Record<string, string> = {
  success: "text-emerald-700 bg-emerald-50 border-emerald-200",
  error: "text-red-600 bg-red-50 border-red-200",
  timeout: "text-amber-700 bg-amber-50 border-amber-200",
  running: "text-blue-700 bg-blue-50 border-blue-200",
};

export default function RunsPage() {
  const spaces = listNodes({ depth: 0 });

  let runs: AgentRunRow[] = [];
  let hasTable = false;

  try {
    const db = getDb();
    const tableExists = db.get(
      sql`SELECT name FROM sqlite_master WHERE type='table' AND name='agent_runs'`
    );
    if (tableExists) {
      hasTable = true;
      runs = db.all<AgentRunRow>(
        sql`SELECT * FROM agent_runs ORDER BY started_at DESC LIMIT 50`
      );
    }
  } catch {
    // ignore
  }

  return (
    <div className="flex h-screen bg-stone-50 overflow-hidden">
      <SpaceSidebar spaces={spaces} dbError={false} />

      <main className="flex-1 flex flex-col min-w-0">
        <header className="h-14 border-b border-stone-200 flex items-center px-6 shrink-0 bg-white">
          <h1 className="text-[15px] font-semibold text-stone-900">Run History</h1>
          <span className="text-[12px] text-stone-400 ml-3">{runs.length} runs</span>
        </header>

        <div className="flex-1 overflow-y-auto bg-stone-50">
          <div className="max-w-4xl mx-auto py-6 px-6">
            {!hasTable ? (
              <div className="bg-white border border-stone-200 rounded-lg p-8 text-center">
                <p className="text-[13px] text-stone-500 mb-1">No run history yet</p>
                <p className="text-[12px] text-stone-400 font-data">
                  Run <code className="bg-stone-100 px-1.5 py-0.5 rounded text-[11px]">spacestation run email-agent</code> to get started
                </p>
              </div>
            ) : runs.length === 0 ? (
              <div className="bg-white border border-stone-200 rounded-lg p-8 text-center">
                <p className="text-[13px] text-stone-500">No runs recorded yet</p>
              </div>
            ) : (
              <div className="space-y-2">
                {runs.map(run => (
                  <div key={run.id} className="bg-white border border-stone-200 rounded-lg p-4 card-hover">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-stone-100 border border-stone-200 flex items-center justify-center">
                          <span className="text-[11px] font-data text-stone-500 font-bold">
                            {run.agent_name[0].toUpperCase()}
                          </span>
                        </div>
                        <div>
                          <div className="text-[13px] font-medium text-stone-900">{run.agent_name}</div>
                          <div className="text-[11px] text-stone-400 flex items-center gap-2">
                            <span>{run.trigger}</span>
                            {run.job_id && <span className="font-data">/{run.job_id}</span>}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-3 text-[12px]">
                        <span className="text-stone-400 font-data">{formatDuration(run.duration_ms)}</span>
                        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded border ${STATUS_STYLES[run.status] ?? "text-stone-500 bg-stone-50 border-stone-200"}`}>
                          {run.status}
                        </span>
                        <span className="text-stone-400">{timeAgo(run.started_at)}</span>
                      </div>
                    </div>

                    {run.error && (
                      <div className="mt-2 text-[11px] text-red-600 bg-red-50 border border-red-200 rounded px-3 py-1.5 font-data">
                        {run.error.slice(0, 200)}
                      </div>
                    )}
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
