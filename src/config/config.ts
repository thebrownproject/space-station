import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export interface AgentBusConfig {
  /** Directory for persisted state (registry, memory) */
  dataDir: string;
  /** NATS server URL (when using real NATS) */
  natsUrl?: string;
  /** Use embedded (in-memory) bus instead of NATS */
  embedded: boolean;
  /** Max message history to retain */
  maxHistory: number;
  /** Max wake log entries to retain */
  maxWakeLog: number;
  /** Default request timeout in ms */
  requestTimeout: number;
  /** Memory cleanup interval in ms */
  memoryCleanupInterval: number;
  /** Path to SQLite database file */
  dbPath?: string;
  /** Path to agents directory */
  agentsDir?: string;
  /** Automatically discover and load agents on startup */
  autoLoadAgents?: boolean;
}

const DEFAULT_CONFIG: AgentBusConfig = {
  dataDir: join(homedir(), '.agentbus'),
  embedded: true,
  maxHistory: 10_000,
  maxWakeLog: 1_000,
  requestTimeout: 30_000,
  memoryCleanupInterval: 60_000,
  agentsDir: './agents',
  autoLoadAgents: true,
};

export function loadConfig(overrides: Partial<AgentBusConfig> = {}): AgentBusConfig {
  const config = { ...DEFAULT_CONFIG, ...overrides };

  // Load from config file if it exists
  const configPath = join(config.dataDir, 'config.json');
  if (existsSync(configPath)) {
    try {
      const fileConfig = JSON.parse(readFileSync(configPath, 'utf-8'));
      Object.assign(config, fileConfig, overrides);
    } catch {
      // Ignore invalid config file
    }
  }

  return config;
}

export function saveConfig(config: AgentBusConfig): void {
  if (!existsSync(config.dataDir)) {
    mkdirSync(config.dataDir, { recursive: true });
  }
  const configPath = join(config.dataDir, 'config.json');
  writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
}

export function ensureDataDir(config: AgentBusConfig): void {
  if (!existsSync(config.dataDir)) {
    mkdirSync(config.dataDir, { recursive: true });
  }
}
