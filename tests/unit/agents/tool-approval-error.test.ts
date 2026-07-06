/**
 * Item 10 — ToolApprovalRequiredError shape + contract lock.
 *
 * The per-tool approval gate now STOPS the tool loop cleanly by throwing
 * this structured error instead of continuing the LLM loop with a fake
 * "wait for the user" message (which burned tokens on a tool that would
 * never run until a human decided, and let the workflow complete with a
 * degraded answer while the approval sat in the inbox).
 *
 * The error carries the approval context (toolName, category, reason,
 * inputSummary) so the worker node + trace can surface exactly what was
 * blocked without re-deriving it from the activity log. This file pins
 * the shape + message so a future rename gets caught at test time, and
 * documents the deferred full pause/resume scope (see the class doc
 * comment for why LangGraph interrupt()+resume-with-approvalId needs a
 * live end-to-end test before it can be shipped honestly).
 */
import { describe, it, expect } from 'vitest';
import { ToolApprovalRequiredError } from '../../../packages/agents/src/base/tool-approval-error.js';

describe('ToolApprovalRequiredError', () => {
  it('is an Error subclass with the canonical name', () => {
    const err = new ToolApprovalRequiredError({
      toolName: 'gmail_send_email',
      category: 'EXTERNAL_POST',
      reason: 'Sending email requires approval.',
      inputSummary: '{"to":"a@b.c"}',
    });
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(ToolApprovalRequiredError);
    expect(err.name).toBe('ToolApprovalRequiredError');
  });

  it('carries the structured approval context as readonly fields', () => {
    const err = new ToolApprovalRequiredError({
      toolName: 'slack_post_message',
      category: 'EXTERNAL_POST',
      reason: 'Posting to a third party — approval required first.',
      inputSummary: '{"channel":"#ops","text":"deploy"}',
    });
    expect(err.toolName).toBe('slack_post_message');
    expect(err.category).toBe('EXTERNAL_POST');
    expect(err.reason).toBe('Posting to a third party — approval required first.');
    expect(err.inputSummary).toBe('{"channel":"#ops","text":"deploy"}');
  });

  it('builds an honest, human-readable message that names the tool + category + reason', () => {
    const err = new ToolApprovalRequiredError({
      toolName: 'stripe_charge_customer',
      category: 'DESTRUCTIVE',
      reason: 'Charging a card is irreversible without approval.',
      inputSummary: '{"amount":4999}',
    });
    expect(err.message).toContain('stripe_charge_customer');
    expect(err.message).toContain('DESTRUCTIVE');
    expect(err.message).toContain('Charging a card is irreversible without approval.');
    expect(err.message).toContain('AWAITING_APPROVAL');
    expect(err.message).toContain('cockpit inbox');
  });

  it('instanceof survives a re-import (same class identity across the package boundary)', async () => {
    // The worker node imports ToolApprovalRequiredError from
    // '@jak-swarm/agents'; the tool-execution service imports it from
    // the relative source path. Both must resolve to the SAME class so
    // `instanceof` gating in the worker-node catch works. Vitest aliases
    // @jak-swarm/agents to the source barrel, which re-exports this
    // module — so the two references are identical.
    const { ToolApprovalRequiredError: ReExported } = await import('@jak-swarm/agents');
    expect(ReExported).toBe(ToolApprovalRequiredError);
    const err = new ReExported({
      toolName: 'x',
      category: 'WRITE',
      reason: 'r',
      inputSummary: '{}',
    });
    expect(err).toBeInstanceOf(ToolApprovalRequiredError);
  });
});