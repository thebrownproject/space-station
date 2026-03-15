import type { Skill, SkillManifest, SkillSource, SkillResolutionOptions } from './skill-types.js';
import { SkillLoader } from './skill-loader.js';

export class SkillRegistry {
  private loader: SkillLoader;
  private skills: Map<string, Skill> = new Map();
  private agentSkills: Map<string, Set<string>> = new Map();
  private manifests: SkillManifest[] = [];

  constructor() {
    this.loader = new SkillLoader();
  }

  async discoverSkills(
    searchPaths: Array<{ path: string; source: SkillSource; agentName?: string }>,
  ): Promise<SkillManifest[]> {
    const all: SkillManifest[] = [];
    for (const sp of searchPaths) {
      const found = await this.loader.discoverSkills(sp.path, sp.source, sp.agentName);
      all.push(...found);
    }
    this.manifests = all;
    return all;
  }

  async loadAndRegister(manifest: SkillManifest, agentId?: string): Promise<Skill> {
    const skill = await this.loader.loadSkill(
      manifest.filePath,
      manifest.source,
      agentId,
      manifest.agentName,
    );
    this.register(skill);
    return skill;
  }

  async loadAll(): Promise<Skill[]> {
    const loaded: Skill[] = [];
    for (const manifest of this.manifests) {
      loaded.push(await this.loadAndRegister(manifest));
    }
    return loaded;
  }

  register(skill: Skill): void {
    const key = skill.agentName ? `${skill.agentName}:${skill.id}` : skill.id;
    this.skills.set(key, skill);

    if (skill.agentName) {
      let agentSet = this.agentSkills.get(skill.agentName);
      if (!agentSet) {
        agentSet = new Set();
        this.agentSkills.set(skill.agentName, agentSet);
      }
      agentSet.add(key);
    }
  }

  get(skillId: string): Skill | undefined {
    return this.skills.get(skillId);
  }

  list(agentName?: string): Skill[] {
    if (agentName) {
      const agentIds = this.agentSkills.get(agentName) ?? new Set();
      return Array.from(this.skills.values()).filter(
        (s) => agentIds.has(`${agentName}:${s.id}`) || s.source === 'shared' || s.source === 'global',
      );
    }
    return Array.from(this.skills.values());
  }

  search(query: string): Skill[] {
    const lower = query.toLowerCase();
    return Array.from(this.skills.values()).filter(
      (s) =>
        s.name.toLowerCase().includes(lower) ||
        s.description.toLowerCase().includes(lower) ||
        (s.tags ?? []).some((t) => t.toLowerCase().includes(lower)),
    );
  }

  resolveForAgent(agentName: string, options?: SkillResolutionOptions): Skill[] {
    const opts = { includeShared: true, includeGlobal: true, ...options };
    const resolved = new Map<string, Skill>();

    // Lowest priority first so higher priority overwrites
    if (opts.includeGlobal) {
      for (const skill of this.skills.values()) {
        if (skill.source === 'global') resolved.set(skill.id, skill);
      }
    }

    if (opts.includeShared) {
      for (const skill of this.skills.values()) {
        if (skill.source === 'shared') resolved.set(skill.id, skill);
      }
    }

    // Agent-specific: highest priority
    const agentIds = this.agentSkills.get(agentName) ?? new Set();
    for (const compositeId of agentIds) {
      const skill = this.skills.get(compositeId);
      if (skill) resolved.set(skill.id, skill);
    }

    return Array.from(resolved.values());
  }

  count(): number {
    return this.skills.size;
  }

  clear(): void {
    this.skills.clear();
    this.agentSkills.clear();
    this.manifests = [];
  }
}
