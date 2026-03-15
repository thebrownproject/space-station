import { Command } from 'commander';
import {
  createNode, getNode, getNodeByPath, updateNode, deleteNode,
  getChildren, getAncestors, runMigrations,
  type CreateNodeInput, type UpdateNodeInput, type Node,
} from '../../db/index.js';
import { formatJson } from '../formatters.js';

let migrated = false;
function ensureDb(): void {
  if (migrated) return;
  runMigrations();
  migrated = true;
}

function isUUID(s: string): boolean {
  return s.length >= 36 && s.includes('-');
}

function resolveNode(pathOrId: string): Node {
  ensureDb();
  const node = isUUID(pathOrId) ? getNode(pathOrId) : getNodeByPath(pathOrId);
  if (!node) throw new Error(`Node not found: ${pathOrId}`);
  return node;
}

async function readContent(opts: { content?: string }): Promise<string | undefined> {
  if (opts.content === '-' || (!opts.content && !process.stdin.isTTY)) {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks).toString('utf-8');
  }
  return opts.content;
}

function resolveParent(parent: string): { parentId?: string; parentPath?: string } {
  return isUUID(parent) ? { parentId: parent } : { parentPath: parent };
}

function parseTags(raw: string): string[] {
  return raw.split(',').map(t => t.trim()).filter(Boolean);
}

function formatNodeDetail(node: Node): string {
  const typeLabel = node.type.charAt(0).toUpperCase() + node.type.slice(1);
  const lines = [
    `${typeLabel}: ${node.title ?? '(untitled)'}`,
    `  ID:        ${node.id}`,
    `  Path:      ${node.path ?? '-'}`,
  ];
  if (node.status) lines.push(`  Status:    ${node.status}`);
  if (node.priority) lines.push(`  Priority:  ${node.priority}`);
  if (node.author) lines.push(`  Author:    ${node.author}`);
  if (node.assignee) lines.push(`  Assignee:  ${node.assignee}`);
  if (node.tags.length) lines.push(`  Tags:      ${node.tags.join(', ')}`);
  lines.push(`  Created:   ${node.createdAt}`);
  lines.push(`  Updated:   ${node.updatedAt}`);
  if (node.childCount > 0) lines.push(`  Children:  ${node.childCount}`);
  if (node.content) {
    lines.push('', '  Content:', '  ' + '\u2500'.repeat(35), `  ${node.content}`);
  }
  return lines.join('\n');
}

function formatNodeSummary(node: Node): string {
  const lines = [
    `Created ${node.type}: "${node.title ?? '(untitled)'}"`,
    `  ID:       ${node.id}`,
    `  Path:     ${node.path ?? '-'}`,
  ];
  if (node.parentId) lines.push(`  Parent:   ${node.parentId}`);
  if (node.status) lines.push(`  Status:   ${node.status}`);
  if (node.priority) lines.push(`  Priority: ${node.priority}`);
  if (node.assignee) lines.push(`  Assignee: ${node.assignee}`);
  return lines.join('\n');
}

export function registerNodeCommands(program: Command): void {
  const node = program.command('node').description('Node operations (spaces, posts, tasks, pages)');

  // -- create --
  node.command('create')
    .description('Create a new node')
    .requiredOption('--type <type>', 'Node type: space|post|task|page|comment|report')
    .option('--title <title>', 'Title')
    .option('--content <text>', 'Content body (use "-" for stdin)')
    .option('--parent <path-or-id>', 'Parent node')
    .option('--author <name>', 'Author')
    .option('--status <status>', 'Status')
    .option('--priority <level>', 'Priority')
    .option('--assignee <name>', 'Assignee')
    .option('--tags <tags>', 'Comma-separated tags')
    .option('--meta <json>', 'JSON metadata')
    .option('--json', 'Output as JSON')
    .action(async (opts) => {
      try {
        ensureDb();
        const content = await readContent(opts);
        const input: CreateNodeInput = {
          type: opts.type,
          title: opts.title,
          content,
          author: opts.author,
          status: opts.status,
          priority: opts.priority,
          assignee: opts.assignee,
          tags: opts.tags ? parseTags(opts.tags) : undefined,
          metadata: opts.meta ? JSON.parse(opts.meta) : undefined,
          ...(opts.parent ? resolveParent(opts.parent) : {}),
        };
        const created = createNode(input);
        if (opts.json) {
          console.log(formatJson(created));
        } else {
          console.log(formatNodeSummary(created));
        }
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : err}`);
        process.exitCode = 1;
      }
    });

  // -- get --
  node.command('get <path-or-id>')
    .description('Get full node details')
    .option('--json', 'Output as JSON')
    .option('--with-children', 'Include children')
    .option('--with-ancestors', 'Include breadcrumb')
    .action(async (pathOrId: string, opts) => {
      try {
        const found = resolveNode(pathOrId);
        if (opts.json) {
          const result: Record<string, unknown> = { ...found };
          if (opts.withChildren) result.children = getChildren(found.id);
          if (opts.withAncestors) result.ancestors = getAncestors(found.id);
          console.log(formatJson(result));
        } else {
          console.log(formatNodeDetail(found));
          if (opts.withAncestors) {
            const ancestors = getAncestors(found.id);
            if (ancestors.length > 1) {
              const breadcrumb = ancestors.map(a => a.title ?? a.slug ?? a.id.slice(0, 8)).join(' > ');
              console.log(`\n  Breadcrumb: ${breadcrumb}`);
            }
          }
          if (opts.withChildren) {
            const children = getChildren(found.id);
            if (children.length > 0) {
              console.log(`\n  Children (${children.length}):`);
              for (const c of children) {
                console.log(`    [${c.type}] ${c.title ?? c.slug ?? c.id.slice(0, 8)}`);
              }
            }
          }
        }
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : err}`);
        process.exitCode = 1;
      }
    });

  // -- update --
  node.command('update <path-or-id>')
    .description('Update a node')
    .option('--title <title>', 'Update title')
    .option('--content <text>', 'Update content (use "-" for stdin)')
    .option('--status <status>', 'Update status')
    .option('--priority <level>', 'Update priority')
    .option('--assignee <name>', 'Update assignee')
    .option('--tags <tags>', 'Replace tags (comma-separated)')
    .option('--add-tag <tag>', 'Add a tag (without replacing)')
    .option('--meta <json>', 'Merge metadata')
    .option('--json', 'Output as JSON')
    .action(async (pathOrId: string, opts) => {
      try {
        const found = resolveNode(pathOrId);
        const content = await readContent(opts);
        const updates: UpdateNodeInput = {};

        if (opts.title !== undefined) updates.title = opts.title;
        if (content !== undefined) updates.content = content;
        if (opts.status !== undefined) updates.status = opts.status;
        if (opts.priority !== undefined) updates.priority = opts.priority;
        if (opts.assignee !== undefined) updates.assignee = opts.assignee;
        if (opts.tags !== undefined) updates.tags = parseTags(opts.tags);
        if (opts.meta !== undefined) updates.metadata = JSON.parse(opts.meta);

        // --add-tag merges with existing tags
        if (opts.addTag) {
          const existing = found.tags ?? [];
          const merged = [...new Set([...existing, opts.addTag])];
          updates.tags = merged;
        }

        const updated = updateNode(found.id, updates);
        if (opts.json) {
          console.log(formatJson(updated));
        } else {
          console.log(`Updated ${updated.type}: "${updated.title ?? '(untitled)'}"`);
        }
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : err}`);
        process.exitCode = 1;
      }
    });

  // -- delete --
  node.command('delete <path-or-id>')
    .description('Delete a node and all descendants')
    .option('--force', 'Skip confirmation')
    .option('--json', 'Output as JSON')
    .action(async (pathOrId: string, opts) => {
      try {
        const found = resolveNode(pathOrId);

        if (!opts.force) {
          console.error('Error: Use --force to confirm deletion');
          process.exitCode = 1;
          return;
        }

        const deleted = deleteNode(found.id);
        if (opts.json) {
          console.log(formatJson({ deleted: true, id: found.id, path: found.path }));
        } else {
          console.log(`Deleted ${found.type}: "${found.title ?? found.id}" (${found.path ?? found.id})`);
        }
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : err}`);
        process.exitCode = 1;
      }
    });

  // -- reply --
  node.command('reply <path-or-id>')
    .description('Add a comment to a node')
    .option('--content <text>', 'Reply content (stdin if omitted)')
    .requiredOption('--author <name>', 'Author')
    .option('--json', 'Output as JSON')
    .action(async (pathOrId: string, opts) => {
      try {
        const parent = resolveNode(pathOrId);
        const content = await readContent(opts);
        if (!content) {
          console.error('Error: No content provided. Use --content or pipe via stdin.');
          process.exitCode = 1;
          return;
        }
        const comment = createNode({
          type: 'comment',
          content,
          author: opts.author,
          parentId: parent.id,
        });
        if (opts.json) {
          console.log(formatJson(comment));
        } else {
          console.log(`Reply added to "${parent.title ?? parent.path ?? parent.id}"`);
          console.log(`  ID:     ${comment.id}`);
          console.log(`  Author: ${comment.author}`);
        }
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : err}`);
        process.exitCode = 1;
      }
    });
}
