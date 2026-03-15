import { readFile, readdir, access, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parse, stringify } from 'yaml';
import { validateAgentName, validateSubject } from '../registry/index.js';
import type {
  AgentManifest,
  AgentFolderConfig,
  AgentIdentityFiles,
  AgentSkillRef,
  CronFileConfig,
  CronJobFileEntry,
} from './types.js';

const VALID_ACTION_TYPES = new Set(['claude', 'emit', 'skill']);

export class AgentLoader {
  /** Scan a directory for agent folders (subdirectories containing agent.yaml). */
  async discoverAgents(baseDir: string): Promise<AgentManifest[]> {
    const resolved = resolve(baseDir);
    const entries = await readdir(resolved, { withFileTypes: true });
    const manifests: AgentManifest[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const folderPath = join(resolved, entry.name);
      const yamlPath = join(folderPath, 'agent.yaml');
      try {
        await access(yamlPath);
      } catch {
        continue;
      }
      manifests.push(await this.loadManifest(folderPath));
    }

    manifests.sort((a, b) => a.config.name.localeCompare(b.config.name));
    return manifests;
  }

  /** Load a single agent folder into an AgentManifest. */
  async loadManifest(folderPath: string): Promise<AgentManifest> {
    const resolved = resolve(folderPath);
    const yamlPath = join(resolved, 'agent.yaml');

    let content: string;
    try {
      content = await readFile(yamlPath, 'utf-8');
    } catch {
      throw new Error(`Missing agent.yaml in ${resolved}`);
    }

    const config = this.parseAgentConfig(content, resolved);
    const [identityFiles, cronConfig, skills, hasMemory] = await Promise.all([
      this.readIdentityFiles(resolved),
      this.readCronConfig(resolved),
      this.discoverSkills(resolved),
      this.checkMemory(resolved),
    ]);

    const manifest: AgentManifest = {
      folderPath: resolved,
      config,
      identityFiles,
      skills,
      hasMemory,
    };

    if (cronConfig) manifest.cronConfig = cronConfig;
    if (hasMemory) manifest.memoryPath = join(resolved, 'memory');

    return manifest;
  }

  /** Initialize a new agent folder from a template. */
  async initAgent(
    baseDir: string,
    name: string,
    template: string = 'basic',
  ): Promise<string> {
    const nameErr = validateAgentName(name);
    if (nameErr) throw new Error(nameErr);

    const folderPath = join(resolve(baseDir), name);

    try {
      await access(folderPath);
      throw new Error(`Folder already exists: ${folderPath}`);
    } catch (err: unknown) {
      if (err instanceof Error && !err.message.startsWith('Folder already exists')) {
        // ENOENT is expected -- folder doesn't exist yet
      } else if (err instanceof Error) {
        throw err;
      }
    }

    await mkdir(folderPath, { recursive: true });

    const baseConfig: AgentFolderConfig = {
      name,
      description: `${name} agent`,
      capabilities: ['general'],
    };

    if (template === 'basic') {
      await writeFile(join(folderPath, 'agent.yaml'), stringify(baseConfig));
    } else if (template === 'full') {
      const fullConfig: AgentFolderConfig = {
        ...baseConfig,
        version: '1.0.0',
        wakePatterns: [`${name}.>`],
        status: 'sleeping',
      };
      await writeFile(join(folderPath, 'agent.yaml'), stringify(fullConfig));
      await writeFile(join(folderPath, 'CLAUDE.md'), `# ${name}\n\nAgent instructions go here.\n`);
      await writeFile(join(folderPath, 'SOUL.md'), `# Soul\n\nAgent persona goes here.\n`);
      await writeFile(join(folderPath, 'IDENTITY.md'), `# Identity\n\nAgent expertise goes here.\n`);
      await mkdir(join(folderPath, 'skills'));
      await mkdir(join(folderPath, 'memory', 'journal'), { recursive: true });
      await writeFile(join(folderPath, 'memory', 'MEMORY.md'), `# Memory\n\nAgent memory goes here.\n`);
    } else if (template === 'cron') {
      const cronConfig: AgentFolderConfig = {
        ...baseConfig,
        wakePatterns: [`${name}.>`],
      };
      await writeFile(join(folderPath, 'agent.yaml'), stringify(cronConfig));
      await writeFile(join(folderPath, 'CLAUDE.md'), `# ${name}\n\nAgent instructions go here.\n`);
      const cronYaml = stringify({
        jobs: [
          {
            id: 'example-job',
            schedule: '0 0 * * *',
            description: 'Example scheduled job',
            action: { type: 'claude', prompt: 'Run daily task' },
            enabled: true,
          },
        ],
      });
      await writeFile(join(folderPath, 'cron.yaml'), cronYaml);
    }

    return folderPath;
  }

  private async readIdentityFiles(folderPath: string): Promise<AgentIdentityFiles> {
    const files: AgentIdentityFiles = {};
    const mapping: [keyof AgentIdentityFiles, string][] = [
      ['claude', 'CLAUDE.md'],
      ['soul', 'SOUL.md'],
      ['identity', 'IDENTITY.md'],
    ];
    for (const [key, filename] of mapping) {
      try {
        files[key] = await readFile(join(folderPath, filename), 'utf-8');
      } catch {
        // missing identity files are fine
      }
    }
    return files;
  }

  private async readCronConfig(folderPath: string): Promise<CronFileConfig | undefined> {
    let content: string;
    try {
      content = await readFile(join(folderPath, 'cron.yaml'), 'utf-8');
    } catch {
      return undefined;
    }
    return this.parseCronConfig(content, folderPath);
  }

  private async discoverSkills(folderPath: string): Promise<AgentSkillRef[]> {
    const skillsDir = join(folderPath, 'skills');
    try {
      await access(skillsDir);
    } catch {
      return [];
    }

    const entries = await readdir(skillsDir, { withFileTypes: true });
    const skills: AgentSkillRef[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skillMd = join(skillsDir, entry.name, 'SKILL.md');
      try {
        await access(skillMd);
        skills.push({ name: entry.name, path: skillMd });
      } catch {
        // skip directories without SKILL.md
      }
    }

    return skills;
  }

  private async checkMemory(folderPath: string): Promise<boolean> {
    try {
      await access(join(folderPath, 'memory'));
      return true;
    } catch {
      return false;
    }
  }

  private parseAgentConfig(content: string, folderPath: string): AgentFolderConfig {
    let raw: unknown;
    try {
      raw = parse(content);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Invalid YAML in ${folderPath}/agent.yaml: ${msg}`);
    }

    if (!raw || typeof raw !== 'object') {
      throw new Error(`Invalid agent.yaml in ${folderPath}: expected an object`);
    }

    const data = raw as Record<string, unknown>;

    // Required fields
    if (!data.name || typeof data.name !== 'string') {
      throw new Error(`Missing required field "name" in ${folderPath}/agent.yaml`);
    }
    const nameErr = validateAgentName(data.name);
    if (nameErr) throw new Error(`Invalid agent name in ${folderPath}/agent.yaml: ${nameErr}`);

    if (!data.description || typeof data.description !== 'string') {
      throw new Error(`Missing required field "description" in ${folderPath}/agent.yaml`);
    }

    if (!Array.isArray(data.capabilities) || data.capabilities.length === 0) {
      throw new Error(`Field "capabilities" must be a non-empty array in ${folderPath}/agent.yaml`);
    }

    // Validate wake patterns
    if (data.wakePatterns) {
      if (!Array.isArray(data.wakePatterns)) {
        throw new Error(`Field "wakePatterns" must be an array in ${folderPath}/agent.yaml`);
      }
      for (const pattern of data.wakePatterns) {
        if (typeof pattern !== 'string') {
          throw new Error(`Wake pattern must be a string in ${folderPath}/agent.yaml`);
        }
        const err = validateSubject(pattern, true);
        if (err) throw new Error(`Invalid wake pattern "${pattern}" in ${folderPath}/agent.yaml: ${err}`);
      }
    }

    // Validate status
    if (data.status !== undefined) {
      const validStatuses = ['online', 'offline', 'sleeping'];
      if (!validStatuses.includes(data.status as string)) {
        throw new Error(`Invalid status "${data.status}" in ${folderPath}/agent.yaml`);
      }
    }

    return {
      name: data.name,
      description: data.description,
      version: (data.version as string) ?? '1.0.0',
      capabilities: data.capabilities as (string | { name: string; description?: string; subjects?: string[] })[],
      wakePatterns: data.wakePatterns as string[] | undefined,
      endpoint: data.endpoint as string | undefined,
      auth: data.auth as AgentFolderConfig['auth'],
      status: (data.status as AgentFolderConfig['status']) ?? 'sleeping',
      metadata: data.metadata as Record<string, unknown> | undefined,
    };
  }

  private parseCronConfig(content: string, folderPath: string): CronFileConfig {
    let raw: unknown;
    try {
      raw = parse(content);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Invalid YAML in ${folderPath}/cron.yaml: ${msg}`);
    }

    if (!raw || typeof raw !== 'object') {
      throw new Error(`Invalid cron.yaml in ${folderPath}: expected an object`);
    }

    const data = raw as Record<string, unknown>;
    if (!Array.isArray(data.jobs)) {
      throw new Error(`Field "jobs" must be an array in ${folderPath}/cron.yaml`);
    }

    const jobs: CronJobFileEntry[] = data.jobs.map((job: unknown, i: number) => {
      if (!job || typeof job !== 'object') {
        throw new Error(`Job at index ${i} must be an object in ${folderPath}/cron.yaml`);
      }
      const j = job as Record<string, unknown>;

      if (!j.id || typeof j.id !== 'string') {
        throw new Error(`Job at index ${i} missing required field "id" in ${folderPath}/cron.yaml`);
      }
      if (!j.schedule || typeof j.schedule !== 'string') {
        throw new Error(`Job "${j.id}" missing required field "schedule" in ${folderPath}/cron.yaml`);
      }

      // Basic cron expression format check (5 or 6 space-separated fields)
      const fields = j.schedule.trim().split(/\s+/);
      if (fields.length < 5 || fields.length > 6) {
        throw new Error(
          `Job "${j.id}" has invalid cron expression "${j.schedule}" in ${folderPath}/cron.yaml: expected 5-6 fields`,
        );
      }

      if (!j.action || typeof j.action !== 'object') {
        throw new Error(`Job "${j.id}" missing required field "action" in ${folderPath}/cron.yaml`);
      }
      const action = j.action as Record<string, unknown>;
      if (!action.type || !VALID_ACTION_TYPES.has(action.type as string)) {
        throw new Error(
          `Job "${j.id}" has invalid action type "${action.type}" in ${folderPath}/cron.yaml: must be claude, emit, or skill`,
        );
      }

      return {
        id: j.id,
        schedule: j.schedule,
        description: j.description as string | undefined,
        action: action as CronJobFileEntry['action'],
        enabled: j.enabled !== undefined ? Boolean(j.enabled) : true,
        catchUp: j.catchUp !== undefined ? Boolean(j.catchUp) : false,
        timezone: j.timezone as string | undefined,
        protect: j.protect !== undefined ? Boolean(j.protect) : true,
      };
    });

    return { jobs };
  }
}
