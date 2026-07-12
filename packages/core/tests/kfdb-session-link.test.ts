import { describe, expect, it } from 'vitest';
import {
  sessionLinkNodeId,
  buildSessionLinkOperations,
  HARNESS_SESSION_KEY_LABEL,
  SAME_SESSION_EDGE_TYPE,
} from '../src/kfdb/session-link.js';

const WALLET = '0x75992f829DF3B5d515D70DB0f77A98171cE261EF';
const WALLET_LOWER = WALLET.toLowerCase();
const CLAUDE_SESSION = 'claude-session-abc';

describe('sessionLinkNodeId', () => {
  it('is idempotent: same (wallet, session) yields byte-identical IDs', () => {
    const a = sessionLinkNodeId({ walletAddress: WALLET, claudeSessionId: CLAUDE_SESSION });
    const b = sessionLinkNodeId({ walletAddress: WALLET, claudeSessionId: CLAUDE_SESSION });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('is wallet case-insensitive: mixed-case input matches lowercase input', () => {
    const mixed = sessionLinkNodeId({ walletAddress: WALLET, claudeSessionId: CLAUDE_SESSION });
    const lower = sessionLinkNodeId({ walletAddress: WALLET_LOWER, claudeSessionId: CLAUDE_SESSION });
    const upper = sessionLinkNodeId({ walletAddress: WALLET.toUpperCase(), claudeSessionId: CLAUDE_SESSION });
    expect(mixed).toBe(lower);
    expect(upper).toBe(lower);
  });

  it('differs when the wallet differs', () => {
    const a = sessionLinkNodeId({ walletAddress: WALLET, claudeSessionId: CLAUDE_SESSION });
    const b = sessionLinkNodeId({ walletAddress: '0x0000000000000000000000000000000000000001', claudeSessionId: CLAUDE_SESSION });
    expect(a).not.toBe(b);
  });

  it('differs when the session differs', () => {
    const a = sessionLinkNodeId({ walletAddress: WALLET, claudeSessionId: CLAUDE_SESSION });
    const b = sessionLinkNodeId({ walletAddress: WALLET, claudeSessionId: 'claude-session-xyz' });
    expect(a).not.toBe(b);
  });
});

describe('buildSessionLinkOperations', () => {
  const input = {
    walletAddress: WALLET,
    claudeSessionId: CLAUDE_SESSION,
    fromNodeId: 'from-node-1',
    fromLabel: 'ClaudeCodeSession',
  };

  it('is idempotent: two independent calls produce identical ops', () => {
    const first = buildSessionLinkOperations(input);
    const second = buildSessionLinkOperations(input);
    expect(first).toEqual(second);
  });

  it('emits a HarnessSessionKey merge node keyed on lowercased wallet + session', () => {
    const ops = buildSessionLinkOperations(input);
    const node = ops.find((op) => op.label === HARNESS_SESSION_KEY_LABEL) as Record<string, unknown>;
    expect(node).toBeDefined();
    expect(node.operation).toBe('create_node');
    expect(node.mode).toBe('merge');
    expect(node.id).toBe(sessionLinkNodeId({ walletAddress: WALLET, claudeSessionId: CLAUDE_SESSION }));
    const properties = node.properties as Record<string, unknown>;
    expect(properties.wallet_address).toEqual({ String: WALLET_LOWER });
    expect(properties.claude_session_id).toEqual({ String: CLAUDE_SESSION });
    expect(properties.schema_version).toEqual({ Integer: 3 });
  });

  it('never emits a source property on the converging node (explicit null breaks convergence)', () => {
    const ops = buildSessionLinkOperations(input);
    const node = ops.find((op) => op.label === HARNESS_SESSION_KEY_LABEL) as Record<string, unknown>;
    const properties = node.properties as Record<string, unknown>;
    expect('source' in properties).toBe(false);
  });

  it('emits a SAME_SESSION edge from fromNodeId to the HarnessSessionKey node', () => {
    const ops = buildSessionLinkOperations(input);
    const node = ops.find((op) => op.label === HARNESS_SESSION_KEY_LABEL) as Record<string, unknown>;
    const edge = ops.find((op) => op.edge_type === SAME_SESSION_EDGE_TYPE) as Record<string, unknown>;
    expect(edge).toBeDefined();
    expect(edge.operation).toBe('create_edge');
    expect(edge.from).toBe('from-node-1');
    expect(edge.to).toBe(node.id);
    const properties = edge.properties as Record<string, unknown>;
    expect(properties.from_label).toEqual({ String: 'ClaudeCodeSession' });
  });

  it('produces the same HarnessSessionKey node ID regardless of which writer/fromNode links it', () => {
    const fromClaude = buildSessionLinkOperations({ ...input, fromNodeId: 'claude-node', fromLabel: 'ClaudeCodeSession' });
    const fromHome = buildSessionLinkOperations({ ...input, fromNodeId: 'home-node', fromLabel: 'RickydataChatSession' });
    const claudeNode = fromClaude.find((op) => op.label === HARNESS_SESSION_KEY_LABEL) as Record<string, unknown>;
    const homeNode = fromHome.find((op) => op.label === HARNESS_SESSION_KEY_LABEL) as Record<string, unknown>;
    expect(claudeNode.id).toBe(homeNode.id);
    expect(claudeNode.properties).toEqual(homeNode.properties);
  });
});
