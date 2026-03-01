import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { AgentRegistry } from './registry/index.js';
import { MessageBus, NatsMessageBus, startEmbeddedNats } from './bus/index.js';
import type { IMessageBus, EmbeddedNats } from './bus/index.js';
import { MemoryStore } from './memory/index.js';
import { WakeManager } from './wake/index.js';
import { loadConfig, ensureDataDir } from './config/index.js';
import type { AgentBusConfig } from './config/index.js';

/**
 * The AgentBus platform — ties together the registry, message bus,
 * memory store, and wake manager into a single cohesive runtime.
 *
 * This is the kernel. The CLI, SDK, and API all interact through this.
 *
 * Bus selection logic:
 * - natsUrl set          → connect to external NATS server
 * - embedded: true       → auto-start a local nats-server subprocess
 * - embedded: false      → use in-memory MessageBus (no cross-process)
 */
export class AgentBusPlatform {
  readonly registry: AgentRegistry;
  readonly bus: IMessageBus;
  readonly memory: MemoryStore;
  readonly wake: WakeManager;
  readonly config: AgentBusConfig;
  private embeddedNats: EmbeddedNats | null = null;

  constructor(configOverrides: Partial<AgentBusConfig> = {}) {
    this.config = loadConfig(configOverrides);
    ensureDataDir(this.config);

    this.registry = new AgentRegistry();

    // Create the appropriate bus implementation
    if (this.config.natsUrl) {
      // External NATS server — connect to the provided URL
      this.bus = new NatsMessageBus({
        servers: this.config.natsUrl,
        maxHistory: this.config.maxHistory,
      });
    } else {
      // In-memory bus — will be swapped for embedded NATS in start() if configured
      this.bus = new MessageBus({ maxHistory: this.config.maxHistory });
    }

    this.memory = new MemoryStore({
      cleanupIntervalMs: this.config.memoryCleanupInterval,
    });
    this.wake = new WakeManager(this.registry, this.bus, {
      maxLog: this.config.maxWakeLog,
    });

    // Load persisted state
    this.loadState();
  }

  /**
   * Start the platform — connect to NATS (if configured) and begin
   * listening for wake events.
   *
   * When `embedded: true` and no `natsUrl` is set, this will attempt
   * to auto-start a local nats-server subprocess. If nats-server is
   * not installed, it falls back to the in-memory bus silently.
   */
  async start(): Promise<void> {
    // If embedded mode is requested and no external NATS URL, try auto-starting
    if (this.config.embedded && !this.config.natsUrl) {
      try {
        this.embeddedNats = await startEmbeddedNats();
        // Replace the in-memory bus with NATS-backed bus
        const natsBus = new NatsMessageBus({
          servers: this.embeddedNats.url,
          maxHistory: this.config.maxHistory,
        });
        await natsBus.connect();
        // Reassign bus (wake manager already holds a reference, so update it)
        (this as { bus: IMessageBus }).bus = natsBus;
        (this.wake as unknown as { bus: IMessageBus }).bus = natsBus;
      } catch {
        // nats-server not available — continue with in-memory bus
      }
    }

    // Connect if using NATS (external URL case)
    if (this.bus.connect) {
      await this.bus.connect();
    }

    this.wake.start();
  }

  /** Gracefully shut down the platform */
  async shutdown(): Promise<void> {
    this.saveState();
    this.wake.stop();
    await this.bus.drain();
    this.memory.destroy();

    // Stop embedded NATS server if we started one
    if (this.embeddedNats) {
      await this.embeddedNats.stop();
      this.embeddedNats = null;
    }
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

export async function getPlatform(configOverrides?: Partial<AgentBusConfig>): Promise<AgentBusPlatform> {
  if (!_platform) {
    _platform = new AgentBusPlatform(configOverrides);
    await _platform.start();

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
