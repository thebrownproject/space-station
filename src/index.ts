// Core platform
export { AgentBusPlatform, getPlatform } from './platform.js';

// Modules
export { AgentRegistry, subjectMatches, validateSubject, validateAgentName } from './registry/index.js';
export { MessageBus } from './bus/index.js';
export { MemoryStore } from './memory/index.js';
export { WakeManager } from './wake/index.js';
export type { WakeEvent, WakeHandler } from './wake/index.js';

// SDK
export { AgentBuilder, Agent } from './sdk/index.js';
export type { AgentContext } from './sdk/index.js';

// Configuration
export { loadConfig, saveConfig, ensureDataDir } from './config/index.js';
export type { AgentBusConfig } from './config/index.js';

// Types
export * from './types/index.js';
