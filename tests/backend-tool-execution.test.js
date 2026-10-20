import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import config from '../server/config.js';
import {
  buildInstallPlan,
  detectPackageManager,
  executeTool,
  getDelegationState,
} from '../server/tools/executor.js';
import { produceToolLimitSummary } from '../server/ai/llm-client.js';
import { getToolDefinitions } from '../server/tools/registry.js';
import { closeDB, createConversation, initDB } from '../server/memory/store.js';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

describe('backend tool execution safeguards', () => {
  it('registers the PDF artifact tool with a required content field', () => {
    const definition = getToolDefinitions().find(tool => tool.function.name === 'generate_pdf');
    expect(definition).toBeDefined();
    expect(definition.function.parameters.required).toContain('content');
  });

  it('creates a local, non-global npm install plan', () => {
    const plan = buildInstallPlan({
      name: 'semgrep@1.0.0',
      method: 'npm',
      platform: 'linux',
      workspace: '/tmp/phantom-test-workspace',
    });

    expect(plan.command).toContain('--prefix');
    expect(plan.command).toContain('--ignore-scripts');
    expect(plan.command).not.toMatch(/\s-g(?:lobal)?\b/);
    expect(plan.useSudo).toBe(false);
  });

  it('rejects shell injection and unsafe git sources before execution', () => {
    expect(() => buildInstallPlan({ name: 'nmap; touch /tmp/pwned', method: 'apt', platform: 'linux' })).toThrow(/Invalid tool name/);
    expect(() => buildInstallPlan({ name: 'owner/repo', method: 'git', source: 'http://example.com/repo.git', platform: 'linux' })).toThrow(/HTTPS/);
    expect(() => buildInstallPlan({ name: 'owner/repo', method: 'git', source: 'https://192.168.1.10/repo.git', platform: 'linux' })).toThrow(/private and local/);
  });

  it('reports missing package managers instead of guessing apt', () => {
    expect(detectPackageManager({ platform: 'linux', path: '' })).toBeNull();
    expect(() => buildInstallPlan({ name: 'nmap', method: 'auto', platform: 'linux', path: '' })).toThrow(/No supported package manager/);
  });

  it('returns an actionable bounded-depth delegation result', async () => {
    const result = await executeTool(
      'delegate_task',
      { task_description: 'nested work' },
      undefined,
      { rootConversationId: 'root-session', delegationDepth: 2 },
    );

    expect(result).toMatch(/maximum delegation depth/);
    expect(getDelegationState().active).toBe(0);
  });

  it('exposes a workspace-local PDF generation tool', async () => {
    const previousWorkspace = config.workspace;
    const workspace = join('/tmp', `phantom-pdf-test-${Date.now()}`);
    config.workspace = workspace;
    try {
      const raw = await executeTool('generate_pdf', {
        content: '# Finding\n\nThe service is reachable.',
        filename: 'reports/finding.pdf',
        title: 'Finding report',
      });
      const result = JSON.parse(raw);
      expect(result).toMatchObject({ success: true, artifact: { type: 'pdf', relativePath: 'reports/finding.pdf' } });
      expect(result.artifact.path.startsWith(workspace)).toBe(true);
      expect(existsSync(result.artifact.path)).toBe(true);
      expect((await readFile(result.artifact.path)).subarray(0, 8).toString()).toBe('%PDF-1.4');
    } finally {
      config.workspace = previousWorkspace;
    }
  });

  it('writes a loader-compatible SKILL.md alongside a skill manifest', async () => {
    const previousWorkspace = config.workspace;
    const workspace = join('/tmp', `phantom-skill-test-${Date.now()}`);
    config.workspace = workspace;
    try {
      const raw = await executeTool('write_skill', {
        name: 'report-helper',
        description: 'Formats report findings.',
        code: 'print("hello")',
        entry_point: 'run.py',
      });
      expect(raw).toContain('created successfully');
      const skillPath = join(workspace, 'skills', 'report-helper');
      const markdown = await readFile(join(skillPath, 'SKILL.md'), 'utf8');
      expect(markdown).toMatch(/^---\n/);
      expect(markdown).toContain('name: "report-helper"');
      expect(markdown).toContain('description: "Formats report findings."');
      expect(markdown).toContain('entry: "run.py"');
      expect(existsSync(join(skillPath, 'skill.json'))).toBe(true);
    } finally {
      config.workspace = previousWorkspace;
    }
  });

  it('keeps relative file writes inside the workspace and rejects traversal', async () => {
    const previousWorkspace = config.workspace;
    const workspace = join('/tmp', `phantom-files-test-${Date.now()}`);
    config.workspace = workspace;
    try {
      expect(await executeTool('write_file', { path: 'nested/result.txt', content: 'ok' })).toContain('File written successfully');
      expect(await readFile(join(workspace, 'nested/result.txt'), 'utf8')).toBe('ok');
      expect(await executeTool('write_file', { path: '../outside.txt', content: 'blocked' })).toMatch(/Access denied/);
    } finally {
      config.workspace = previousWorkspace;
    }
  });
});

describe('tool-call limit finalization', () => {
  beforeEach(() => initDB(':memory:'));
  afterEach(() => closeDB());

  it('uses a no-tool synthesis pass and stores a useful final answer', async () => {
    const conversation = createConversation('limit test');
    let request;
    const client = {
      chat: {
        completions: {
          async create(options) {
            request = options;
            return (async function* () {
              yield { choices: [{ delta: { content: 'Verified partial finding.' } }] };
              yield { choices: [{ delta: { content: ' Next step: narrow the request.' }, finish_reason: 'stop' }] };
            })();
          },
        },
      },
    };
    const chunks = [];
    const result = await produceToolLimitSummary({
      conversationId: conversation.id,
      messages: [
        { role: 'system', content: 'system' },
        { role: 'user', content: 'investigate' },
        { role: 'tool', name: 'read_file', content: 'important evidence' },
      ],
      maxToolIterations: 1,
      client,
      api: { ...config.api },
      targetModel: 'offline-test-model',
      onChunk: chunk => chunks.push(chunk),
    });

    expect(request.tools).toBeUndefined();
    expect(result).toContain('Tool-call budget reached');
    expect(result).toContain('Verified partial finding');
    expect(chunks.join('')).toContain('Verified partial finding');
  });

  it('falls back to visible partial progress when synthesis returns no text', async () => {
    const conversation = createConversation('empty limit test');
    const client = {
      chat: {
        completions: {
          async create() {
            return (async function* () {
              yield { choices: [{ delta: {}, finish_reason: 'stop' }] };
            })();
          },
        },
      },
    };
    const chunks = [];
    const result = await produceToolLimitSummary({
      conversationId: conversation.id,
      messages: [{ role: 'tool', name: 'execute_command', content: 'partial command output' }],
      maxToolIterations: 2,
      client,
      api: { ...config.api },
      onChunk: chunk => chunks.push(chunk),
    });

    expect(result).toContain('partial command output');
    expect(chunks.join('')).toContain('partial command output');
  });
});
