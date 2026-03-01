import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { AgentRegistry } from './registry/index.js';
import { MessageBus } from './bus/index.js';
import { MemoryStore } from './memory/index.js';
import { WakeManager } from './wake/index.js';
import { loadConfig, ensureDataDir } from './config/index.js';
import type { AgentBusConfig } from './config/index.js';

/**
 * The AgentBus platform — ties together the registry, message bus,
 * memory store, and wake manager into a single cohesive runtime.
 *
 * This is the kernel. The CLI, SDK, and API all interact through this.
 */
export class AgentBusPlatform {
  readonly registry: AgentRegistry;
  readonly bus: MessageBus;
  readonly memory: MemoryStore;
  readonly wake: WakeManager;
  readonly config: AgentBusConfig;

  constructor(configOverrides: Partial<AgentBusConfig> = {}) {
    this.config = loadConfig(configOverrides);
    ensureDataDir(this.config);

    this.registry = new AgentRegistry();
    this.bus = new MessageBus({ maxHistory: this.config.maxHistory });
    this.memory = new MemoryStore({
      cleanupIntervalMs: this.config.memoryCleanupInterval,
    });
    this.wake = new WakeManager(this.registry, this.bus, {
      maxLog: this.config.maxWakeLog,
    });

    // Load persisted state
    this.loadState();
  }

  /** Start the platform (begin listening for wake events) */
  start(): void {
    this.wake.start();
  }

  /** Gracefully shut down the platform */
  async shutdown(): Promise<void> {
    this.saveState();
    this.wake.stop();
    await this.bus.drain();
    this.memory.destroy();
  }

  /** Persist registry and memory state to disk (atomic write-to-temp-then-rename) */
  saveState(): void {
    const registryPath = join(this.config.dataDir, 'registry.json');
    const memoryPath = join(this.config.dataDir, 'memory.json');

    atomicWriteFileSync(registryPath, JSON.stringify(this.registry.export(), null, 2));
    atomicWriteFileSync(memoryPath, JSON.stringify(this.memory.export(), null, 2));
  }

  /** Load persisted state from disk */
  private loadState(): void {
    const registryPath = join(this.config.dataDir, 'registry.json');
    const memoryPath = join(this.config.dataDir, 'memory.json');

    if (existsSync(registryPath)) {
      try {
        const data = JSON.parse(readFileSync(registryPath, 'utf-8'));
        this.registry.import(data);
      } catch (err) {
        console.error(`Warning: could not load registry state: ${err instanceof Error ? err.message : err}`);
      }
    }

    if (existsSync(memoryPath)) {
      try {
        const data = JSON.parse(readFileSync(memoryPath, 'utf-8'));
        this.memory.import(data);
      } catch (err) {
        console.error(`Warning: could not load memory state: ${err instanceof Error ? err.message : err}`);
      }
    }
  }
}

/**
 * Write a file atomically: write to a temp file, then rename.
 * Rename is atomic on POSIX, preventing partial/corrupt files on crash.
 */
function atomicWriteFileSync(filePath: string, data: string): void {
  const tmpPath = `${filePath}.tmp`;
  writeFileSync(tmpPath, data, 'utf-8');
  renameSync(tmpPath, filePath);
}

/** Singleton platform instance for CLI use */
let _platform: AgentBusPlatform | null = null;

export function getPlatform(configOverrides?: Partial<AgentBusConfig>): AgentBusPlatform {
  if (!_platform) {
    _platform = new AgentBusPlatform(configOverrides);
    _platform.start();

    // Ensure state is saved on process exit
    const cleanup = () => {
      if (_platform) {
        _platform.saveState();
        _platform.memory.destroy();
      }
    };
    process.on('exit', cleanup);
    process.on('SIGINT', () => { cleanup(); process.exit(0); });
    process.on('SIGTERM', () => { cleanup(); process.exit(0); });
  }
  return _platform;
}
