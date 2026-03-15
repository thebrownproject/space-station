import { listNodes } from "@/lib/db";
import { SpaceSidebar } from "@/components/layout/space-sidebar";
import { AutoRefresh } from "@/components/layout/auto-refresh";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { IconClock, IconPlayerPlay, IconPlayerPause, IconRocket } from "@tabler/icons-react";

export const dynamic = "force-dynamic";

interface CronJob {
  agentName: string;
  id: string;
  schedule: string;
  description?: string;
  actionType: string;
  enabled: boolean;
}

function loadCronJobs(): CronJob[] {
  const agentsDir = join(process.cwd(), "..", "agents");
  if (!existsSync(agentsDir)) return [];

  const jobs: CronJob[] = [];
  try {
    const entries = readdirSync(agentsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const cronPath = join(agentsDir, entry.name, "cron.yaml");
      if (!existsSync(cronPath)) continue;

      try {
        const cronConfig = parse(readFileSync(cronPath, "utf-8"));
        const agentYamlPath = join(agentsDir, entry.name, "agent.yaml");
        const agentConfig = existsSync(agentYamlPath) ? parse(readFileSync(agentYamlPath, "utf-8")) : null;
        const agentName = agentConfig?.name ?? entry.name;

        for (const job of cronConfig?.jobs ?? []) {
          jobs.push({
            agentName,
            id: job.id,
            schedule: job.schedule,
            description: job.description,
            actionType: job.action?.type ?? "unknown",
            enabled: job.enabled !== false,
          });
        }
      } catch {
        // Skip invalid cron configs
      }
    }
  } catch {
    // No agents directory
  }

  return jobs;
}

function describeCron(expr: string): string {
  const parts = expr.split(" ");
  if (parts.length < 5) return expr;
  const [min, hour, dom, mon, dow] = parts;

  if (min === "0" && hour === "0" && dom === "*" && mon === "*" && dow === "*") return "Every day at midnight";
  if (min === "0" && hour === "*" && dom === "*") return "Every hour";
  if (dom === "*" && mon === "*" && dow === "1-5") return `Weekdays at ${hour}:${min.padStart(2, "0")}`;
  if (dom === "*" && mon === "*" && dow === "*") return `Daily at ${hour}:${min.padStart(2, "0")}`;
  if (min.startsWith("*/")) return `Every ${min.slice(2)} minutes`;

  return expr;
}

// Read daemon state if available
function getDaemonState(): { pid?: number; startedAt?: string; jobs: Record<string, { lastRun: string; lastStatus: string; runCount: number }> } | null {
  try {
    const statePath = join(process.cwd(), "..", "data", "daemon-state.json");
    if (!existsSync(statePath)) return null;
    return JSON.parse(readFileSync(statePath, "utf-8"));
  } catch {
    return null;
  }
}

export default function CronPage() {
  const spaces = listNodes({ depth: 0 });
  const jobs = loadCronJobs();
  const daemonState = getDaemonState();
  const isDaemonRunning = !!daemonState?.pid;

  return (
    <div className="flex h-screen bg-stone-50 overflow-hidden">
      <SpaceSidebar spaces={spaces} dbError={false} />
      <AutoRefresh interval={15} />

      <main className="flex-1 flex flex-col min-w-0">
        <header className="h-14 border-b border-stone-200 flex items-center justify-between px-6 shrink-0 bg-white">
          <div className="flex items-center gap-3">
            <IconClock size={16} className="text-stone-400" />
            <h1 className="text-[15px] font-semibold text-stone-900">Cron Scheduler</h1>
          </div>
          <div className="flex items-center gap-2">
            {isDaemonRunning ? (
              <>
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                <span className="font-data text-[11px] text-emerald-600">Active (PID {daemonState?.pid})</span>
              </>
            ) : (
              <>
                <div className="w-1.5 h-1.5 rounded-full bg-stone-300" />
                <span className="font-data text-[11px] text-stone-400">Offline</span>
              </>
            )}
          </div>
        </header>

        <div className="flex-1 overflow-y-auto bg-stone-50">
          <div className="max-w-4xl mx-auto py-6 px-6">
            {/* Daemon status card */}
            <div className={`rounded-lg border p-4 mb-6 ${isDaemonRunning ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`}>
              <div className="flex items-center justify-between">
                <div>
                  <div className={`text-[12px] font-medium mb-1 ${isDaemonRunning ? "text-emerald-700" : "text-amber-700"}`}>
                    {isDaemonRunning ? "Scheduler Running" : "Scheduler Stopped"}
                  </div>
                  <p className="font-data text-[11px] text-stone-500">
                    {isDaemonRunning
                      ? `Started: ${daemonState?.startedAt ?? "unknown"}`
                      : "Start with: spacestation daemon start"
                    }
                  </p>
                </div>
                <IconRocket size={20} className={isDaemonRunning ? "text-emerald-400" : "text-amber-400"} />
              </div>
            </div>

            {/* Jobs list */}
            {jobs.length === 0 ? (
              <div className="bg-white border border-stone-200 rounded-lg p-8 text-center">
                <p className="text-[13px] text-stone-500 mb-1">No cron jobs</p>
                <p className="text-[12px] text-stone-400 font-data">
                  Add cron.yaml to your agent folders
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="text-[11px] text-stone-400 font-medium uppercase tracking-wider mb-3">
                  Scheduled Jobs ({jobs.length})
                </div>
                {jobs.map(job => {
                  const stateKey = `${job.agentName}:${job.id}`;
                  const jobState = daemonState?.jobs?.[stateKey];

                  return (
                    <div key={stateKey} className="bg-white border border-stone-200 rounded-lg p-4 card-hover">
                      <div className="flex items-start justify-between">
                        <div className="flex items-start gap-3">
                          <div className={`mt-0.5 ${job.enabled ? "text-emerald-500" : "text-stone-300"}`}>
                            {job.enabled ? <IconPlayerPlay size={14} /> : <IconPlayerPause size={14} />}
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="text-[13px] font-medium text-stone-900">{job.agentName}</span>
                              <span className="font-data text-[11px] text-stone-400">/ {job.id}</span>
                            </div>
                            {job.description && (
                              <p className="text-[12px] text-stone-500 mt-0.5">{job.description}</p>
                            )}
                          </div>
                        </div>
                        <span className={`font-data text-[10px] px-1.5 py-0.5 rounded border font-medium ${
                          job.enabled
                            ? "text-emerald-700 bg-emerald-50 border-emerald-200"
                            : "text-stone-400 bg-stone-50 border-stone-200"
                        }`}>
                          {job.enabled ? "Enabled" : "Disabled"}
                        </span>
                      </div>

                      <div className="grid grid-cols-3 gap-3 mt-3">
                        <div className="bg-stone-50 rounded-md p-2.5 border border-stone-100">
                          <div className="text-[10px] text-stone-400 uppercase tracking-wider mb-0.5">Schedule</div>
                          <div className="font-data text-[12px] text-stone-700">{describeCron(job.schedule)}</div>
                          <div className="font-data text-[10px] text-stone-400 mt-0.5">{job.schedule}</div>
                        </div>
                        <div className="bg-stone-50 rounded-md p-2.5 border border-stone-100">
                          <div className="text-[10px] text-stone-400 uppercase tracking-wider mb-0.5">Action</div>
                          <div className="font-data text-[12px] text-stone-700">{job.actionType}</div>
                        </div>
                        <div className="bg-stone-50 rounded-md p-2.5 border border-stone-100">
                          <div className="text-[10px] text-stone-400 uppercase tracking-wider mb-0.5">Last Run</div>
                          {jobState ? (
                            <>
                              <div className={`font-data text-[12px] ${
                                jobState.lastStatus === "success" ? "text-emerald-600" : "text-red-600"
                              }`}>
                                {jobState.lastStatus}
                              </div>
                              <div className="font-data text-[10px] text-stone-400 mt-0.5">
                                {jobState.runCount} runs
                              </div>
                            </>
                          ) : (
                            <div className="font-data text-[12px] text-stone-400">Never</div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
