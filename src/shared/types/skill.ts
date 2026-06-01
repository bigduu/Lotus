/**
 * Skill system types
 */

export interface SkillDefinition {
  id: string;
  name: string;
  description: string;
  prompt: string;
  tool_refs: string[];
  license?: string;
  compatibility?: string;
  metadata?: unknown;
}

export interface SkillFilter {
  search?: string;
  includeDisabled?: boolean;
}

export interface SkillListResponse {
  skills: SkillDefinition[];
  total: number;
}
