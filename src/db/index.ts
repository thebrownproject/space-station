export { nodes, type NodeType, type NodeStatus, type NodePriority } from './schema.js';
export { getDb, resolveDbPath, closeDb } from './connection.js';
export { runMigrations, seedDefaults } from './migrate.js';
