import { readFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';
import config from '../config.js';

let skillsCache = null;

export function invalidateSkillsCache() {
  skillsCache = null;
}

/**
 * Loads the basic metadata (name, description) for all available skills.
 * Uses progressive disclosure to keep token count low.
 * @returns {Array<Object>} List of skill metadata objects.
 */
export function loadSkillsMetadata() {
  if (skillsCache) return skillsCache;

  const skillsDir = join(config.workspace, 'skills');
  const metadataList = [];

  if (!existsSync(skillsDir)) return metadataList;

  const entries = readdirSync(skillsDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const skillMdPath = join(skillsDir, entry.name, 'SKILL.md');
      if (existsSync(skillMdPath)) {
        try {
          const content = readFileSync(skillMdPath, 'utf8');
          const meta = parseSkillFrontmatter(content);
          if (meta && meta.name) {
            metadataList.push({
              name: meta.name,
              description: meta.description || 'No description provided.',
              tier: meta.trust_tier || 3
            });
          }
        } catch (err) {
          console.error(`[SkillLoader] Error loading metadata for ${entry.name}:`, err.message);
        }
      }
    }
  }

  skillsCache = metadataList;
  return metadataList;
}

/**
 * Loads the full content of a SKILL.md file when the skill is explicitly invoked.
 * @param {string} skillName - The name of the skill.
 * @returns {Object|null} The parsed skill configuration and code, or null if not found.
 */
export function loadFullSkill(skillName) {
  const skillsDir = join(config.workspace, 'skills');
  const skillDir = join(skillsDir, skillName);
  const skillMdPath = join(skillDir, 'SKILL.md');

  if (!existsSync(skillMdPath)) return null;

  try {
    const content = readFileSync(skillMdPath, 'utf8');
    const parsed = parseSkillMarkdown(content);
    return parsed;
  } catch (err) {
    console.error(`[SkillLoader] Error loading full skill ${skillName}:`, err.message);
    return null;
  }
}

/**
 * Parses the YAML frontmatter from a SKILL.md file.
 * (Simple regex-based parsing to avoid pulling in a full YAML parser just for this)
 * @param {string} content - Markdown content.
 * @returns {Object} Extracted metadata.
 */
function parseSkillFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};

  const yaml = match[1];
  const meta = {};

  for (const line of yaml.split('\n')) {
    const colonIndex = line.indexOf(':');
    if (colonIndex > 0) {
      const key = line.substring(0, colonIndex).trim();
      let value = line.substring(colonIndex + 1).trim();
      if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
      if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
      if (value === 'true') value = true;
      if (value === 'false') value = false;
      const num = Number(value);
      if (!isNaN(num)) value = num;

      meta[key] = value;
    }
  }
  return meta;
}

/**
 * Extracts metadata and code blocks from the full SKILL.md.
 * @param {string} content
 * @returns {Object}
 */
function parseSkillMarkdown(content) {
  const meta = parseSkillFrontmatter(content);

  // Extract main code block (assumes the first JS block is the implementation)
  const codeMatch = content.match(/```javascript\n([\s\S]*?)```/);
  const code = codeMatch ? codeMatch[1] : '';

  return {
    ...meta,
    code
  };
}
