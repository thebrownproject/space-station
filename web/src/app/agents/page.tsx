import { listNodes } from "@/lib/db";
import { SpaceSidebar } from "@/components/layout/space-sidebar";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { IconRobot } from "@tabler/icons-react";

export const dynamic = "force-dynamic";

interface AgentInfo {
  name: string;
  description: string;
  capabilities: string[];
  cronJobs: number;
  skills: string[];
  hasMemory: boolean;
  hasSoul: boolean;
}

function loadAgents(): AgentInfo[] {
  const agentsDir = join(process.cwd(), "..", "agents");
  if (!existsSync(agentsDir)) return [];
  const agents: AgentInfo[] = [];
  try {
    const entries = readdirSync(agentsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const yamlPath = join(agentsDir, entry.name, "agent.yaml");
      if (!existsSync(yamlPath)) continue;
      try {
        const config = parse(readFileSync(yamlPath, "utf-8"));
        const cronPath = join(agentsDir, entry.name, "cron.yaml");
        let cronJobs = 0;
        if (existsSync(cronPath)) { const c = parse(readFileSync(cronPath, "utf-8")); cronJobs = c?.jobs?.length ?? 0; }
        const skillsDir = join(agentsDir, entry.name, "skills");
        const skills: string[] = [];
        if (existsSync(skillsDir)) {
          for (const se of readdirSync(skillsDir, { withFileTypes: true })) {
            if (se.isDirectory() && existsSync(join(skillsDir, se.name, "SKILL.md"))) skills.push(se.name);
          }
        }
        agents.push({
          name: config.name ?? entry.name,
          description: config.description ?? "",
          capabilities: (config.capabilities ?? []).map((c: any) => typeof c === "string" ? c : c.name),
          cronJobs, skills,
          hasMemory: existsSync(join(agentsDir, entry.name, "memory", "MEMORY.md")),
          hasSoul: existsSync(join(agentsDir, entry.name, "SOUL.md")),
        });
      } catch { /* skip */ }
    }
  } catch { /* no dir */ }
  return agents;
}

export default function AgentsPage() {
  const spaces = listNodes({ depth: 0 });
  const agents = loadAgents();

  return (
    <div className="flex h-screen bg-stone-50 overflow-hidden">
      <SpaceSidebar spaces={spaces} dbError={false} />

      <main className="flex-1 flex flex-col min-w-0">
        <header className="h-14 border-b border-stone-200 flex items-center px-6 shrink-0 bg-white">
          <h1 className="text-[15px] font-semibold text-stone-900">Agents</h1>
          <span className="text-[12px] text-stone-400 ml-3">{agents.length} registered</span>
        </header>

        <div className="flex-1 overflow-y-auto bg-stone-50">
          <div className="max-w-3xl mx-auto py-6 px-6">
            {agents.length === 0 ? (
              <div className="bg-white border border-stone-200 rounded-lg p-8 text-center">
                <p className="text-[13px] text-stone-500 mb-1">No agents found</p>
                <p className="text-[12px] text-stone-400 font-data">
                  Run <code className="bg-stone-100 px-1.5 py-0.5 rounded text-[11px]">spacestation init my-agent --template full</code>
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {agents.map(agent => (
                  <div key={agent.name} className="bg-white border border-stone-200 rounded-lg p-5 card-hover">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-lg bg-stone-100 border border-stone-200 flex items-center justify-center">
                          <IconRobot size={18} className="text-stone-500" />
                        </div>
                        <div>
                          <h3 className="text-[14px] font-semibold text-stone-900">{agent.name}</h3>
                          <p className="text-[12px] text-stone-500 mt-0.5">{agent.description}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        {agent.hasSoul && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full border border-violet-200 text-violet-600 bg-violet-50 font-medium">
                            Soul
                          </span>
                        )}
                        {agent.hasMemory && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full border border-sky-200 text-sky-600 bg-sky-50 font-medium">
                            Memory
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-3 mt-4">
                      <MetricCell label="Cron Jobs" value={agent.cronJobs} />
                      <MetricCell label="Skills" value={agent.skills.length} />
                      <MetricCell label="Capabilities" value={agent.capabilities.length} />
                    </div>

                    {agent.capabilities.length > 0 && (
                      <div className="flex gap-1 mt-3 flex-wrap">
                        {agent.capabilities.map(cap => (
                          <span key={cap} className="text-[10px] font-data text-stone-400 bg-stone-50 px-1.5 py-0.5 rounded border border-stone-100">
                            {cap}
                          </span>
                        ))}
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

function MetricCell({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-stone-50 rounded-md p-2.5 border border-stone-100">
      <div className="text-[10px] text-stone-400 uppercase tracking-wider">{label}</div>
      <div className="text-lg font-semibold font-data text-stone-800 mt-0.5">{value}</div>
    </div>
  );
}
