import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RESEARCH_GLM_MODEL,
  createDefaultResearchPolicyArms,
} from '../src/research/defaults.js';

describe('research defaults', () => {
  it('includes an OpenClaude GLM arm for engine-vs-provider comparisons', () => {
    const arms = createDefaultResearchPolicyArms({
      walletAddress: '0xwallet',
      projectId: 'project',
      workspaceId: 'workspace',
      visibility: 'private',
      readScope: 'private',
      allowGlobalInputs: false,
    });

    const openClaudeGlm = arms.find((arm) => arm.id === 'glm-openclaude-one-pass');
    expect(openClaudeGlm).toBeDefined();
    expect(openClaudeGlm?.provider).toBe('openclaude');
    expect(openClaudeGlm?.model).toBe(DEFAULT_RESEARCH_GLM_MODEL);
    expect(openClaudeGlm?.metadata).toMatchObject({
      billingProfile: 'zai',
      runtimeFamily: 'openclaude-cli',
      executionEngine: 'openclaude',
    });
  });
});
