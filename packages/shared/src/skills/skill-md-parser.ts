/**
 * SKILL.md Parser & Loader
 *
 * Parses DeerFlow-compatible SKILL.md files with YAML frontmatter.
 * This enables community skill authoring in a simple markdown format.
 *
 * Format:
 * ```
 * ---
 * name: pdf-processing
 * description: Extract and analyze PDF documents
 * version: 1.0.0
 * author: JAK Community
 * license: MIT
 * allowed-tools:
 *   - pdf_extract_text
 *   - pdf_analyze
 *   - summarize_document
 * risk-level: LOW
 * permissions:
 *   - READ_DOCUMENTS
 * tags:
 *   - document
 *   - pdf
 * ---
 *
 * # PDF Processing Skill
 *
 * This skill enables agents to extract text from PDF documents...
 * ```
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export interface SkillManifest {
  name: string;
  description: string;
  version: string;
  author: string;
  license: string;
  allowedTools: string[];
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  permissions: string[];
  tags: string[];
  /** The markdown body (instructions) */
  body: string;
  /** Absolute path to the SKILL.md file */
  filePath: string;
  /** Whether this is a public or custom skill */
  scope: 'public' | 'custom';
}

/**
 * Parse a SKILL.md file into a structured manifest.
 * Extracts YAML frontmatter and markdown body.
 */
export function parseSkillMd(content: string, filePath: string): SkillManifest | null {
  const trimmed = content.trim();

  // Check for YAML frontmatter delimiters
  if (!trimmed.startsWith('---')) {
    return null;
  }

  const endIdx = trimmed.indexOf('---', 3);
  if (endIdx === -1) return null;

  const yamlBlock = trimmed.slice(3, endIdx).trim();
  const body = trimmed.slice(endIdx + 3).trim();

  // Parse YAML manually (simple key-value + arrays — no dependency needed)
  const manifest: Record<string, unknown> = {};
  let currentKey: string | null = null;
  let currentArray: string[] | null = null;

  for (const rawLine of yamlBlock.split('\n')) {
    const line = rawLine.trimEnd();

    // Array item
    if (line.match(/^\s+-\s+/) && currentKey) {
      const value = line.replace(/^\s+-\s+/, '').trim();
      if (currentArray) {
        currentArray.push(value);
      }
      continue;
    }

    // Flush current array
    if (currentKey && currentArray) {
      manifest[currentKey] = currentArray;
      currentArray = null;
      currentKey = null;
    }

    // Key-value pair
    const kvMatch = line.match(/^([a-zA-Z_-]+)\s*:\s*(.*)$/);
    if (kvMatch) {
      const key = kvMatch[1]!;
      const value = kvMatch[2]!.trim();

      if (value === '' || value === '|') {
        // Start of array or multiline
        currentKey = key;
        currentArray = [];
      } else {
        manifest[key] = value;
      }
    }
  }

  // Flush final array
  if (currentKey && currentArray) {
    manifest[currentKey] = currentArray;
  }

  // Validate required fields
  const name = String(manifest['name'] ?? '');
  if (!name) return null;

  const scope = filePath.includes('/custom/') || filePath.includes('\\custom\\')
    ? 'custom' as const
    : 'public' as const;

  return {
    name,
    description: String(manifest['description'] ?? ''),
    version: String(manifest['version'] ?? '1.0.0'),
    author: String(manifest['author'] ?? 'unknown'),
    license: String(manifest['license'] ?? 'MIT'),
    allowedTools: Array.isArray(manifest['allowed-tools'])
      ? manifest['allowed-tools'] as string[]
      : [],
    riskLevel: validateRiskLevel(String(manifest['risk-level'] ?? 'LOW')),
    permissions: Array.isArray(manifest['permissions'])
      ? manifest['permissions'] as string[]
      : [],
    tags: Array.isArray(manifest['tags'])
      ? manifest['tags'] as string[]
      : [],
    body,
    filePath,
    scope,
  };
}

function validateRiskLevel(level: string): 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' {
  const valid = new Set(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
  const upper = level.toUpperCase();
  return valid.has(upper) ? upper as 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' : 'LOW';
}

/**
 * Recursively discover SKILL.md files in a directory.
 * Returns all found manifests.
 */
export function discoverSkills(rootDir: string): SkillManifest[] {
  const results: SkillManifest[] = [];

  if (!existsSync(rootDir)) return results;

  function scan(dir: string): void {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = join(dir, entry);
      try {
        const stat = statSync(fullPath);
        if (stat.isDirectory()) {
          scan(fullPath);
        } else if (entry === 'SKILL.md') {
          const content = readFileSync(fullPath, 'utf-8');
          const manifest = parseSkillMd(content, fullPath);
          if (manifest) {
            results.push(manifest);
          }
        }
      } catch {
        // Skip unreadable entries
      }
    }
  }

  scan(rootDir);
  return results;
}

/**
 * Load skills from both public and custom directories.
 * Custom skills override public skills with the same name.
 */
export function loadSkills(skillsDir: string): SkillManifest[] {
  const publicDir = join(skillsDir, 'public');
  const customDir = join(skillsDir, 'custom');

  const publicSkills = discoverSkills(publicDir);
  const customSkills = discoverSkills(customDir);

  // Custom skills override public ones by name
  const skillMap = new Map<string, SkillManifest>();
  for (const skill of publicSkills) {
    skillMap.set(skill.name, skill);
  }
  for (const skill of customSkills) {
    skillMap.set(skill.name, skill);
  }

  return Array.from(skillMap.values());
}

/**
 * Format skills for injection into an agent's system prompt.
 * Only includes enabled skills within the allowed tools constraint.
 */
export function formatSkillsForPrompt(
  skills: SkillManifest[],
  enabledSkillNames?: Set<string>,
): string {
  const enabled = enabledSkillNames
    ? skills.filter(s => enabledSkillNames.has(s.name))
    : skills;

  if (enabled.length === 0) return '';

  const sections = enabled.map(skill => {
    const toolList = skill.allowedTools.length > 0
      ? `\nAllowed tools: ${skill.allowedTools.join(', ')}`
      : '';
    return `### ${skill.name} (v${skill.version})
${skill.description}${toolList}

${skill.body.slice(0, 500)}`;
  });

  return `<skills>
The following skills are available for this workflow:

${sections.join('\n\n')}
</skills>`;
}
