/**
 * Verification Engine — Behavioral Tests
 *
 * Tests that the verify() function actually analyzes content,
 * produces risk scores, findings, and recommended actions.
 */
import { describe, it, expect } from 'vitest';
import { verify } from '@jak-swarm/verification';

describe('Verification Engine — Behavioral', () => {
  const baseCtx = { tenantId: 'tnt_test', userId: 'usr_test' };

  // ─── Email Verification ────────────────────────────────────────────

  it('flags a phishing email with high-risk indicators', async () => {
    const result = await verify({
      type: 'EMAIL',
      content: 'Dear user, your account has been compromised. Click here urgently to verify your credentials: http://evil-phishing-site.com/login',
      contentType: 'text/plain',
      metadata: { from: 'security@definitely-not-real.xyz', subject: 'URGENT: Account Compromised' },
      ...baseCtx,
    });

    expect(result).toBeDefined();
    expect(result.risk).toBeDefined();
    expect(result.risk.score).toBeGreaterThan(0);
    expect(result.findings.length).toBeGreaterThan(0);
    expect(result.actions.length).toBeGreaterThan(0);
    expect(result.audit.analyzersRun.length).toBeGreaterThan(0);
  });

  it('passes a clean business email with low risk', async () => {
    const result = await verify({
      type: 'EMAIL',
      content: 'Hi team, please review the attached Q3 report. Let me know if you have questions.',
      contentType: 'text/plain',
      metadata: { from: 'manager@company.com', subject: 'Q3 Report' },
      ...baseCtx,
    });

    expect(result.risk.score).toBeLessThan(50);
  });

  // ─── Document Verification ─────────────────────────────────────────

  it('analyzes a document and returns structured findings', async () => {
    const result = await verify({
      type: 'DOCUMENT',
      content: 'Invoice #12345. Due: 2025-01-01. Amount: $50,000. Pay to: Cayman Islands Corp Ltd.',
      contentType: 'text/plain',
      metadata: { filename: 'invoice-suspicious.txt' },
      ...baseCtx,
    });

    expect(result).toBeDefined();
    expect(result.risk).toBeDefined();
    expect(typeof result.risk.score).toBe('number');
    expect(result.risk.level).toBeDefined();
    expect(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).toContain(result.risk.level);
    expect(result.audit.durationMs).toBeGreaterThanOrEqual(0);
  });

  // ─── Transaction Verification ──────────────────────────────────────

  it('scores a financial transaction', async () => {
    const result = await verify({
      type: 'TRANSACTION',
      content: JSON.stringify({
        amount: 49999,
        currency: 'USD',
        recipient: 'Unknown LLC',
        type: 'wire_transfer',
      }),
      contentType: 'application/json',
      ...baseCtx,
    });

    expect(result).toBeDefined();
    expect(result.risk.score).toBeGreaterThanOrEqual(0);
    expect(result.risk.score).toBeLessThanOrEqual(100);
    expect(result.summary).toBeTruthy();
  });

  // ─── Identity Verification ─────────────────────────────────────────

  it('verifies an identity request', async () => {
    const result = await verify({
      type: 'IDENTITY',
      content: JSON.stringify({
        name: 'John Doe',
        email: 'john@example.com',
        phone: '555-0123',
      }),
      contentType: 'application/json',
      ...baseCtx,
    });

    expect(result).toBeDefined();
    expect(result.risk).toBeDefined();
    expect(result.audit.requestId).toBeTruthy();
  });

  // ─── Unknown Type Rejection ────────────────────────────────────────

  it('throws on unknown verification type', async () => {
    await expect(
      verify({
        type: 'INVALID_TYPE' as any,
        content: 'test',
        contentType: 'text/plain',
        ...baseCtx,
      }),
    ).rejects.toThrow(/Unknown verification type/);
  });

  // ─── Result Structure ──────────────────────────────────────────────

  it('returns complete audit trail', async () => {
    const result = await verify({
      type: 'EMAIL',
      content: 'Normal business email content',
      contentType: 'text/plain',
      ...baseCtx,
    });

    expect(result.audit).toMatchObject({
      requestId: expect.any(String),
      analyzersRun: expect.any(Array),
      durationMs: expect.any(Number),
      timestamp: expect.any(String),
      layersActivated: expect.arrayContaining([1]),
    });
  });
});
