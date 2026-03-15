import { AgentLoader } from '../agent-loader.js';
import { mkdtemp, writeFile, mkdir, rm, readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { stringify } from 'yaml';

describe('AgentLoader', () => {
  let loader: AgentLoader;
  let tempDir: string;

  beforeEach(async () => {
    loader = new AgentLoader();
    tempDir = await mkdtemp(join(tmpdir(), 'agentbus-test-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  async function createAgentFolder(
    name: string,
    config: Record<string, unknown>,
    extras?: Record<string, string>,
  ): Promise<string> {
    const dir = join(tempDir, name);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'agent.yaml'), stringify(config));
    if (extras) {
      for (const [file, content] of Object.entries(extras)) {
        const filePath = join(dir, file);
        const parent = join(filePath, '..');
        await mkdir(parent, { recursive: true });
        await writeFile(filePath, content);
      }
    }
    return dir;
  }

  // --- discoverAgents ---

  describe('discoverAgents', () => {
    test('finds agent folders with agent.yaml', async () => {
      await createAgentFolder('agent-a', {
        name: 'agent-a',
        description: 'Test A',
        capabilities: ['cap-a'],
      });
      await createAgentFolder('agent-b', {
        name: 'agent-b',
        description: 'Test B',
        capabilities: ['cap-b'],
      });

      const manifests = await loader.discoverAgents(tempDir);
      expect(manifests).toHaveLength(2);
      expect(manifests[0].config.name).toBe('agent-a');
      expect(manifests[1].config.name).toBe('agent-b');
    });

    test('skips directories without agent.yaml', async () => {
      await createAgentFolder('valid', {
        name: 'valid',
        description: 'Valid',
        capabilities: ['cap'],
      });
      await mkdir(join(tempDir, 'no-yaml'));

      const manifests = await loader.discoverAgents(tempDir);
      expect(manifests).toHaveLength(1);
      expect(manifests[0].config.name).toBe('valid');
    });

    test('skips non-directory entries', async () => {
      await createAgentFolder('valid', {
        name: 'valid',
        description: 'Valid',
        capabilities: ['cap'],
      });
      await writeFile(join(tempDir, 'readme.txt'), 'not a directory');

      const manifests = await loader.discoverAgents(tempDir);
      expect(manifests).toHaveLength(1);
    });

    test('returns empty array for empty directory', async () => {
      const manifests = await loader.discoverAgents(tempDir);
      expect(manifests).toEqual([]);
    });

    test('returns manifests sorted by name', async () => {
      await createAgentFolder('zebra', {
        name: 'zebra',
        description: 'Z',
        capabilities: ['z'],
      });
      await createAgentFolder('alpha', {
        name: 'alpha',
        description: 'A',
        capabilities: ['a'],
      });

      const manifests = await loader.discoverAgents(tempDir);
      expect(manifests[0].config.name).toBe('alpha');
      expect(manifests[1].config.name).toBe('zebra');
    });

    test('throws if baseDir does not exist', async () => {
      await expect(loader.discoverAgents(join(tempDir, 'nonexistent'))).rejects.toThrow();
    });
  });

  // --- loadManifest ---

  describe('loadManifest', () => {
    test('loads minimal agent.yaml', async () => {
      const dir = await createAgentFolder('minimal', {
        name: 'minimal',
        description: 'Minimal agent',
        capabilities: ['general'],
      });

      const manifest = await loader.loadManifest(dir);
      expect(manifest.config.name).toBe('minimal');
      expect(manifest.config.description).toBe('Minimal agent');
      expect(manifest.config.capabilities).toEqual(['general']);
      expect(manifest.folderPath).toBe(dir);
    });

    test('loads agent.yaml with all fields', async () => {
      const dir = await createAgentFolder('full', {
        name: 'full',
        description: 'Full agent',
        version: '2.0.0',
        capabilities: [
          'cap-a',
          { name: 'cap-b', description: 'Complex cap', subjects: ['test.>'] },
        ],
        wakePatterns: ['full.>'],
        endpoint: 'http://localhost:3000',
        auth: { type: 'token', tokenHeader: 'Authorization' },
        status: 'online',
        metadata: { owner: 'test' },
      });

      const manifest = await loader.loadManifest(dir);
      expect(manifest.config.version).toBe('2.0.0');
      expect(manifest.config.wakePatterns).toEqual(['full.>']);
      expect(manifest.config.endpoint).toBe('http://localhost:3000');
      expect(manifest.config.auth).toEqual({ type: 'token', tokenHeader: 'Authorization' });
      expect(manifest.config.status).toBe('online');
      expect(manifest.config.metadata).toEqual({ owner: 'test' });
    });

    test('reads CLAUDE.md when present', async () => {
      const dir = await createAgentFolder(
        'with-claude',
        { name: 'with-claude', description: 'Test', capabilities: ['cap'] },
        { 'CLAUDE.md': '# Claude instructions' },
      );

      const manifest = await loader.loadManifest(dir);
      expect(manifest.identityFiles.claude).toBe('# Claude instructions');
    });

    test('reads SOUL.md when present', async () => {
      const dir = await createAgentFolder(
        'with-soul',
        { name: 'with-soul', description: 'Test', capabilities: ['cap'] },
        { 'SOUL.md': '# Soul persona' },
      );

      const manifest = await loader.loadManifest(dir);
      expect(manifest.identityFiles.soul).toBe('# Soul persona');
    });

    test('reads IDENTITY.md when present', async () => {
      const dir = await createAgentFolder(
        'with-identity',
        { name: 'with-identity', description: 'Test', capabilities: ['cap'] },
        { 'IDENTITY.md': '# Identity' },
      );

      const manifest = await loader.loadManifest(dir);
      expect(manifest.identityFiles.identity).toBe('# Identity');
    });

    test('identity files are undefined when missing', async () => {
      const dir = await createAgentFolder('bare', {
        name: 'bare',
        description: 'Test',
        capabilities: ['cap'],
      });

      const manifest = await loader.loadManifest(dir);
      expect(manifest.identityFiles.claude).toBeUndefined();
      expect(manifest.identityFiles.soul).toBeUndefined();
      expect(manifest.identityFiles.identity).toBeUndefined();
    });

    test('reads cron.yaml when present', async () => {
      const cronContent = stringify({
        jobs: [
          {
            id: 'daily-check',
            schedule: '0 0 * * *',
            description: 'Daily check',
            action: { type: 'claude', prompt: 'Check things' },
          },
        ],
      });

      const dir = await createAgentFolder(
        'with-cron',
        { name: 'with-cron', description: 'Test', capabilities: ['cap'] },
        { 'cron.yaml': cronContent },
      );

      const manifest = await loader.loadManifest(dir);
      expect(manifest.cronConfig).toBeDefined();
      expect(manifest.cronConfig!.jobs).toHaveLength(1);
      expect(manifest.cronConfig!.jobs[0].id).toBe('daily-check');
      expect(manifest.cronConfig!.jobs[0].enabled).toBe(true);
      expect(manifest.cronConfig!.jobs[0].catchUp).toBe(false);
      expect(manifest.cronConfig!.jobs[0].protect).toBe(true);
    });

    test('cronConfig is undefined when cron.yaml missing', async () => {
      const dir = await createAgentFolder('no-cron', {
        name: 'no-cron',
        description: 'Test',
        capabilities: ['cap'],
      });

      const manifest = await loader.loadManifest(dir);
      expect(manifest.cronConfig).toBeUndefined();
    });

    test('discovers skills in skills/ subdirectory', async () => {
      const dir = await createAgentFolder(
        'with-skills',
        { name: 'with-skills', description: 'Test', capabilities: ['cap'] },
        {
          'skills/summarize/SKILL.md': '# Summarize skill',
          'skills/draft-reply/SKILL.md': '# Draft reply skill',
        },
      );

      const manifest = await loader.loadManifest(dir);
      expect(manifest.skills).toHaveLength(2);
      const names = manifest.skills.map((s) => s.name).sort();
      expect(names).toEqual(['draft-reply', 'summarize']);
    });

    test('skills is empty array when no skills/ dir', async () => {
      const dir = await createAgentFolder('no-skills', {
        name: 'no-skills',
        description: 'Test',
        capabilities: ['cap'],
      });

      const manifest = await loader.loadManifest(dir);
      expect(manifest.skills).toEqual([]);
    });

    test('detects memory/ directory', async () => {
      const dir = await createAgentFolder(
        'with-memory',
        { name: 'with-memory', description: 'Test', capabilities: ['cap'] },
        { 'memory/MEMORY.md': '# Memory' },
      );

      const manifest = await loader.loadManifest(dir);
      expect(manifest.hasMemory).toBe(true);
      expect(manifest.memoryPath).toBe(join(dir, 'memory'));
    });

    test('hasMemory is false when no memory/ dir', async () => {
      const dir = await createAgentFolder('no-memory', {
        name: 'no-memory',
        description: 'Test',
        capabilities: ['cap'],
      });

      const manifest = await loader.loadManifest(dir);
      expect(manifest.hasMemory).toBe(false);
      expect(manifest.memoryPath).toBeUndefined();
    });

    test('throws on missing agent.yaml', async () => {
      const dir = join(tempDir, 'empty-dir');
      await mkdir(dir);
      await expect(loader.loadManifest(dir)).rejects.toThrow(/Missing agent\.yaml/);
    });

    test('throws on invalid YAML', async () => {
      const dir = join(tempDir, 'bad-yaml');
      await mkdir(dir);
      await writeFile(join(dir, 'agent.yaml'), '{ invalid yaml: [');
      await expect(loader.loadManifest(dir)).rejects.toThrow(/Invalid YAML/);
    });

    test('throws when name is missing', async () => {
      const dir = await createAgentFolder('no-name', {
        description: 'Test',
        capabilities: ['cap'],
      });

      await expect(loader.loadManifest(dir)).rejects.toThrow(/name/);
    });

    test('throws when description is missing', async () => {
      const dir = await createAgentFolder('no-desc', {
        name: 'no-desc',
        capabilities: ['cap'],
      });

      await expect(loader.loadManifest(dir)).rejects.toThrow(/description/);
    });

    test('throws when capabilities is empty', async () => {
      const dir = await createAgentFolder('no-caps', {
        name: 'no-caps',
        description: 'Test',
        capabilities: [],
      });

      await expect(loader.loadManifest(dir)).rejects.toThrow(/capabilities/);
    });

    test('applies default version "1.0.0"', async () => {
      const dir = await createAgentFolder('default-ver', {
        name: 'default-ver',
        description: 'Test',
        capabilities: ['cap'],
      });

      const manifest = await loader.loadManifest(dir);
      expect(manifest.config.version).toBe('1.0.0');
    });

    test('applies default status "sleeping"', async () => {
      const dir = await createAgentFolder('default-status', {
        name: 'default-status',
        description: 'Test',
        capabilities: ['cap'],
      });

      const manifest = await loader.loadManifest(dir);
      expect(manifest.config.status).toBe('sleeping');
    });

    test('validates wake patterns', async () => {
      const dir = await createAgentFolder('bad-wake', {
        name: 'bad-wake',
        description: 'Test',
        capabilities: ['cap'],
        wakePatterns: ['billing.>.invalid'],
      });

      await expect(loader.loadManifest(dir)).rejects.toThrow(/wake pattern/i);
    });

    test('validates cron action types', async () => {
      const cronContent = stringify({
        jobs: [
          {
            id: 'bad-job',
            schedule: '0 0 * * *',
            action: { type: 'invalid' },
          },
        ],
      });
      const dir = await createAgentFolder(
        'bad-cron',
        { name: 'bad-cron', description: 'Test', capabilities: ['cap'] },
        { 'cron.yaml': cronContent },
      );

      await expect(loader.loadManifest(dir)).rejects.toThrow(/action type/);
    });

    test('validates cron schedule format', async () => {
      const cronContent = stringify({
        jobs: [
          {
            id: 'bad-schedule',
            schedule: 'not a cron',
            action: { type: 'claude' },
          },
        ],
      });
      const dir = await createAgentFolder(
        'bad-schedule',
        { name: 'bad-schedule', description: 'Test', capabilities: ['cap'] },
        { 'cron.yaml': cronContent },
      );

      await expect(loader.loadManifest(dir)).rejects.toThrow(/cron expression/);
    });
  });

  // --- initAgent ---

  describe('initAgent', () => {
    test('creates basic template', async () => {
      const folderPath = await loader.initAgent(tempDir, 'basic-agent');

      expect(folderPath).toBe(join(tempDir, 'basic-agent'));
      const yamlContent = await readFile(join(folderPath, 'agent.yaml'), 'utf-8');
      expect(yamlContent).toContain('basic-agent');

      // Verify it loads correctly
      const manifest = await loader.loadManifest(folderPath);
      expect(manifest.config.name).toBe('basic-agent');
      expect(manifest.config.capabilities).toEqual(['general']);
    });

    test('creates full template with all files', async () => {
      const folderPath = await loader.initAgent(tempDir, 'full-agent', 'full');

      await expect(access(join(folderPath, 'agent.yaml'))).resolves.toBeUndefined();
      await expect(access(join(folderPath, 'CLAUDE.md'))).resolves.toBeUndefined();
      await expect(access(join(folderPath, 'SOUL.md'))).resolves.toBeUndefined();
      await expect(access(join(folderPath, 'IDENTITY.md'))).resolves.toBeUndefined();
      await expect(access(join(folderPath, 'skills'))).resolves.toBeUndefined();
      await expect(access(join(folderPath, 'memory'))).resolves.toBeUndefined();
      await expect(access(join(folderPath, 'memory', 'MEMORY.md'))).resolves.toBeUndefined();
      await expect(access(join(folderPath, 'memory', 'journal'))).resolves.toBeUndefined();

      // Verify wake patterns and version in full template
      const manifest = await loader.loadManifest(folderPath);
      expect(manifest.config.version).toBe('1.0.0');
      expect(manifest.config.wakePatterns).toEqual(['full-agent.>']);
      expect(manifest.hasMemory).toBe(true);
    });

    test('creates cron template with cron.yaml', async () => {
      const folderPath = await loader.initAgent(tempDir, 'cron-agent', 'cron');

      await expect(access(join(folderPath, 'agent.yaml'))).resolves.toBeUndefined();
      await expect(access(join(folderPath, 'cron.yaml'))).resolves.toBeUndefined();
      await expect(access(join(folderPath, 'CLAUDE.md'))).resolves.toBeUndefined();

      const manifest = await loader.loadManifest(folderPath);
      expect(manifest.cronConfig).toBeDefined();
      expect(manifest.cronConfig!.jobs).toHaveLength(1);
      expect(manifest.cronConfig!.jobs[0].action.type).toBe('claude');
    });

    test('throws on invalid agent name', async () => {
      await expect(loader.initAgent(tempDir, 'bad.name')).rejects.toThrow(/dots/);
      await expect(loader.initAgent(tempDir, 'bad:name')).rejects.toThrow(/colons/);
      await expect(loader.initAgent(tempDir, '')).rejects.toThrow(/empty/);
    });

    test('throws if folder already exists', async () => {
      await mkdir(join(tempDir, 'existing'));
      await expect(loader.initAgent(tempDir, 'existing')).rejects.toThrow(/already exists/);
    });

    test('creates parent directory if needed', async () => {
      const nested = join(tempDir, 'nested', 'dir');
      const folderPath = await loader.initAgent(nested, 'deep-agent');
      expect(folderPath).toBe(join(nested, 'deep-agent'));

      const manifest = await loader.loadManifest(folderPath);
      expect(manifest.config.name).toBe('deep-agent');
    });
  });
});
