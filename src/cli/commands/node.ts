import { Command } from 'commander';
import {
  createNode, getNode, getNodeByPath, updateNode, deleteNode,
  getChildren, getAncestors, runMigrations, listNodes, getSubtree,
  type CreateNodeInput, type UpdateNodeInput, type NodeFilter, type Node,
} from '../../db/index.js';
import { formatJson } from '../formatters.js';
import chalk from 'chalk';
import Table from 'cli-table3';

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

        deleteNode(found.id);
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

  // -- list --
  node.command('list [path-or-id]')
    .description('List nodes (default: root spaces)')
    .option('--type <type>', 'Filter by type')
    .option('--status <status>', 'Filter by status')
    .option('--author <name>', 'Filter by author')
    .option('--assignee <name>', 'Filter by assignee')
    .option('--tags <tags>', 'Filter by tags (comma-separated, match any)')
    .option('--priority <level>', 'Filter by priority')
    .option('--search <query>', 'Text search')
    .option('-n, --limit <n>', 'Max results', '50')
    .option('--offset <n>', 'Skip results', '0')
    .option('--sort <field>', 'Sort by: created|updated|title')
    .option('--asc', 'Sort ascending')
    .option('--json', 'Output as JSON')
    .action(async (pathOrId: string | undefined, opts) => {
      try {
        ensureDb();
        const filter: NodeFilter = {
          limit: parseInt(opts.limit),
          offset: parseInt(opts.offset),
          orderBy: opts.sort,
          orderDir: opts.asc ? 'asc' : 'desc',
        };
        if (opts.type) filter.type = opts.type;
        if (opts.status) filter.status = opts.status;
        if (opts.author) filter.author = opts.author;
        if (opts.assignee) filter.assignee = opts.assignee;
        if (opts.priority) filter.priority = opts.priority;
        if (opts.search) filter.search = opts.search;
        if (opts.tags) filter.tags = parseTags(opts.tags);

        if (pathOrId) {
          const parent = resolveNode(pathOrId);
          filter.parentId = parent.id;
        }

        const results = listNodes(filter);

        if (opts.json) {
          console.log(formatJson(results));
          return;
        }

        if (results.length === 0) {
          console.log('No nodes found.');
          return;
        }

        const header = pathOrId
          ? `${pathOrId} (${results.length} children):`
          : `Spaces:`;
        console.log(header);

        const table = new Table({
          head: ['TYPE', 'PRIORITY', 'STATUS', 'TITLE', 'AUTHOR', 'UPDATED'],
          style: { head: ['dim'] },
        });
        for (const n of results) {
          table.push([
            n.type,
            n.priority ?? '-',
            n.status ?? '-',
            n.title ?? n.slug ?? n.id.slice(0, 8),
            n.author ?? '-',
            timeAgo(n.updatedAt),
          ]);
        }
        console.log(table.toString());
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : err}`);
        process.exitCode = 1;
      }
    });

  // -- search --
  node.command('search <query>')
    .description('Search nodes')
    .option('--type <type>', 'Filter by type')
    .option('--status <status>', 'Filter by status')
    .option('-n, --limit <n>', 'Max results', '20')
    .option('--json', 'Output as JSON')
    .action(async (query: string, opts) => {
      try {
        ensureDb();
        // Use listNodes directly so we can pass type/status filters
        const filter: NodeFilter = {
          search: query,
          limit: parseInt(opts.limit),
        };
        if (opts.type) filter.type = opts.type;
        if (opts.status) filter.status = opts.status;

        const results = listNodes(filter);

        if (opts.json) {
          console.log(formatJson(results));
          return;
        }

        console.log(`Search: "${query}" (${results.length} results)`);
        if (results.length === 0) return;

        const table = new Table({
          head: ['PATH', 'TYPE', 'TITLE', 'AUTHOR'],
          style: { head: ['dim'] },
        });
        for (const n of results) {
          table.push([
            n.path ?? n.id.slice(0, 8),
            n.type,
            n.title ?? '(untitled)',
            n.author ?? '-',
          ]);
        }
        console.log(table.toString());
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : err}`);
        process.exitCode = 1;
      }
    });

  // -- tree --
  node.command('tree [path-or-id]')
    .description('Display node tree')
    .option('--depth <n>', 'Max depth', '3')
    .option('--type <type>', 'Filter by type')
    .option('--json', 'Output as JSON')
    .action(async (pathOrId: string | undefined, opts) => {
      try {
        ensureDb();
        const maxDepth = parseInt(opts.depth);
        let flat: Node[];

        if (pathOrId) {
          const root = resolveNode(pathOrId);
          flat = getSubtree(root.id, maxDepth);
        } else {
          // Show all root nodes and their subtrees
          const roots = listNodes({ limit: 100 });
          flat = [];
          for (const root of roots) {
            flat.push(...getSubtree(root.id, maxDepth));
          }
        }

        if (opts.type) {
          const keepType = opts.type as string;
          flat = flat.filter(n => n.type === keepType);
        }

        if (flat.length === 0) {
          console.log('No nodes found.');
          return;
        }

        if (opts.json) {
          console.log(formatJson(buildNestedJson(flat)));
          return;
        }

        renderTree(flat);
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : err}`);
        process.exitCode = 1;
      }
    });
}

// -- Tree rendering helpers --

const TYPE_COLORS: Record<string, (s: string) => string> = {
  space: (s) => chalk.bold.white(s),
  task: (s) => chalk.yellow(s),
  page: (s) => chalk.cyan(s),
  comment: (s) => chalk.dim(s),
  report: (s) => chalk.magenta(s),
  post: (s) => chalk.white(s),
};

function colorNode(node: Node, label: string): string {
  if (node.priority === 'critical') return chalk.red(label);
  if (node.status === 'done') return chalk.green(label);
  const colorFn = TYPE_COLORS[node.type] ?? ((s: string) => s);
  return colorFn(label);
}

function nodeLabel(node: Node): string {
  if (node.type === 'space') return node.title ?? node.slug ?? node.id.slice(0, 8);

  const parts: string[] = [node.type];
  if (node.priority) parts.push(node.priority);
  if (node.status) parts.push(node.status);
  const badge = `[${parts.join('/')}]`;

  let label: string;
  if (node.type === 'comment') {
    const snippet = (node.content ?? '').slice(0, 40);
    const suffix = (node.content ?? '').length > 40 ? '...' : '';
    label = `${badge} "${snippet}${suffix}"`;
    if (node.author) label += ` -- ${node.author}`;
  } else {
    label = `${badge} ${node.title ?? node.slug ?? node.id.slice(0, 8)}`;
    if (node.assignee) label += ` <- ${node.assignee}`;
  }
  return label;
}

function renderTree(flat: Node[]): void {
  // Build parent->children map
  const childrenMap = new Map<string | null, Node[]>();
  for (const n of flat) {
    const pid = n.parentId ?? null;
    let list = childrenMap.get(pid);
    if (!list) {
      list = [];
      childrenMap.set(pid, list);
    }
    list.push(n);
  }

  // Find roots (nodes whose parent is not in the flat set)
  const idSet = new Set(flat.map(n => n.id));
  const roots = flat.filter(n => !n.parentId || !idSet.has(n.parentId));

  function printNode(node: Node, prefix: string, isLast: boolean, isRoot: boolean): void {
    const connector = isRoot ? '' : (isLast ? '└── ' : '├── ');
    const label = nodeLabel(node);
    console.log(prefix + connector + colorNode(node, label));

    const children = childrenMap.get(node.id) ?? [];
    const nextPrefix = isRoot ? prefix : prefix + (isLast ? '    ' : '│   ');
    children.forEach((child, i) => {
      printNode(child, nextPrefix, i === children.length - 1, false);
    });
  }

  roots.forEach((root, i) => {
    printNode(root, '', i === roots.length - 1, true);
  });
}

function buildNestedJson(flat: Node[]): unknown[] {
  const childrenMap = new Map<string | null, Node[]>();
  for (const n of flat) {
    const pid = n.parentId ?? null;
    let list = childrenMap.get(pid);
    if (!list) {
      list = [];
      childrenMap.set(pid, list);
    }
    list.push(n);
  }

  const idSet = new Set(flat.map(n => n.id));
  const roots = flat.filter(n => !n.parentId || !idSet.has(n.parentId));

  function nest(node: Node): Record<string, unknown> {
    const children = (childrenMap.get(node.id) ?? []).map(nest);
    return { ...node, children };
  }

  return roots.map(nest);
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
