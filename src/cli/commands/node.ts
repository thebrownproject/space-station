import { Command } from 'commander';
import {
  createNode, getNode, getNodeByPath, updateNode, moveNode, deleteNode,
  getChildren, getAncestors, runMigrations, listNodes, getSubtree,
  type CreateNodeInput, type UpdateNodeInput, type NodeFilter, type Node,
} from '../../db/index.js';
import { formatJson, timeAgo } from '../formatters.js';
import chalk from 'chalk';
import Table from 'cli-table3';

let migrated = false;
function ensureDb(): void {
  if (migrated) return;
  runMigrations();
  migrated = true;
}

function isUUID(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

function resolveNode(pathOrId: string): Node {
  ensureDb();
  const node = isUUID(pathOrId) ? getNode(pathOrId) : getNodeByPath(pathOrId);
  if (!node) throw new Error(`Node not found: ${pathOrId}`);
  return node;
}

async function readContent(opts: { content?: string }): Promise<string | undefined> {
  if (opts.content === '-') {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks).toString('utf-8');
  }
  return opts.content ?? '';
}

function resolveParent(parent: string): { parentId?: string; parentPath?: string } {
  return isUUID(parent) ? { parentId: parent } : { parentPath: parent };
}

function parseTags(raw: string): string[] {
  return raw.split(',').map(t => t.trim()).filter(Boolean);
}

const ALL_TYPES: Array<'space' | 'post' | 'task' | 'page' | 'comment' | 'report'> =
  ['space', 'post', 'task', 'page', 'comment', 'report'];

/** Fetch all nodes across all types (bypasses root-only default). */
function getAllNodes(limit: number = 1000): Node[] {
  const all: Node[] = [];
  for (const type of ALL_TYPES) {
    all.push(...listNodes({ type, limit }));
  }
  return all;
}

const VALID_TYPES = ['space', 'post', 'task', 'page', 'comment', 'report'];
const VALID_STATUSES = ['open', 'in-progress', 'review', 'done', 'closed'];
const VALID_PRIORITIES = ['low', 'medium', 'high', 'critical'];

function validateEnum(value: string, valid: string[], label: string): boolean {
  if (!valid.includes(value)) {
    console.error(`Invalid ${label} "${value}". Choose: ${valid.join(', ')}`);
    process.exitCode = 1;
    return false;
  }
  return true;
}

function formatNodeDetail(node: Node): string {
  const typeLabel = node.type.charAt(0).toUpperCase() + node.type.slice(1);
  const colorFn = TYPE_COLORS[node.type] ?? ((s: string) => s);
  const lines = [
    colorFn(`${typeLabel}: ${node.title ?? '(untitled)'}`),
    `  ID:        ${chalk.dim(node.id)}`,
    `  Path:      ${node.path ?? '-'}`,
  ];
  if (node.status) {
    const statusColor = node.status === 'done' ? chalk.green : node.status === 'open' ? chalk.yellow : chalk.white;
    lines.push(`  Status:    ${statusColor(node.status)}`);
  }
  if (node.priority) {
    const prioColor = node.priority === 'critical' ? chalk.red : node.priority === 'high' ? chalk.yellow : chalk.white;
    lines.push(`  Priority:  ${prioColor(node.priority)}`);
  }
  if (node.author) lines.push(`  Author:    ${node.author}`);
  if (node.assignee) lines.push(`  Assignee:  ${chalk.cyan(node.assignee)}`);
  if (node.tags.length) lines.push(`  Tags:      ${node.tags.map(t => chalk.dim(`#${t}`)).join(' ')}`);
  lines.push(`  Created:   ${timeAgo(node.createdAt)} (${node.createdAt})`);
  lines.push(`  Updated:   ${timeAgo(node.updatedAt)} (${node.updatedAt})`);
  if (node.childCount > 0) lines.push(`  Children:  ${node.childCount}`);
  if (node.content) {
    lines.push('', '  Content:', '  ' + chalk.dim('\u2500'.repeat(35)), `  ${node.content}`);
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

  // -- summary (executive overview) --
  node.command('summary')
    .description('Generate an executive summary of system state')
    .option('--json', 'Output as JSON')
    .action((opts) => {
      try {
        ensureDb();
        const all = getAllNodes();

        const tasks = all.filter(n => n.type === 'task');
        const openTasks = tasks.filter(t => t.status === 'open');
        const inProgress = tasks.filter(t => t.status === 'in-progress');
        const critical = tasks.filter(t => t.priority === 'critical' && t.status !== 'done' && t.status !== 'closed');
        const reports = all.filter(n => n.type === 'report');

        // Recent (last 24h)
        const dayAgo = new Date(Date.now() - 86400000).toISOString();
        const recentNodes = all.filter(n => n.updatedAt > dayAgo);
        const recentCreated = all.filter(n => n.createdAt > dayAgo);

        // Agents active
        const activeAuthors = new Set(recentNodes.filter(n => n.author).map(n => n.author!));

        // Stale tasks (no updates in 48h)
        const twoDaysAgo = new Date(Date.now() - 172800000).toISOString();
        const staleTasks = tasks.filter(t =>
          (t.status === 'open' || t.status === 'in-progress') && t.updatedAt < twoDaysAgo
        );

        const summary = {
          total: all.length,
          tasks: { open: openTasks.length, inProgress: inProgress.length, critical: critical.length },
          reports: reports.length,
          last24h: { updated: recentNodes.length, created: recentCreated.length },
          activeAgents: Array.from(activeAuthors),
          staleTasks: staleTasks.map(t => ({ title: t.title, path: t.path, assignee: t.assignee, lastUpdate: t.updatedAt })),
        };

        if (opts.json) {
          console.log(formatJson(summary));
          return;
        }

        console.log('');
        console.log(chalk.bold('  MISSION BRIEFING'));
        console.log(chalk.dim('  ' + '='.repeat(30)));
        console.log('');
        console.log(`  ${chalk.bold('Tasks:')} ${chalk.yellow(String(openTasks.length) + ' open')} | ${chalk.blue(String(inProgress.length) + ' active')} | ${critical.length > 0 ? chalk.red(String(critical.length) + ' CRITICAL') : chalk.green('0 critical')}`);
        console.log(`  ${chalk.bold('Last 24h:')} ${recentCreated.length} created, ${recentNodes.length} updated`);
        console.log(`  ${chalk.bold('Active agents:')} ${activeAuthors.size > 0 ? Array.from(activeAuthors).map(a => chalk.cyan(a)).join(', ') : chalk.dim('none')}`);

        if (critical.length > 0) {
          console.log('');
          console.log(chalk.red('  CRITICAL ITEMS:'));
          for (const t of critical) {
            console.log(`    ${chalk.red('!')} ${t.title ?? t.id} ${t.assignee ? chalk.cyan('-> ' + t.assignee) : ''}`);
          }
        }

        if (staleTasks.length > 0) {
          console.log('');
          console.log(chalk.yellow('  STALE TASKS (48h+ no activity):'));
          for (const t of staleTasks) {
            console.log(`    ${chalk.yellow('?')} ${t.title ?? t.path} ${t.assignee ? chalk.dim('(' + t.assignee + ')') : ''}`);
          }
        }

        console.log('');
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : err}`);
        process.exitCode = 1;
      }
    });

  // -- batch (process multiple operations from stdin) --
  node.command('batch')
    .description('Process multiple node operations from stdin (JSON array)')
    .option('--json', 'Output as JSON')
    .action(async (opts) => {
      try {
        ensureDb();
        const chunks: Buffer[] = [];
        for await (const chunk of process.stdin) {
          chunks.push(chunk);
        }
        const raw = Buffer.concat(chunks).toString('utf-8');
        const ops = JSON.parse(raw);

        if (!Array.isArray(ops)) {
          console.error('Error: Expected a JSON array of operations');
          process.exitCode = 1;
          return;
        }

        const results: Array<{ op: string; status: 'ok' | 'error'; result?: unknown; error?: string }> = [];

        for (const op of ops) {
          try {
            switch (op.action) {
              case 'create': {
                const node = createNode(op);
                results.push({ op: 'create', status: 'ok', result: node });
                break;
              }
              case 'update': {
                const target = op.id ? getNode(op.id) : (op.path ? getNodeByPath(op.path) : undefined);
                if (!target) throw new Error(`Node not found: ${op.id ?? op.path}`);
                const updated = updateNode(target.id, op);
                results.push({ op: 'update', status: 'ok', result: updated });
                break;
              }
              case 'reply': {
                const parent = op.parentId ? getNode(op.parentId) : (op.parentPath ? getNodeByPath(op.parentPath) : undefined);
                if (!parent) throw new Error(`Parent not found: ${op.parentId ?? op.parentPath}`);
                const comment = createNode({ type: 'comment', content: op.content, author: op.author, parentId: parent.id });
                results.push({ op: 'reply', status: 'ok', result: comment });
                break;
              }
              case 'delete': {
                const toDelete = op.id ? getNode(op.id) : (op.path ? getNodeByPath(op.path) : undefined);
                if (!toDelete) throw new Error(`Node not found: ${op.id ?? op.path}`);
                deleteNode(toDelete.id);
                results.push({ op: 'delete', status: 'ok' });
                break;
              }
              default:
                results.push({ op: op.action ?? 'unknown', status: 'error', error: `Unknown action: ${op.action}` });
            }
          } catch (err) {
            results.push({ op: op.action ?? 'unknown', status: 'error', error: err instanceof Error ? err.message : String(err) });
          }
        }

        if (opts.json) {
          console.log(formatJson(results));
        } else {
          const ok = results.filter(r => r.status === 'ok').length;
          const fail = results.filter(r => r.status === 'error').length;
          console.log(`Batch complete: ${chalk.green(ok + ' ok')} ${fail > 0 ? chalk.red(fail + ' errors') : ''}`);
          for (const r of results.filter(r => r.status === 'error')) {
            console.log(`  ${chalk.red('!')} ${r.op}: ${r.error}`);
          }
        }
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : err}`);
        process.exitCode = 1;
      }
    });

  // -- watch (poll for changes) --
  node.command('watch')
    .description('Watch for node changes in real-time (polls every 5s)')
    .option('-i, --interval <seconds>', 'Poll interval', '5')
    .option('--type <type>', 'Filter by type')
    .option('--author <name>', 'Filter by author')
    .action(async (opts) => {
      ensureDb();
      const interval = parseInt(opts.interval) * 1000;
      let lastSeen = new Date().toISOString();

      console.log(chalk.dim(`Watching for changes (every ${opts.interval}s)... Press Ctrl+C to stop.`));
      console.log('');

      const poll = () => {
        const types: Array<'space' | 'post' | 'task' | 'page' | 'comment' | 'report'> =
          opts.type ? [opts.type] : ['task', 'report', 'post', 'comment', 'page', 'space'];
        const newNodes: Node[] = [];

        for (const type of types) {
          const nodes = listNodes({
            type,
            author: opts.author || undefined,
            limit: 50,
          });
          for (const n of nodes) {
            if (n.updatedAt > lastSeen) {
              newNodes.push(n);
            }
          }
        }

        if (newNodes.length > 0) {
          newNodes.sort((a, b) => new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime());
          for (const n of newNodes) {
            const colorFn = TYPE_COLORS[n.type] ?? ((s: string) => s);
            const time = new Date(n.updatedAt).toLocaleTimeString();
            const author = n.author ? chalk.cyan(n.author) : '';
            console.log(
              `${chalk.dim(time)} ${colorFn('[' + n.type + ']')} ${n.title ?? '(untitled)'} ${author} ${chalk.dim(n.path ?? '')}`
            );
          }
          lastSeen = newNodes[newNodes.length - 1].updatedAt;
        }
      };

      // Initial poll
      poll();

      // Keep polling
      const timer = setInterval(poll, interval);
      process.on('SIGINT', () => {
        clearInterval(timer);
        console.log(chalk.dim('\nStopped watching.'));
        process.exit(0);
      });

      // Keep the process alive
      await new Promise(() => {}); // never resolves
    });

  // -- dashboard (compact terminal overview) --
  node.command('dashboard')
    .description('Show a compact status overview')
    .action(() => {
      try {
        ensureDb();
        const all = getAllNodes(100);

        const total = all.length;
        const tasks = all.filter(n => n.type === 'task');
        const openTasks = tasks.filter(n => n.status === 'open');
        const inProgress = tasks.filter(n => n.status === 'in-progress');
        const doneTasks = tasks.filter(n => n.status === 'done');
        const criticalTasks = tasks.filter(n => n.priority === 'critical' && n.status !== 'done');
        const reports = all.filter(n => n.type === 'report');

        console.log('');
        console.log(chalk.bold('  SPACE STATION DASHBOARD'));
        console.log(chalk.dim('  ' + '='.repeat(40)));
        console.log('');
        console.log(`  ${chalk.bold(String(total).padStart(4))}  total nodes`);
        console.log(`  ${chalk.yellow(String(openTasks.length).padStart(4))}  open tasks`);
        console.log(`  ${chalk.blue(String(inProgress.length).padStart(4))}  in progress`);
        console.log(`  ${chalk.green(String(doneTasks.length).padStart(4))}  completed`);
        if (criticalTasks.length > 0) {
          console.log(`  ${chalk.red(String(criticalTasks.length).padStart(4))}  ${chalk.red('CRITICAL')}`);
        }
        console.log(`  ${chalk.magenta(String(reports.length).padStart(4))}  reports`);
        console.log('');

        // Show critical tasks
        if (criticalTasks.length > 0) {
          console.log(chalk.red('  CRITICAL TASKS:'));
          for (const t of criticalTasks) {
            console.log(`    ${chalk.red('!')} ${t.title ?? t.id} ${chalk.dim(t.path ?? '')} ${t.assignee ? chalk.cyan('-> ' + t.assignee) : ''}`);
          }
          console.log('');
        }

        // Show recent activity (last 5)
        all.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
        const recent = all.slice(0, 5);
        if (recent.length > 0) {
          console.log(chalk.dim('  RECENT:'));
          for (const n of recent) {
            const colorFn = TYPE_COLORS[n.type] ?? ((s: string) => s);
            console.log(`    ${chalk.dim(timeAgo(n.updatedAt).padEnd(10))} ${colorFn('[' + n.type + ']')} ${n.title ?? '(untitled)'}`);
          }
          console.log('');
        }
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : err}`);
        process.exitCode = 1;
      }
    });

  // -- activity --
  node.command('activity')
    .description('Show recent activity across all nodes')
    .option('-n, --limit <n>', 'Max entries', '20')
    .option('--author <name>', 'Filter by author')
    .option('--type <type>', 'Filter by type')
    .option('--json', 'Output as JSON')
    .action((opts) => {
      try {
        ensureDb();
        const types: Array<'space' | 'post' | 'task' | 'page' | 'comment' | 'report'> =
          opts.type ? [opts.type] : ['task', 'report', 'post', 'comment', 'page', 'space'];
        const all: Node[] = [];
        for (const type of types) {
          all.push(...listNodes({
            type,
            author: opts.author || undefined,
            limit: parseInt(opts.limit),
          }));
        }
        // Sort by updatedAt descending
        all.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
        const results = all.slice(0, parseInt(opts.limit));

        if (opts.json) {
          console.log(formatJson(results));
          return;
        }

        if (results.length === 0) {
          console.log('No activity found.');
          return;
        }

        console.log('Recent Activity');
        console.log('================');
        for (const n of results) {
          const colorFn = TYPE_COLORS[n.type] ?? ((s: string) => s);
          const typeBadge = colorFn(`[${n.type}]`);
          const author = n.author ? chalk.cyan(n.author) : chalk.dim('system');
          const title = n.title ?? (n.content?.slice(0, 50) ?? '(untitled)');
          const path = n.path ? chalk.dim(` ${n.path}`) : '';
          console.log(`  ${chalk.dim(timeAgo(n.updatedAt).padEnd(10))} ${typeBadge} ${title}${path}`);
          console.log(`  ${' '.repeat(10)} ${author}${n.assignee ? ` -> ${chalk.yellow(n.assignee)}` : ''}`);
        }
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : err}`);
        process.exitCode = 1;
      }
    });

  // -- stats --
  node.command('stats')
    .description('Show database statistics')
    .option('--json', 'Output as JSON')
    .action((opts) => {
      try {
        ensureDb();
        // Query all node types to get full counts (bypass root-only default)
        const types: Array<'space' | 'post' | 'task' | 'page' | 'comment' | 'report'> =
          ['space', 'post', 'task', 'page', 'comment', 'report'];
        const byType: Record<string, number> = {};
        const byStatus: Record<string, number> = {};
        let total = 0;
        let openTasks = 0;
        let totalComments = 0;

        for (const type of types) {
          const nodes = listNodes({ type, limit: 100000 });
          if (nodes.length === 0) continue;
          byType[type] = nodes.length;
          total += nodes.length;
          for (const n of nodes) {
            if (n.status) byStatus[n.status] = (byStatus[n.status] ?? 0) + 1;
            if (n.type === 'task' && n.status === 'open') openTasks++;
            if (n.type === 'comment') totalComments++;
          }
        }

        const roots = listNodes({ depth: 0, limit: 100000 });

        const stats = {
          total,
          spaces: roots.length,
          byType,
          byStatus,
          openTasks,
          totalComments,
        };

        if (opts.json) {
          console.log(formatJson(stats));
          return;
        }

        console.log('Node Database Statistics');
        console.log('========================');
        console.log(`Total nodes:    ${stats.total}`);
        console.log(`Root spaces:    ${stats.spaces}`);
        console.log(`Open tasks:     ${stats.openTasks}`);
        console.log(`Comments:       ${stats.totalComments}`);
        console.log('');
        if (Object.keys(byType).length) {
          console.log('By type:');
          for (const [type, count] of Object.entries(byType).sort((a, b) => b[1] - a[1])) {
            console.log(`  ${type.padEnd(12)} ${count}`);
          }
        }
        if (Object.keys(byStatus).length) {
          console.log('');
          console.log('By status:');
          for (const [status, count] of Object.entries(byStatus).sort((a, b) => b[1] - a[1])) {
            console.log(`  ${status.padEnd(14)} ${count}`);
          }
        }
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : err}`);
        process.exitCode = 1;
      }
    });

  // -- seed --
  node.command('seed')
    .description('Create default spaces (Engineering, Career, Life, Agents)')
    .option('--json', 'Output as JSON')
    .action((opts) => {
      try {
        ensureDb();
        const defaults = [
          { title: 'Engineering', type: 'space' as const },
          { title: 'Career', type: 'space' as const },
          { title: 'Life', type: 'space' as const },
          { title: 'Agents', type: 'space' as const },
        ];
        const created: Node[] = [];
        for (const def of defaults) {
          const existing = getNodeByPath(def.title.toLowerCase());
          if (existing) continue;
          created.push(createNode(def));
        }
        if (opts.json) {
          console.log(formatJson(created));
        } else if (created.length === 0) {
          console.log('Default spaces already exist.');
        } else {
          console.log(`Created ${created.length} default spaces:`);
          for (const n of created) {
            console.log(`  ${n.title} (${n.path})`);
          }
        }
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : err}`);
        process.exitCode = 1;
      }
    });

  // -- export --
  node.command('export')
    .description('Export all nodes as JSON (for backup)')
    .action(() => {
      try {
        ensureDb();
        // Collect all nodes across all types (bypasses root-only default)
        const types: Array<'space' | 'post' | 'task' | 'page' | 'comment' | 'report'> =
          ['space', 'post', 'task', 'page', 'comment', 'report'];
        const allNodes: Node[] = [];
        for (const type of types) {
          allNodes.push(...listNodes({ type, limit: 100000 }));
        }
        console.log(JSON.stringify(allNodes, null, 2));
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : err}`);
        process.exitCode = 1;
      }
    });

  // -- import --
  node.command('import')
    .description('Import nodes from JSON (stdin)')
    .option('--merge', 'Skip nodes that already exist by ID')
    .action(async (opts) => {
      try {
        ensureDb();
        const chunks: Buffer[] = [];
        for await (const chunk of process.stdin) {
          chunks.push(chunk);
        }
        const data = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
        if (!Array.isArray(data)) {
          console.error('Error: Expected a JSON array of nodes');
          process.exitCode = 1;
          return;
        }
        let imported = 0;
        let skipped = 0;
        for (const node of data) {
          if (opts.merge && getNode(node.id)) {
            skipped++;
            continue;
          }
          try {
            createNode({
              type: node.type,
              title: node.title,
              content: node.content,
              author: node.author,
              status: node.status,
              priority: node.priority,
              assignee: node.assignee,
              tags: node.tags,
              metadata: node.metadata,
              parentId: node.parentId,
            });
            imported++;
          } catch {
            skipped++;
          }
        }
        console.log(`Imported ${imported} nodes (${skipped} skipped)`);
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : err}`);
        process.exitCode = 1;
      }
    });

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
        if (!validateEnum(opts.type, VALID_TYPES, 'type')) return;
        if (opts.status && !validateEnum(opts.status, VALID_STATUSES, 'status')) return;
        if (opts.priority && !validateEnum(opts.priority, VALID_PRIORITIES, 'priority')) return;
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

  // -- my (show tasks assigned to me) --
  node.command('my <agent-name>')
    .description('Show open tasks assigned to an agent')
    .option('--json', 'Output as JSON')
    .action(async (agentName: string, opts) => {
      try {
        ensureDb();
        const tasks = listNodes({ type: 'task', assignee: agentName, limit: 100 });
        const active = tasks.filter(t => t.status !== 'done' && t.status !== 'closed');

        if (opts.json) {
          console.log(formatJson(active));
          return;
        }

        if (active.length === 0) {
          console.log(`No open tasks assigned to ${chalk.cyan(agentName)}`);
          return;
        }

        console.log(`Tasks for ${chalk.cyan(agentName)} (${active.length}):`);
        const table = new Table({
          head: ['PRIORITY', 'STATUS', 'TITLE', 'PATH'],
          style: { head: ['dim'] },
        });
        for (const t of active) {
          table.push([
            t.priority ?? '-',
            t.status ?? '-',
            t.title ?? '(untitled)',
            chalk.dim(t.path ?? ''),
          ]);
        }
        console.log(table.toString());
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : err}`);
        process.exitCode = 1;
      }
    });

  // -- escalate (flag for human attention) --
  node.command('escalate <path-or-id>')
    .description('Escalate a node (set priority to critical, add escalation comment)')
    .option('--from <name>', 'Who is escalating')
    .option('--reason <text>', 'Why this needs escalation', 'Requires immediate attention')
    .option('--json', 'Output as JSON')
    .action(async (pathOrId: string, opts) => {
      try {
        ensureDb();
        const found = resolveNode(pathOrId);
        const updated = updateNode(found.id, {
          priority: 'critical',
          status: found.status === 'done' || found.status === 'closed' ? 'open' : found.status ?? 'open',
        });

        const from = opts.from ?? 'system';
        createNode({
          type: 'comment',
          content: `ESCALATED by ${from}: ${opts.reason}`,
          author: from,
          parentId: found.id,
        });

        if (opts.json) {
          console.log(formatJson(updated));
        } else {
          console.log(`${chalk.red('ESCALATED')} "${updated.title ?? updated.id}"`);
          console.log(`  Priority set to ${chalk.red('critical')}`);
          console.log(`  Reason: ${opts.reason}`);
        }
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : err}`);
        process.exitCode = 1;
      }
    });

  // -- delegate (assign + add context comment about why) --
  node.command('delegate <path-or-id> <agent>')
    .description('Delegate a task to an agent with context')
    .option('--from <name>', 'Who is delegating')
    .option('--reason <text>', 'Why this is being delegated')
    .option('--json', 'Output as JSON')
    .action(async (pathOrId: string, agent: string, opts) => {
      try {
        ensureDb();
        const found = resolveNode(pathOrId);

        // Update assignee and status
        const updated = updateNode(found.id, {
          assignee: agent,
          status: found.status === 'done' || found.status === 'closed' ? 'open' : found.status ?? 'open',
        });

        // Add delegation comment
        const from = opts.from ?? 'system';
        const reason = opts.reason ?? 'Delegated for handling';
        const commentContent = `Delegated to ${agent} by ${from}. ${reason}`;

        createNode({
          type: 'comment',
          content: commentContent,
          author: from,
          parentId: found.id,
        });

        if (opts.json) {
          console.log(formatJson(updated));
        } else {
          console.log(`${chalk.cyan('Delegated')} "${updated.title ?? updated.id}" to ${chalk.bold(agent)}`);
          if (opts.reason) console.log(`  Reason: ${opts.reason}`);
        }
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : err}`);
        process.exitCode = 1;
      }
    });

  // -- tag (shorthand for update --add-tag) --
  node.command('tag <path-or-id> <tag>')
    .description('Add a tag to a node')
    .option('--json', 'Output as JSON')
    .action(async (pathOrId: string, tag: string, opts) => {
      try {
        ensureDb();
        const found = resolveNode(pathOrId);
        const tags = [...new Set([...found.tags, tag])];
        const updated = updateNode(found.id, { tags });
        if (opts.json) {
          console.log(formatJson(updated));
        } else {
          console.log(`Tagged "${updated.title ?? updated.id}" with ${chalk.dim('#' + tag)}`);
        }
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : err}`);
        process.exitCode = 1;
      }
    });

  // -- assign (shorthand for update --assignee) --
  node.command('assign <path-or-id> <agent>')
    .description('Assign a node to an agent (shorthand for update --assignee)')
    .option('--json', 'Output as JSON')
    .action(async (pathOrId: string, agent: string, opts) => {
      try {
        ensureDb();
        const found = resolveNode(pathOrId);
        const updated = updateNode(found.id, { assignee: agent });
        if (opts.json) {
          console.log(formatJson(updated));
        } else {
          console.log(`Assigned "${updated.title ?? updated.id}" to ${chalk.cyan(agent)}`);
        }
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : err}`);
        process.exitCode = 1;
      }
    });

  // -- close (shorthand for update --status done) --
  node.command('close <path-or-id>')
    .description('Close a node (set status to done)')
    .option('--json', 'Output as JSON')
    .action(async (pathOrId: string, opts) => {
      try {
        ensureDb();
        const found = resolveNode(pathOrId);
        const updated = updateNode(found.id, { status: 'done' });
        if (opts.json) {
          console.log(formatJson(updated));
        } else {
          console.log(`${chalk.green('Closed')} "${updated.title ?? updated.id}"`);
        }
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : err}`);
        process.exitCode = 1;
      }
    });

  // -- open (shorthand for update --status open) --
  node.command('open <path-or-id>')
    .description('Reopen a node (set status to open)')
    .option('--json', 'Output as JSON')
    .action(async (pathOrId: string, opts) => {
      try {
        ensureDb();
        const found = resolveNode(pathOrId);
        const updated = updateNode(found.id, { status: 'open' });
        if (opts.json) {
          console.log(formatJson(updated));
        } else {
          console.log(`${chalk.yellow('Reopened')} "${updated.title ?? updated.id}"`);
        }
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : err}`);
        process.exitCode = 1;
      }
    });

  // -- move --
  node.command('move <path-or-id> <new-parent>')
    .description('Move a node to a new parent')
    .option('--json', 'Output as JSON')
    .action(async (pathOrId: string, newParent: string, opts) => {
      try {
        ensureDb();
        const source = resolveNode(pathOrId);
        const target = resolveNode(newParent);
        const moved = moveNode(source.id, target.id);
        if (opts.json) {
          console.log(formatJson(moved));
        } else {
          console.log(`Moved "${moved.title ?? moved.id}" to ${moved.path}`);
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

/** Build parent->children map and find roots from a flat node array. */
function buildTreeStructure(flat: Node[]): {
  childrenMap: Map<string | null, Node[]>;
  roots: Node[];
} {
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
  return { childrenMap, roots };
}

function renderTree(flat: Node[]): void {
  const { childrenMap, roots } = buildTreeStructure(flat);

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
  const { childrenMap, roots } = buildTreeStructure(flat);

  function nest(node: Node): Record<string, unknown> {
    const children = (childrenMap.get(node.id) ?? []).map(nest);
    return { ...node, children };
  }

  return roots.map(nest);
}

// timeAgo imported from formatters.ts
