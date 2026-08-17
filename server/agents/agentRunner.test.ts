import { describe, expect, it } from 'vitest';
import { AGENT_LIMITS, approveAgentInput, runAgentInput } from './agentRunner';

describe('agent limits and input contracts', () => {
  it('enforces hard caps: steps, proposed tasks, retrieval, and request timeout', () => {
    expect(AGENT_LIMITS.maxSteps).toBeLessThanOrEqual(6);
    expect(AGENT_LIMITS.maxProposedTasks).toBeLessThanOrEqual(3);
    expect(AGENT_LIMITS.maxRetrievedSections).toBeLessThanOrEqual(8);
    expect(AGENT_LIMITS.requestTimeoutMs).toBeLessThanOrEqual(180_000);
  });

  it('requires an explicit decision on approval — no default execute', () => {
    const parsed = approveAgentInput.safeParse({ accessToken: 'a'.repeat(24), runId: '4e3d2c1b-8a99-4d6e-a1b2-c3d4e5f60718', decision: 'maybe' });
    expect(parsed.success).toBe(false);
    const approved = approveAgentInput.parse({ accessToken: 'a'.repeat(24), runId: '4e3d2c1b-8a99-4d6e-a1b2-c3d4e5f60718', decision: 'approved' });
    expect(approved.decision).toBe('approved');
  });

  it('binds every run to a single declared agent type', () => {
    const parsed = runAgentInput.parse({ accessToken: 'a'.repeat(24), agentType: 'case_file', caseId: '4e3d2c1b-8a99-4d6e-a1b2-c3d4e5f60718' });
    expect(parsed.agentType).toBe('case_file');
    const invalid = runAgentInput.safeParse({ accessToken: 'a'.repeat(24), agentType: 'free_agent' });
    expect(invalid.success).toBe(false);
  });

  it('requires the research agent question to come from the caller, not the model', () => {
    const parsed = runAgentInput.parse({ accessToken: 'a'.repeat(24), agentType: 'research', question: 'ما ميعاد الطعن بالنقض في القانون القطري؟' });
    expect(parsed.question?.length).toBeGreaterThan(10);
  });
});
