export type SkillSource = 'agent' | 'shared' | 'global';

export interface Skill {
  id: string;
  name: string;
  description: string;
  version: string;
  content: string;
  allowedTools?: string[];
  userInvocable: boolean;
  source: SkillSource;
  agentId?: string;
  agentName?: string;
  filePath: string;
  tags?: string[];
}

export interface SkillManifest {
  name: string;
  description?: string;
  filePath: string;
  source: SkillSource;
  agentName?: string;
}

export interface SkillFrontmatter {
  name: string;
  description: string;
  version?: string;
  'allowed-tools'?: string[];
  'user-invocable'?: boolean;
  tags?: string[];
}

export interface SkillResolutionOptions {
  includeShared?: boolean;
  includeGlobal?: boolean;
}
