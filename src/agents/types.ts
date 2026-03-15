import type { AgentCapability, AgentAuth } from '../types/agent.js';

/** Schema for agent.yaml -- the required config file in each agent folder. */
export interface AgentFolderConfig {
  name: string;
  description: string;
  version?: string;
  capabilities: (string | AgentCapability)[];
  wakePatterns?: string[];
  endpoint?: string;
  auth?: AgentAuth;
  status?: 'online' | 'offline' | 'sleeping';
  metadata?: Record<string, unknown>;
}

/** Fully resolved manifest after reading an agent folder. */
export interface AgentManifest {
  folderPath: string;
  config: AgentFolderConfig;
  identityFiles: AgentIdentityFiles;
  cronConfig?: CronFileConfig;
  skills: AgentSkillRef[];
  hasMemory: boolean;
  memoryPath?: string;
}

export interface AgentIdentityFiles {
  claude?: string;
  soul?: string;
  identity?: string;
}

/** Reference to a skill found in the agent's skills/ directory. */
export interface AgentSkillRef {
  name: string;
  path: string;
}

/** Schema for cron.yaml -- defines scheduled jobs for the agent. */
export interface CronFileConfig {
  jobs: CronJobFileEntry[];
}

export interface CronJobFileEntry {
  id: string;
  schedule: string;
  description?: string;
  action: {
    type: 'claude' | 'emit' | 'skill';
    prompt?: string;
    model?: string;
    subject?: string;
    payload?: unknown;
    skill?: string;
    params?: Record<string, unknown>;
  };
  enabled?: boolean;
  catchUp?: boolean;
  timezone?: string;
  protect?: boolean;
  timeout?: number;
}

/** Result of loading an agent folder into the platform. */
export interface AgentLoadResult {
  manifest: AgentManifest;
  agentId: string;
  agentName: string;
  cronJobsLoaded: number;
  skillsLoaded: number;
  warnings: string[];
}
