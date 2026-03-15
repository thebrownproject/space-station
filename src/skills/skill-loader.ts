import { readFile, readdir, stat, access } from 'node:fs/promises';
import { join, basename, dirname } from 'node:path';
import matter from 'gray-matter';
import type { Skill, SkillManifest, SkillFrontmatter, SkillSource } from './skill-types.js';

export class SkillLoader {
  async discoverSkills(
    searchDir: string,
    source: SkillSource,
    agentName?: string,
  ): Promise<SkillManifest[]> {
    try {
      await access(searchDir);
    } catch {
      return [];
    }

    const entries = await readdir(searchDir);
    const manifests: SkillManifest[] = [];

    for (const entry of entries) {
      const entryPath = join(searchDir, entry);
      const entryStat = await stat(entryPath);
      if (!entryStat.isDirectory()) continue;

      const skillFile = join(entryPath, 'SKILL.md');
      try {
        await access(skillFile);
      } catch {
        continue;
      }

      manifests.push({
        name: entry,
        filePath: skillFile,
        source,
        agentName,
      });
    }

    return manifests;
  }

  async loadSkill(
    filePath: string,
    source: SkillSource,
    agentId?: string,
    agentName?: string,
  ): Promise<Skill> {
    const raw = await readFile(filePath, 'utf-8');
    const { data, content } = matter(raw);
    const frontmatter = this.parseFrontmatter(data, filePath);
    const id = basename(dirname(filePath));

    return {
      id,
      name: frontmatter.name,
      description: frontmatter.description,
      version: frontmatter.version ?? '1.0.0',
      content: content.trim(),
      allowedTools: frontmatter['allowed-tools'],
      userInvocable: frontmatter['user-invocable'] ?? false,
      source,
      agentId,
      agentName,
      filePath,
      tags: frontmatter.tags,
    };
  }

  private parseFrontmatter(data: Record<string, unknown>, filePath: string): SkillFrontmatter {
    if (!data.name || typeof data.name !== 'string') {
      throw new Error(`SKILL.md missing required field "name": ${filePath}`);
    }
    if (!data.description || typeof data.description !== 'string') {
      throw new Error(`SKILL.md missing required field "description": ${filePath}`);
    }
    return data as unknown as SkillFrontmatter;
  }
}
