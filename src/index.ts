// Core platform
export { AgentBusPlatform, getPlatform } from './platform.js';

// Modules
export { AgentRegistry, subjectMatches, validateSubject, validateAgentName } from './registry/index.js';
export { MessageBus, NatsMessageBus, startEmbeddedNats } from './bus/index.js';
export type { IMessageBus, BusEvents, EmbeddedNats } from './bus/index.js';
export { MemoryStore, VersionConflictError } from './memory/index.js';
export { WakeManager } from './wake/index.js';
export type { WakeEvent, WakeHandler } from './wake/index.js';
export { SkillLoader, SkillRegistry } from './skills/index.js';
export type { Skill, SkillManifest, SkillFrontmatter, SkillSource, SkillResolutionOptions } from './skills/index.js';

// SDK
export { AgentBuilder, Agent } from './sdk/index.js';
export type { AgentContext } from './sdk/index.js';

// Configuration
export { loadConfig, saveConfig, ensureDataDir } from './config/index.js';
export type { AgentBusConfig } from './config/index.js';

// Types
export * from './types/index.js';
