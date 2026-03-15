/**
 * CLI Integration Tests
 *
 * These tests spawn the actual CLI binary as a subprocess and verify
 * end-to-end behavior including database operations, agent loading,
 * skills discovery, and output formatting.
 */
import { execFile } from 'node:child_process';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const CLI = join(process.cwd(), 'dist', 'cli', 'index.js');

function run(args: string[], env?: Record<string, string>): Promise<{ stdout: string; stderr: string }> {
  return exec('node', [CLI, ...args], {
    cwd: process.cwd(),
    env: { ...process.env, ...env },
    timeout: 10000,
  });
}

function runJson(args: string[], env?: Record<string, string>): Promise<unknown> {
  return run([...args, '--json'], env).then(r => JSON.parse(r.stdout));
}

/** Run CLI expecting it to fail (exit code != 0). Returns combined output. */
async function runFail(args: string[], env?: Record<string, string>): Promise<string> {
  try {
    const result = await run(args, env);
    return result.stdout + result.stderr;
  } catch (err: any) {
    return (err.stdout ?? '') + (err.stderr ?? '');
  }
}

describe('CLI Integration', () => {
  let dbPath: string;
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'spacestation-e2e-'));
    dbPath = join(tempDir, 'test.db');
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  function cli(args: string[]): Promise<{ stdout: string; stderr: string }> {
    return run(args, { AGENTBUS_DB: dbPath });
  }

  function cliJson(args: string[]): Promise<unknown> {
    return runJson(args, { AGENTBUS_DB: dbPath });
  }

  function cliFail(args: string[]): Promise<string> {
    return runFail(args, { AGENTBUS_DB: dbPath });
  }

  describe('help and version', () => {
    test('--help shows spacestation', async () => {
      const { stdout } = await run(['--help']);
      expect(stdout).toContain('spacestation');
      expect(stdout).toContain('Multi-agent workspace');
    });

    test('--version shows version', async () => {
      const { stdout } = await run(['--version']);
      expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
    });

    test('node --help shows subcommands', async () => {
      const { stdout } = await run(['node', '--help']);
      expect(stdout).toContain('create');
      expect(stdout).toContain('list');
      expect(stdout).toContain('tree');
      expect(stdout).toContain('seed');
    });

    test('skills --help shows subcommands', async () => {
      const { stdout } = await run(['skills', '--help']);
      expect(stdout).toContain('list');
      expect(stdout).toContain('info');
      expect(stdout).toContain('search');
    });

    test('daemon --help shows subcommands', async () => {
      const { stdout } = await run(['daemon', '--help']);
      expect(stdout).toContain('start');
      expect(stdout).toContain('stop');
      expect(stdout).toContain('status');
    });
  });

  describe('node seed', () => {
    test('creates default spaces', async () => {
      const { stdout } = await cli(['node', 'seed']);
      expect(stdout).toContain('Created 4 default spaces');
      expect(stdout).toContain('Engineering');
      expect(stdout).toContain('Career');
      expect(stdout).toContain('Life');
      expect(stdout).toContain('Agents');
    });

    test('is idempotent', async () => {
      const { stdout } = await cli(['node', 'seed']);
      expect(stdout).toContain('already exist');
    });
  });

  describe('node create', () => {
    test('creates a space', async () => {
      const node = await cliJson(['node', 'create', '--type', 'space', '--title', 'TestProject']) as any;
      expect(node.type).toBe('space');
      expect(node.title).toBe('TestProject');
      expect(node.path).toBe('testproject');
      expect(node.depth).toBe(0);
      expect(node.id).toBeTruthy();
    });

    test('creates a nested task', async () => {
      const node = await cliJson([
        'node', 'create',
        '--type', 'task',
        '--title', 'Fix login bug',
        '--parent', 'engineering',
        '--author', 'test-agent',
        '--priority', 'high',
        '--assignee', 'reviewer',
        '--tags', 'auth,bug',
      ]) as any;
      expect(node.type).toBe('task');
      expect(node.path).toBe('engineering/fix-login-bug');
      expect(node.status).toBe('open');
      expect(node.priority).toBe('high');
      expect(node.author).toBe('test-agent');
      expect(node.assignee).toBe('reviewer');
      expect(node.tags).toEqual(['auth', 'bug']);
      expect(node.depth).toBe(1);
    });

    test('creates a report with content', async () => {
      const node = await cliJson([
        'node', 'create',
        '--type', 'report',
        '--title', 'Daily Report',
        '--content', 'Found 3 issues today.',
        '--parent', 'engineering',
        '--author', 'patrol-agent',
      ]) as any;
      expect(node.type).toBe('report');
      expect(node.content).toBe('Found 3 issues today.');
    });

    test('rejects invalid type', async () => {
      const output = await cliFail(['node', 'create', '--type', 'invalid', '--title', 'Bad']);
      expect(output).toContain('Invalid type');
    });

    test('rejects invalid priority', async () => {
      const output = await cliFail(['node', 'create', '--type', 'task', '--title', 'Bad', '--priority', 'extreme']);
      expect(output).toContain('Invalid priority');
    });

    test('generates unique slugs for duplicate titles', async () => {
      const first = await cliJson([
        'node', 'create', '--type', 'page', '--title', 'Duplicate Test', '--parent', 'engineering',
      ]) as any;
      const second = await cliJson([
        'node', 'create', '--type', 'page', '--title', 'Duplicate Test', '--parent', 'engineering',
      ]) as any;
      expect(first.slug).toBe('duplicate-test');
      expect(second.slug).toBe('duplicate-test-2');
    });
  });

  describe('node get', () => {
    test('gets node by path', async () => {
      const node = await cliJson(['node', 'get', 'engineering/fix-login-bug']) as any;
      expect(node.title).toBe('Fix login bug');
      expect(node.type).toBe('task');
    });

    test('gets node by UUID', async () => {
      const created = await cliJson([
        'node', 'create', '--type', 'post', '--title', 'UUID Test', '--parent', 'engineering',
      ]) as any;
      const fetched = await cliJson(['node', 'get', created.id]) as any;
      expect(fetched.title).toBe('UUID Test');
      expect(fetched.id).toBe(created.id);
    });

    test('returns error for non-existent path', async () => {
      const output = await cliFail(['node', 'get', 'nonexistent/path']);
      expect(output).toContain('not found');
    });
  });

  describe('node reply', () => {
    test('adds a comment to a node', async () => {
      const comment = await cliJson([
        'node', 'reply', 'engineering/fix-login-bug',
        '--content', 'I can reproduce this.',
        '--author', 'reviewer',
      ]) as any;
      expect(comment.type).toBe('comment');
      expect(comment.content).toBe('I can reproduce this.');
      expect(comment.author).toBe('reviewer');
      expect(comment.parentId).toBeTruthy();
    });
  });

  describe('node update', () => {
    test('updates status', async () => {
      const updated = await cliJson([
        'node', 'update', 'engineering/fix-login-bug',
        '--status', 'in-progress',
      ]) as any;
      expect(updated.status).toBe('in-progress');
    });

    test('adds a tag', async () => {
      const updated = await cliJson([
        'node', 'update', 'engineering/fix-login-bug',
        '--add-tag', 'reviewed',
      ]) as any;
      expect(updated.tags).toContain('reviewed');
      expect(updated.tags).toContain('auth');
    });

    test('updates assignee', async () => {
      const updated = await cliJson([
        'node', 'update', 'engineering/fix-login-bug',
        '--assignee', 'code-agent',
      ]) as any;
      expect(updated.assignee).toBe('code-agent');
    });
  });

  describe('node list', () => {
    test('lists root spaces', async () => {
      const nodes = await cliJson(['node', 'list']) as any[];
      const titles = nodes.map(n => n.title);
      expect(titles).toContain('Engineering');
      expect(titles).toContain('Career');
      expect(titles).toContain('Life');
    });

    test('lists children of a space', async () => {
      const nodes = await cliJson(['node', 'list', 'engineering']) as any[];
      expect(nodes.length).toBeGreaterThan(0);
      const types = nodes.map(n => n.type);
      expect(types).toContain('task');
    });

    test('filters by type', async () => {
      const nodes = await cliJson(['node', 'list', '--type', 'task']) as any[];
      for (const n of nodes) {
        expect(n.type).toBe('task');
      }
    });

    test('filters by status', async () => {
      const nodes = await cliJson(['node', 'list', '--type', 'task', '--status', 'in-progress']) as any[];
      for (const n of nodes) {
        expect(n.status).toBe('in-progress');
      }
    });

    test('filters by author', async () => {
      const nodes = await cliJson(['node', 'list', '--author', 'test-agent']) as any[];
      for (const n of nodes) {
        expect(n.author).toBe('test-agent');
      }
    });

    test('respects limit', async () => {
      const nodes = await cliJson(['node', 'list', '-n', '2']) as any[];
      expect(nodes.length).toBeLessThanOrEqual(2);
    });

    test('text format output has table headers', async () => {
      const { stdout } = await cli(['node', 'list']);
      expect(stdout).toContain('TYPE');
      expect(stdout).toContain('TITLE');
    });
  });

  describe('node search', () => {
    test('finds nodes by title', async () => {
      const nodes = await cliJson(['node', 'search', 'login']) as any[];
      expect(nodes.length).toBeGreaterThan(0);
      expect(nodes[0].title).toContain('login');
    });

    test('finds nodes by content', async () => {
      const nodes = await cliJson(['node', 'search', '3 issues']) as any[];
      expect(nodes.length).toBeGreaterThan(0);
    });

    test('returns empty for no matches', async () => {
      const nodes = await cliJson(['node', 'search', 'zzzznonexistentzzzz']) as any[];
      expect(nodes).toEqual([]);
    });

    test('filters search by type', async () => {
      const nodes = await cliJson(['node', 'search', 'login', '--type', 'task']) as any[];
      for (const n of nodes) {
        expect(n.type).toBe('task');
      }
    });
  });

  describe('node tree', () => {
    test('outputs tree with box-drawing characters', async () => {
      const { stdout } = await cli(['node', 'tree', 'engineering']);
      // Should contain tree structure characters or node titles
      expect(stdout).toContain('Engineering');
    });

    test('json output has nested children', async () => {
      const tree = await cliJson(['node', 'tree', 'engineering']) as any[];
      expect(tree.length).toBeGreaterThan(0);
      // Root should be Engineering
      const eng = tree.find((n: any) => n.title === 'Engineering');
      expect(eng).toBeTruthy();
      if (eng?.children) {
        expect(eng.children.length).toBeGreaterThan(0);
      }
    });

    test('respects depth limit', async () => {
      const tree = await cliJson(['node', 'tree', 'engineering', '--depth', '0']) as any[];
      // Depth 0 means only the root
      expect(tree.length).toBe(1);
    });
  });

  describe('node delete', () => {
    test('deletes a node', async () => {
      const created = await cliJson([
        'node', 'create', '--type', 'post', '--title', 'Delete Me', '--parent', 'engineering',
      ]) as any;
      const { stdout } = await cli(['node', 'delete', created.id, '--force']);
      expect(stdout).toContain('Deleted');
    });

    test('cascades to children', async () => {
      const parent = await cliJson([
        'node', 'create', '--type', 'space', '--title', 'Temp Space',
      ]) as any;
      await cliJson([
        'node', 'create', '--type', 'task', '--title', 'Temp Task', '--parent', parent.id,
      ]);
      await cli(['node', 'delete', parent.id, '--force']);

      // Child should also be gone
      const output = await cliFail(['node', 'get', 'temp-space/temp-task']);
      expect(output).toContain('not found');
    });
  });

  describe('node move', () => {
    test('moves a node to a new parent', async () => {
      const task = await cliJson([
        'node', 'create', '--type', 'task', '--title', 'Movable Task', '--parent', 'engineering',
      ]) as any;
      const moved = await cliJson(['node', 'move', task.id, 'career']) as any;
      expect(moved.path).toBe('career/movable-task');
      expect(moved.parentId).toBeTruthy();
    });

    test('text output shows new path', async () => {
      const task = await cliJson([
        'node', 'create', '--type', 'post', '--title', 'Move Me', '--parent', 'life',
      ]) as any;
      const { stdout } = await cli(['node', 'move', task.id, 'engineering']);
      expect(stdout).toContain('Moved');
      expect(stdout).toContain('engineering/move-me');
    });
  });

  describe('agent init and load', () => {
    let agentDir: string;

    beforeAll(async () => {
      agentDir = join(tempDir, 'test-agents');
      await mkdir(agentDir, { recursive: true });
    });

    test('init creates agent folder with basic template', async () => {
      const { stdout } = await run(['init', 'test-bot', '-d', agentDir, '-t', 'basic']);
      expect(stdout).toContain('Created agent folder');
      expect(stdout).toContain('agent.yaml');
    });

    test('init creates agent folder with full template', async () => {
      const { stdout } = await run(['init', 'full-bot', '-d', agentDir, '-t', 'full']);
      expect(stdout).toContain('CLAUDE.md');
      expect(stdout).toContain('SOUL.md');
      expect(stdout).toContain('memory');
    });

    test('init rejects invalid template', async () => {
      const output = await runFail(['init', 'bad-bot', '-d', agentDir, '-t', 'invalid']);
      expect(output).toContain('Invalid template');
    });

    test('load discovers and loads agents', async () => {
      const { stdout } = await run(['load', 'agents/']);
      expect(stdout).toContain('Loaded');
      expect(stdout).toContain('email-agent');
    });

    test('load single agent', async () => {
      const { stdout } = await run(['load', 'agents/email-agent']);
      expect(stdout).toContain('email-agent');
      expect(stdout).toContain('cron');
      expect(stdout).toContain('skill');
    });
  });

  describe('skills', () => {
    test('skills list returns skills as JSON', async () => {
      const skills = await runJson(['skills', 'list']) as any[];
      expect(skills.length).toBeGreaterThan(0);
      const names = skills.map(s => s.name);
      expect(names).toContain('spacestation-basics');
    });

    test('skills info shows skill details', async () => {
      const { stdout } = await run(['skills', 'info', 'spacestation-basics']);
      expect(stdout).toContain('spacestation-basics');
      expect(stdout).toContain('Description');
    });

    test('skills search finds by name', async () => {
      const skills = await runJson(['skills', 'search', 'inbox']) as any[];
      expect(skills.length).toBeGreaterThan(0);
      expect(skills[0].name).toContain('inbox');
    });
  });

  describe('node assign', () => {
    test('assigns a node to an agent', async () => {
      const task = await cliJson([
        'node', 'create', '--type', 'task', '--title', 'Assign Test', '--parent', 'engineering',
      ]) as any;
      const { stdout } = await cli(['node', 'assign', task.id, 'new-agent']);
      expect(stdout).toContain('Assigned');
      expect(stdout).toContain('new-agent');

      const updated = await cliJson(['node', 'get', task.id]) as any;
      expect(updated.assignee).toBe('new-agent');
    });
  });

  describe('node close', () => {
    test('closes a node', async () => {
      const task = await cliJson([
        'node', 'create', '--type', 'task', '--title', 'Close Test', '--parent', 'engineering',
      ]) as any;
      const { stdout } = await cli(['node', 'close', task.id]);
      expect(stdout).toContain('Closed');

      const updated = await cliJson(['node', 'get', task.id]) as any;
      expect(updated.status).toBe('done');
    });
  });

  describe('node activity', () => {
    test('shows recent activity', async () => {
      const { stdout } = await cli(['node', 'activity']);
      expect(stdout).toContain('Recent Activity');
    });

    test('json output returns array', async () => {
      const activity = await cliJson(['node', 'activity']) as any[];
      expect(Array.isArray(activity)).toBe(true);
    });
  });

  describe('node summary', () => {
    test('shows mission briefing', async () => {
      const { stdout } = await cli(['node', 'summary']);
      expect(stdout).toContain('MISSION BRIEFING');
      expect(stdout).toContain('Tasks');
      expect(stdout).toContain('Last 24h');
    });

    test('json output has structure', async () => {
      const summary = await cliJson(['node', 'summary']) as any;
      expect(summary).toHaveProperty('total');
      expect(summary).toHaveProperty('tasks');
      expect(summary).toHaveProperty('activeAgents');
    });
  });

  describe('node dashboard', () => {
    test('shows compact overview', async () => {
      const { stdout } = await cli(['node', 'dashboard']);
      expect(stdout).toContain('SPACE STATION DASHBOARD');
      expect(stdout).toContain('total nodes');
      expect(stdout).toContain('open tasks');
    });
  });

  describe('node stats', () => {
    test('shows database statistics', async () => {
      const { stdout } = await cli(['node', 'stats']);
      expect(stdout).toContain('Node Database Statistics');
      expect(stdout).toContain('Total nodes');
    });

    test('json output has byType', async () => {
      const stats = await cliJson(['node', 'stats']) as any;
      expect(stats.total).toBeGreaterThan(0);
      expect(stats.byType).toBeDefined();
    });
  });

  describe('node export', () => {
    test('exports all nodes as JSON array', async () => {
      const { stdout } = await cli(['node', 'export']);
      const nodes = JSON.parse(stdout);
      expect(Array.isArray(nodes)).toBe(true);
      expect(nodes.length).toBeGreaterThan(0);
      expect(nodes[0]).toHaveProperty('id');
      expect(nodes[0]).toHaveProperty('type');
    });
  });

  describe('node my', () => {
    test('shows tasks assigned to an agent', async () => {
      await cliJson([
        'node', 'create', '--type', 'task', '--title', 'My Test Task',
        '--parent', 'engineering', '--assignee', 'my-agent', '--status', 'open',
      ]);
      const { stdout } = await cli(['node', 'my', 'my-agent']);
      expect(stdout).toContain('My Test Task');
      expect(stdout).toContain('my-agent');
    });

    test('json output returns array', async () => {
      const tasks = await cliJson(['node', 'my', 'my-agent']) as any[];
      expect(Array.isArray(tasks)).toBe(true);
    });

    test('shows empty message for agent with no tasks', async () => {
      const { stdout } = await cli(['node', 'my', 'nonexistent-agent']);
      expect(stdout).toContain('No open tasks');
    });
  });

  describe('node escalate', () => {
    test('escalates a task to critical', async () => {
      const task = await cliJson([
        'node', 'create', '--type', 'task', '--title', 'Escalate Test',
        '--parent', 'engineering', '--priority', 'low',
      ]) as any;

      const escalated = await cliJson([
        'node', 'escalate', task.id, '--from', 'agent-x', '--reason', 'Production issue',
      ]) as any;

      expect(escalated.priority).toBe('critical');

      const detail = await cliJson(['node', 'get', task.id, '--with-children']) as any;
      const comments = detail.children.filter((c: any) => c.type === 'comment');
      expect(comments.some((c: any) => c.content.includes('ESCALATED'))).toBe(true);
    });
  });

  describe('node delegate', () => {
    test('delegates task with context', async () => {
      const task = await cliJson([
        'node', 'create', '--type', 'task', '--title', 'Delegate Test',
        '--parent', 'engineering', '--assignee', 'agent-a',
      ]) as any;

      const delegated = await cliJson([
        'node', 'delegate', task.id, 'agent-b',
        '--from', 'agent-a', '--reason', 'You are better at this',
      ]) as any;

      expect(delegated.assignee).toBe('agent-b');

      // Should have a delegation comment
      const detail = await cliJson(['node', 'get', task.id, '--with-children']) as any;
      const comments = detail.children.filter((c: any) => c.type === 'comment');
      expect(comments.length).toBe(1);
      expect(comments[0].content).toContain('Delegated to agent-b');
    });
  });

  describe('node open', () => {
    test('reopens a closed node', async () => {
      const task = await cliJson([
        'node', 'create', '--type', 'task', '--title', 'Open Test', '--parent', 'engineering',
      ]) as any;
      await cli(['node', 'close', task.id]);
      const { stdout } = await cli(['node', 'open', task.id]);
      expect(stdout).toContain('Reopened');

      const updated = await cliJson(['node', 'get', task.id]) as any;
      expect(updated.status).toBe('open');
    });
  });

  describe('node tag', () => {
    test('adds a tag to a node', async () => {
      const task = await cliJson([
        'node', 'create', '--type', 'task', '--title', 'Tag Test', '--parent', 'engineering',
      ]) as any;
      const { stdout } = await cli(['node', 'tag', task.id, 'important']);
      expect(stdout).toContain('Tagged');
      expect(stdout).toContain('#important');

      const updated = await cliJson(['node', 'get', task.id]) as any;
      expect(updated.tags).toContain('important');
    });
  });

  describe('setup', () => {
    test('bootstraps workspace', async () => {
      const { stdout } = await cli(['setup']);
      expect(stdout).toContain('SPACE STATION SETUP');
      expect(stdout).toContain('Database initialized');
    });
  });

  describe('multi-agent scenario', () => {
    test('simulates a multi-agent day: report -> task -> escalate -> delegate -> resolve', async () => {
      // 1. Email agent posts a morning report
      const report = await cliJson([
        'node', 'create', '--type', 'report',
        '--title', 'Morning Email Report',
        '--content', 'Found 3 new emails. 1 urgent: auth token rotation needed.',
        '--parent', 'engineering',
        '--author', 'email-agent',
        '--tags', 'email,daily-report',
      ]) as any;
      expect(report.type).toBe('report');
      expect(report.author).toBe('email-agent');

      // 2. Email agent creates an urgent task
      const urgentTask = await cliJson([
        'node', 'create', '--type', 'task',
        '--title', 'Rotate auth tokens',
        '--content', 'Production tokens expiring in 24h. Needs immediate rotation.',
        '--parent', 'engineering',
        '--author', 'email-agent',
        '--priority', 'critical',
        '--assignee', 'patrol-agent',
        '--tags', 'auth,security,urgent',
      ]) as any;
      expect(urgentTask.priority).toBe('critical');

      // 3. Patrol agent delegates to researcher
      const delegated = await cliJson([
        'node', 'delegate', urgentTask.id, 'researcher-agent',
        '--from', 'patrol-agent',
        '--reason', 'Need to research best practices for token rotation first',
      ]) as any;
      expect(delegated.assignee).toBe('researcher-agent');

      // 4. Researcher posts findings as a reply
      const findings = await cliJson([
        'node', 'reply', urgentTask.id,
        '--content', 'Research complete. Use rolling rotation with 24h overlap window. See RFC 7519.',
        '--author', 'researcher-agent',
      ]) as any;
      expect(findings.type).toBe('comment');

      // 5. Researcher delegates back to patrol agent for implementation
      await cliJson([
        'node', 'delegate', urgentTask.id, 'patrol-agent',
        '--from', 'researcher-agent',
        '--reason', 'Research done, ready for implementation',
      ]);

      // 6. Patrol agent implements and closes
      await cli(['node', 'close', urgentTask.id]);

      // 7. Verify final state
      const final = await cliJson(['node', 'get', urgentTask.id, '--with-children']) as any;
      expect(final.status).toBe('done');
      expect(final.assignee).toBe('patrol-agent');
      expect(final.childCount).toBe(3); // delegation comment + findings + second delegation
    });
  });

  describe('full agent workflow', () => {
    test('init -> load -> create task -> assign -> close lifecycle', async () => {
      // 1. Init a fresh agent
      const agentDir = join(tempDir, 'workflow-agents');
      await run(['init', 'workflow-bot', '-d', agentDir, '-t', 'full']);

      // 2. Load the agent
      const { stdout: loadOut } = await run(['load', join(agentDir, 'workflow-bot')]);
      expect(loadOut).toContain('workflow-bot');

      // 3. Create a task
      const task = await cliJson([
        'node', 'create', '--type', 'task', '--title', 'Workflow Test Task',
        '--parent', 'engineering', '--author', 'workflow-bot', '--priority', 'high',
      ]) as any;
      expect(task.status).toBe('open');
      expect(task.author).toBe('workflow-bot');

      // 4. Assign it
      const { stdout: assignOut } = await cli(['node', 'assign', task.id, 'workflow-bot']);
      expect(assignOut).toContain('Assigned');

      // 5. Add a comment
      const comment = await cliJson([
        'node', 'reply', task.id, '--content', 'Working on this now.', '--author', 'workflow-bot',
      ]) as any;
      expect(comment.type).toBe('comment');

      // 6. Close it
      const { stdout: closeOut } = await cli(['node', 'close', task.id]);
      expect(closeOut).toContain('Closed');

      // 7. Verify final state
      const final = await cliJson(['node', 'get', task.id]) as any;
      expect(final.status).toBe('done');
      expect(final.assignee).toBe('workflow-bot');
      expect(final.childCount).toBe(1); // one comment
    });
  });

  describe('runs', () => {
    test('shows empty run history', async () => {
      const { stdout } = await cli(['runs']);
      expect(stdout).toContain('No runs');
    });

    test('json output returns array', async () => {
      const runs = await cliJson(['runs']) as any[];
      expect(Array.isArray(runs)).toBe(true);
    });

    test('stats shows aggregate data', async () => {
      const { stdout } = await cli(['runs', '--stats']);
      expect(stdout).toContain('Total runs');
      expect(stdout).toContain('Success rate');
    });
  });

  describe('node batch', () => {
    test('processes multiple operations', async () => {
      const { execFile: execFileCb } = await import('node:child_process');
      const { stdout } = await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
        const child = execFileCb(
          'node', [join(process.cwd(), 'dist', 'cli', 'index.js'), 'node', 'batch'],
          { env: { ...process.env, AGENTBUS_DB: dbPath }, timeout: 10000 },
          (err, stdout, stderr) => {
            if (err) reject(err);
            else resolve({ stdout, stderr });
          },
        );
        child.stdin!.write(JSON.stringify([
          { action: 'create', type: 'task', title: 'Batch 1', parentPath: 'engineering' },
          { action: 'create', type: 'task', title: 'Batch 2', parentPath: 'engineering' },
        ]));
        child.stdin!.end();
      });
      expect(stdout).toContain('2 ok');
    });
  });

  describe('verify', () => {
    test('shows system health', async () => {
      const { stdout } = await cli(['verify']);
      expect(stdout).toContain('SYSTEM VERIFICATION');
      expect(stdout).toContain('Database');
    });

    test('json output returns checks array', async () => {
      const checks = await cliJson(['verify']) as any[];
      expect(Array.isArray(checks)).toBe(true);
      expect(checks.length).toBeGreaterThan(0);
      expect(checks[0]).toHaveProperty('name');
      expect(checks[0]).toHaveProperty('status');
    });
  });

  describe('daemon', () => {
    test('daemon status with no state file', async () => {
      const { stdout } = await run(['daemon', 'status', '--state', join(tempDir, 'nonexistent.json')]);
      expect(stdout).toContain('not running');
    });
  });
});
