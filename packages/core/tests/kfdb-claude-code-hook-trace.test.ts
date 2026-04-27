import { describe, expect, it } from 'vitest';
import { buildClaudeCodeHookTraceOperations } from '../src/kfdb/claude-code-hook-trace.js';

describe('buildClaudeCodeHookTraceOperations', () => {
  it('creates deterministic rich private KG operations from Claude Code hook records', () => {
    const trace = {
      walletAddress: '0x75992f829DF3B5d515D70DB0f77A98171cE261EF',
      agentId: 'erc8004-expert',
      sessionId: 'session-1',
      turnIndex: 2,
      claudeSessionId: 'claude-session-1',
      transcriptPath: '/workspace/.claude/transcripts/claude-session-1.jsonl',
      model: 'claude-sonnet-4-6',
      cwd: '/workspace',
      startedAt: 1_765_000_000_000,
      completedAt: 1_765_000_001_000,
      events: [
        {
          sequence: 0,
          hookEventName: 'SessionStart',
          claudeSessionId: 'claude-session-1',
          transcriptPath: '/workspace/.claude/transcripts/claude-session-1.jsonl',
          cwd: '/workspace',
          receivedAt: 1_765_000_000_000,
          source: 'startup',
        },
        {
          sequence: 1,
          hookEventName: 'PostToolUse',
          claudeSessionId: 'claude-session-1',
          transcriptPath: '/workspace/.claude/transcripts/claude-session-1.jsonl',
          cwd: '/workspace',
          receivedAt: 1_765_000_000_500,
          toolName: 'Edit',
          toolUseId: 'tool-1',
          toolInput: { file_path: '/workspace/src/index.ts', old_string: 'a', new_string: 'b' },
          toolResponse: { success: true, filePath: '/workspace/src/index.ts' },
        },
        {
          sequence: 2,
          hookEventName: 'Stop',
          claudeSessionId: 'claude-session-1',
          transcriptPath: '/workspace/.claude/transcripts/claude-session-1.jsonl',
          cwd: '/workspace',
          receivedAt: 1_765_000_001_000,
        },
      ],
    };

    const first = buildClaudeCodeHookTraceOperations(trace);
    const second = buildClaudeCodeHookTraceOperations(trace);
    const labels = first.map((op) => op.label);
    const edges = first.map((op) => op.edge_type);

    expect(first).toEqual(second);
    expect(labels).toContain('ClaudeCodeSession');
    expect(labels).toContain('ClaudeCodeTurn');
    expect(labels).toContain('ClaudeCodeHookEvent');
    expect(labels).toContain('ClaudeCodeToolUse');
    expect(labels).toContain('CodeWorkspace');
    expect(labels).toContain('CodeFile');
    expect(edges).toContain('HAS_CLAUDE_CODE_TURN');
    expect(edges).toContain('EMITTED_CLAUDE_CODE_HOOK');
    expect(edges).toContain('INVOKED_CLAUDE_CODE_TOOL');
    expect(edges).toContain('RAN_IN_WORKSPACE');
    expect(edges).toContain('TOUCHED_FILE');
  });
});
