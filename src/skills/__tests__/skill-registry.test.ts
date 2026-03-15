import { SkillLoader } from '../skill-loader.js';
import { SkillRegistry } from '../skill-registry.js';
import type { Skill, SkillSource } from '../skill-types.js';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

async function createSkill(
  baseDir: string,
  name: string,
  frontmatter: Record<string, unknown>,
  body: string,
): Promise<string> {
  const dir = join(baseDir, name);
  await mkdir(dir, { recursive: true });
  const fm = Object.entries(frontmatter)
    .map(([k, v]) => {
      if (Array.isArray(v)) {
        const items = v.map((i) => `  - ${JSON.stringify(i)}`).join('\n');
        return `${k}:\n${items}`;
      }
      return `${k}: ${JSON.stringify(v)}`;
    })
    .join('\n');
  await writeFile(join(dir, 'SKILL.md'), `---\n${fm}\n---\n\n${body}`);
  return dir;
}

function makeSkill(overrides: Partial<Skill> & { id: string; name: string; description: string }): Skill {
  return {
    version: '1.0.0',
    content: '',
    userInvocable: false,
    source: 'shared',
    filePath: '/tmp/fake/SKILL.md',
    ...overrides,
  };
}

// ── SkillLoader ──────────────────────────────────────

describe('SkillLoader', () => {
  let loader: SkillLoader;
  let tempDir: string;

  beforeEach(async () => {
    loader = new SkillLoader();
    tempDir = await mkdtemp(join(tmpdir(), 'skill-test-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('discoverSkills', () => {
    test('finds skills with SKILL.md files', async () => {
      await createSkill(tempDir, 'check-inbox', { name: 'check-inbox', description: 'Check inbox' }, 'body');
      await createSkill(tempDir, 'summarize', { name: 'summarize', description: 'Summarize' }, 'body');

      const manifests = await loader.discoverSkills(tempDir, 'shared');
      expect(manifests).toHaveLength(2);
      expect(manifests.map((m) => m.name).sort()).toEqual(['check-inbox', 'summarize']);
    });

    test('skips directories without SKILL.md', async () => {
      await createSkill(tempDir, 'valid', { name: 'valid', description: 'Valid' }, 'body');
      await mkdir(join(tempDir, 'no-skill'));

      const manifests = await loader.discoverSkills(tempDir, 'shared');
      expect(manifests).toHaveLength(1);
      expect(manifests[0].name).toBe('valid');
    });

    test('returns empty array for non-existent directory', async () => {
      const manifests = await loader.discoverSkills('/tmp/nonexistent-dir-xyz', 'shared');
      expect(manifests).toEqual([]);
    });

    test('returns empty array for empty directory', async () => {
      const manifests = await loader.discoverSkills(tempDir, 'shared');
      expect(manifests).toEqual([]);
    });

    test('sets correct source and agentName', async () => {
      await createSkill(tempDir, 'skill-a', { name: 'skill-a', description: 'A' }, 'body');

      const manifests = await loader.discoverSkills(tempDir, 'agent', 'email-agent');
      expect(manifests[0].source).toBe('agent');
      expect(manifests[0].agentName).toBe('email-agent');
    });
  });

  describe('loadSkill', () => {
    test('loads skill with full frontmatter', async () => {
      await createSkill(tempDir, 'full', {
        name: 'Full Skill',
        description: 'A full skill',
        version: '2.0.0',
        'allowed-tools': ['Read', 'Write'],
        'user-invocable': true,
        tags: ['email', 'monitoring'],
      }, '# Instructions\n\nDo the thing.');

      const skill = await loader.loadSkill(join(tempDir, 'full', 'SKILL.md'), 'shared');
      expect(skill.name).toBe('Full Skill');
      expect(skill.description).toBe('A full skill');
      expect(skill.version).toBe('2.0.0');
      expect(skill.allowedTools).toEqual(['Read', 'Write']);
      expect(skill.userInvocable).toBe(true);
      expect(skill.tags).toEqual(['email', 'monitoring']);
    });

    test('loads skill with minimal frontmatter', async () => {
      await createSkill(tempDir, 'minimal', { name: 'Minimal', description: 'A minimal skill' }, 'Content here.');

      const skill = await loader.loadSkill(join(tempDir, 'minimal', 'SKILL.md'), 'shared');
      expect(skill.name).toBe('Minimal');
      expect(skill.description).toBe('A minimal skill');
      expect(skill.version).toBe('1.0.0');
      expect(skill.userInvocable).toBe(false);
      expect(skill.allowedTools).toBeUndefined();
      expect(skill.tags).toBeUndefined();
    });

    test('applies default version "1.0.0"', async () => {
      await createSkill(tempDir, 'no-ver', { name: 'x', description: 'x' }, '');
      const skill = await loader.loadSkill(join(tempDir, 'no-ver', 'SKILL.md'), 'shared');
      expect(skill.version).toBe('1.0.0');
    });

    test('applies default userInvocable false', async () => {
      await createSkill(tempDir, 'no-ui', { name: 'x', description: 'x' }, '');
      const skill = await loader.loadSkill(join(tempDir, 'no-ui', 'SKILL.md'), 'shared');
      expect(skill.userInvocable).toBe(false);
    });

    test('parses allowed-tools array', async () => {
      await createSkill(tempDir, 'tools', {
        name: 'x',
        description: 'x',
        'allowed-tools': ['Bash', 'Read', 'Grep'],
      }, '');
      const skill = await loader.loadSkill(join(tempDir, 'tools', 'SKILL.md'), 'shared');
      expect(skill.allowedTools).toEqual(['Bash', 'Read', 'Grep']);
    });

    test('parses tags array', async () => {
      await createSkill(tempDir, 'tagged', {
        name: 'x',
        description: 'x',
        tags: ['a', 'b'],
      }, '');
      const skill = await loader.loadSkill(join(tempDir, 'tagged', 'SKILL.md'), 'shared');
      expect(skill.tags).toEqual(['a', 'b']);
    });

    test('extracts content body without frontmatter', async () => {
      await createSkill(tempDir, 'body', { name: 'x', description: 'x' }, '# Title\n\nSome instructions.');
      const skill = await loader.loadSkill(join(tempDir, 'body', 'SKILL.md'), 'shared');
      expect(skill.content).toBe('# Title\n\nSome instructions.');
    });

    test('throws on missing name', async () => {
      await createSkill(tempDir, 'no-name', { description: 'x' }, '');
      await expect(
        loader.loadSkill(join(tempDir, 'no-name', 'SKILL.md'), 'shared'),
      ).rejects.toThrow(/missing required field "name"/);
    });

    test('throws on missing description', async () => {
      await createSkill(tempDir, 'no-desc', { name: 'x' }, '');
      await expect(
        loader.loadSkill(join(tempDir, 'no-desc', 'SKILL.md'), 'shared'),
      ).rejects.toThrow(/missing required field "description"/);
    });

    test('throws if SKILL.md does not exist', async () => {
      await expect(
        loader.loadSkill('/tmp/nonexistent/SKILL.md', 'shared'),
      ).rejects.toThrow();
    });

    test('sets correct source, agentId, agentName', async () => {
      await createSkill(tempDir, 'agent-skill', { name: 'x', description: 'x' }, '');
      const skill = await loader.loadSkill(
        join(tempDir, 'agent-skill', 'SKILL.md'),
        'agent',
        'agent-123',
        'email-agent',
      );
      expect(skill.source).toBe('agent');
      expect(skill.agentId).toBe('agent-123');
      expect(skill.agentName).toBe('email-agent');
    });

    test('generates id from directory name', async () => {
      await createSkill(tempDir, 'check-inbox', { name: 'Check Inbox', description: 'x' }, '');
      const skill = await loader.loadSkill(join(tempDir, 'check-inbox', 'SKILL.md'), 'shared');
      expect(skill.id).toBe('check-inbox');
    });
  });
});

// ── SkillRegistry ────────────────────────────────────

describe('SkillRegistry', () => {
  let registry: SkillRegistry;

  beforeEach(() => {
    registry = new SkillRegistry();
  });

  describe('register', () => {
    test('registers a skill', () => {
      const skill = makeSkill({ id: 'summarize', name: 'Summarize', description: 'Summarize stuff' });
      registry.register(skill);
      expect(registry.get('summarize')).toBe(skill);
    });

    test('tracks agent-specific skills separately', () => {
      const skill = makeSkill({
        id: 'check-inbox',
        name: 'Check Inbox',
        description: 'Check',
        source: 'agent',
        agentName: 'email-agent',
      });
      registry.register(skill);
      expect(registry.get('email-agent:check-inbox')).toBe(skill);
      expect(registry.get('check-inbox')).toBeUndefined();
    });
  });

  describe('get', () => {
    test('retrieves skill by id', () => {
      const skill = makeSkill({ id: 'summarize', name: 'Summarize', description: 'Sum' });
      registry.register(skill);
      expect(registry.get('summarize')?.name).toBe('Summarize');
    });

    test('returns undefined for non-existent skill', () => {
      expect(registry.get('nope')).toBeUndefined();
    });
  });

  describe('list', () => {
    test('returns all skills', () => {
      registry.register(makeSkill({ id: 'a', name: 'A', description: 'A' }));
      registry.register(makeSkill({ id: 'b', name: 'B', description: 'B' }));
      expect(registry.list()).toHaveLength(2);
    });

    test('filters by agent name (agent + shared + global)', () => {
      registry.register(makeSkill({
        id: 'agent-only',
        name: 'Agent Only',
        description: 'x',
        source: 'agent',
        agentName: 'email-agent',
      }));
      registry.register(makeSkill({ id: 'shared-skill', name: 'Shared', description: 'x', source: 'shared' }));
      registry.register(makeSkill({ id: 'global-skill', name: 'Global', description: 'x', source: 'global' }));
      registry.register(makeSkill({
        id: 'other-agent',
        name: 'Other',
        description: 'x',
        source: 'agent',
        agentName: 'other-agent',
      }));

      const result = registry.list('email-agent');
      expect(result).toHaveLength(3);
      const names = result.map((s) => s.name).sort();
      expect(names).toEqual(['Agent Only', 'Global', 'Shared']);
    });

    test('returns empty array when no skills registered', () => {
      expect(registry.list()).toEqual([]);
    });
  });

  describe('search', () => {
    beforeEach(() => {
      registry.register(makeSkill({ id: 'check-inbox', name: 'Check Inbox', description: 'Check email', tags: ['email'] }));
      registry.register(makeSkill({ id: 'summarize', name: 'Summarize', description: 'Generate summary', tags: ['report'] }));
    });

    test('searches by name', () => {
      const results = registry.search('Check');
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('check-inbox');
    });

    test('searches by description', () => {
      const results = registry.search('summary');
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('summarize');
    });

    test('searches by tags', () => {
      const results = registry.search('email');
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('check-inbox');
    });

    test('case-insensitive search', () => {
      expect(registry.search('CHECK')).toHaveLength(1);
      expect(registry.search('check')).toHaveLength(1);
    });

    test('returns empty for no matches', () => {
      expect(registry.search('nonexistent')).toEqual([]);
    });
  });

  describe('resolveForAgent', () => {
    beforeEach(() => {
      registry.register(makeSkill({
        id: 'check-inbox',
        name: 'Check Inbox',
        description: 'Agent version',
        source: 'agent',
        agentName: 'email-agent',
      }));
      registry.register(makeSkill({
        id: 'check-inbox',
        name: 'Check Inbox',
        description: 'Shared version',
        source: 'shared',
      }));
      registry.register(makeSkill({
        id: 'summarize',
        name: 'Summarize',
        description: 'Global version',
        source: 'global',
      }));
      registry.register(makeSkill({
        id: 'shared-only',
        name: 'Shared Only',
        description: 'Shared only skill',
        source: 'shared',
      }));
    });

    test('returns agent-specific + shared + global skills', () => {
      const resolved = registry.resolveForAgent('email-agent');
      expect(resolved).toHaveLength(3);
    });

    test('agent-specific overrides shared with same name', () => {
      const resolved = registry.resolveForAgent('email-agent');
      const checkInbox = resolved.find((s) => s.id === 'check-inbox');
      expect(checkInbox?.description).toBe('Agent version');
      expect(checkInbox?.source).toBe('agent');
    });

    test('shared overrides global with same name', () => {
      registry.register(makeSkill({
        id: 'summarize',
        name: 'Summarize',
        description: 'Shared summarize',
        source: 'shared',
      }));
      const resolved = registry.resolveForAgent('email-agent');
      const summarize = resolved.find((s) => s.id === 'summarize');
      expect(summarize?.description).toBe('Shared summarize');
      expect(summarize?.source).toBe('shared');
    });

    test('respects includeShared option', () => {
      const resolved = registry.resolveForAgent('email-agent', { includeShared: false });
      const ids = resolved.map((s) => s.id);
      expect(ids).not.toContain('shared-only');
    });

    test('respects includeGlobal option', () => {
      const resolved = registry.resolveForAgent('email-agent', { includeGlobal: false });
      const ids = resolved.map((s) => s.id);
      expect(ids).not.toContain('summarize');
    });
  });

  describe('count', () => {
    test('returns number of registered skills', () => {
      expect(registry.count()).toBe(0);
      registry.register(makeSkill({ id: 'a', name: 'A', description: 'A' }));
      expect(registry.count()).toBe(1);
    });
  });

  describe('clear', () => {
    test('removes all skills', () => {
      registry.register(makeSkill({ id: 'a', name: 'A', description: 'A' }));
      registry.register(makeSkill({ id: 'b', name: 'B', description: 'B' }));
      registry.clear();
      expect(registry.count()).toBe(0);
      expect(registry.list()).toEqual([]);
    });

    test('resets agent skill tracking', () => {
      registry.register(makeSkill({
        id: 'x',
        name: 'X',
        description: 'X',
        source: 'agent',
        agentName: 'agent-a',
      }));
      registry.clear();
      expect(registry.list('agent-a')).toEqual([]);
    });
  });
});

// ── Integration: discover + load + register ──────────

describe('SkillRegistry integration', () => {
  let registry: SkillRegistry;
  let tempDir: string;

  beforeEach(async () => {
    registry = new SkillRegistry();
    tempDir = await mkdtemp(join(tmpdir(), 'skill-int-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test('discoverSkills + loadAll registers skills', async () => {
    await createSkill(tempDir, 'skill-a', { name: 'Skill A', description: 'A' }, 'Body A');
    await createSkill(tempDir, 'skill-b', { name: 'Skill B', description: 'B' }, 'Body B');

    await registry.discoverSkills([{ path: tempDir, source: 'shared' }]);
    const loaded = await registry.loadAll();

    expect(loaded).toHaveLength(2);
    expect(registry.count()).toBe(2);
    expect(registry.get('skill-a')?.name).toBe('Skill A');
    expect(registry.get('skill-b')?.name).toBe('Skill B');
  });

  test('loadAndRegister loads a single manifest', async () => {
    await createSkill(tempDir, 'single', { name: 'Single', description: 'One' }, 'Content');

    const manifests = await registry.discoverSkills([{ path: tempDir, source: 'global' }]);
    expect(manifests).toHaveLength(1);

    const skill = await registry.loadAndRegister(manifests[0]);
    expect(skill.name).toBe('Single');
    expect(skill.source).toBe('global');
    expect(registry.get('single')).toBe(skill);
  });
});
