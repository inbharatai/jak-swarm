/**
 * Unit tests for TrialEmailService — verifies the three transparent
 * backends (gmail / file / noop) pick correctly based on env, and that
 * the rendered email contains the verify URL + cap details.
 *
 * No real SMTP is fired in any of these tests.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { TrialEmailService } from '../../../apps/api/src/services/trial/trial-email.service.js';

const fakeLog: any = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

const tokenFixture = (...parts: string[]) => parts.join('');

describe('TrialEmailService.sendVerifyEmail', () => {
  const SAVED_ENV = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.GMAIL_EMAIL;
    delete process.env.GMAIL_APP_PASSWORD;
    delete process.env.JAK_TRIAL_EMAIL_LOG_DIR;
    delete process.env.NEXT_PUBLIC_WEB_URL;
    delete process.env.WEB_BASE_URL;
  });

  afterEach(() => {
    process.env = { ...SAVED_ENV };
  });

  it('uses the file backend in dev (NODE_ENV=test counts as non-production)', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'trial-email-test-'));
    process.env.JAK_TRIAL_EMAIL_LOG_DIR = tmp;
    const svc = new TrialEmailService(fakeLog);
    const cleartextToken = tokenFixture('abcdef0123456789', 'abcdef0123456789');
    const result = await svc.sendVerifyEmail({
      to: 'founder@example.com',
      cleartextToken,
      companyName: 'Acme',
    });
    expect(result.delivered).toBe(true);
    expect(result.backend).toBe('file');
    expect(result.detail).toBeDefined();

    // File should contain verify URL + email subject + caps mention
    const contents = await fs.readFile(result.detail!, 'utf8');
    const parsed = JSON.parse(contents);
    expect(parsed.to).toBe('founder@example.com');
    expect(parsed.subject).toMatch(/Confirm your JAK Swarm trial/);
    expect(parsed.verifyUrl).toContain(`/trial/verify/${cleartextToken}`);
    expect(parsed.text).toMatch(/30-day/);
    expect(parsed.text).toMatch(/20 agent runs/);
    expect(parsed.text).toMatch(/200,000 LLM tokens/);

    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('honors NEXT_PUBLIC_WEB_URL when present', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'trial-email-test-'));
    process.env.JAK_TRIAL_EMAIL_LOG_DIR = tmp;
    process.env.NEXT_PUBLIC_WEB_URL = 'https://app.example.com';

    const svc = new TrialEmailService(fakeLog);
    const cleartextToken = tokenFixture('token-', 'xxxxxxxxxxxxxxxxxxxxxxxxxx');
    const result = await svc.sendVerifyEmail({
      to: 'a@b.co',
      cleartextToken,
      companyName: null,
    });
    const parsed = JSON.parse(await fs.readFile(result.detail!, 'utf8'));
    expect(parsed.verifyUrl).toBe(`https://app.example.com/trial/verify/${cleartextToken}`);

    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('falls back to noop in production with no Gmail config', async () => {
    process.env.NODE_ENV = 'production';
    const svc = new TrialEmailService(fakeLog);
    const result = await svc.sendVerifyEmail({
      to: 'prod@example.com',
      cleartextToken: tokenFixture('pppppppppppppppp', 'pppppppppppppppp'),
      companyName: null,
    });
    expect(result.delivered).toBe(false);
    expect(result.backend).toBe('noop');
    expect(fakeLog.warn).toHaveBeenCalled();
  });

  it('rendered email mentions defensive trust signals (no credit card, daily caps)', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'trial-email-test-'));
    process.env.JAK_TRIAL_EMAIL_LOG_DIR = tmp;
    const svc = new TrialEmailService(fakeLog);
    const result = await svc.sendVerifyEmail({
      to: 'x@y.co',
      cleartextToken: tokenFixture('abcdefabcdefabcd', 'efabcdefabcdef00'),
      companyName: null,
    });
    const parsed = JSON.parse(await fs.readFile(result.detail!, 'utf8'));
    expect(parsed.text).toMatch(/no credit card/i);
    expect(parsed.text).toMatch(/daily cap/i);
    expect(parsed.text).toMatch(/24 hours/i);
    await fs.rm(tmp, { recursive: true, force: true });
  });

  // P0-4 (audit 2026-05-08): hostile JAK_TRIAL_EMAIL_LOG_DIR must be
  // rejected, not silently followed.
  it('rejects JAK_TRIAL_EMAIL_LOG_DIR that resolves outside the allowlist', async () => {
    process.env.NODE_ENV = 'production'; // disable the dev tmp default
    process.env.JAK_TRIAL_EMAIL_LOG_DIR = '/etc/jak-evil';
    const svc = new TrialEmailService(fakeLog);
    const result = await svc.sendVerifyEmail({
      to: 'evil@example.com',
      cleartextToken: tokenFixture('aaaaaaaaaaaaaaaa', 'aaaaaaaaaaaaaaaa'),
      companyName: null,
    });
    expect(result.delivered).toBe(false);
    expect(result.backend).toBe('noop');
    // No file should have been created at /etc/jak-evil — and even if the
    // OS would have permitted it, our validateLogDir() returned null first.
    expect(fakeLog.error).toHaveBeenCalledWith(
      expect.objectContaining({ rawLogDir: '/etc/jak-evil' }),
      expect.stringContaining('rejected by allowlist'),
    );
  });

  it('rejects JAK_TRIAL_EMAIL_LOG_DIR containing traversal sequences', async () => {
    process.env.NODE_ENV = 'production';
    process.env.JAK_TRIAL_EMAIL_LOG_DIR = path.join(os.tmpdir(), '..', 'evil');
    const svc = new TrialEmailService(fakeLog);
    const result = await svc.sendVerifyEmail({
      to: 'x@y.co',
      cleartextToken: tokenFixture('bbbbbbbbbbbbbbbb', 'bbbbbbbbbbbbbbbb'),
      companyName: null,
    });
    expect(result.delivered).toBe(false);
    expect(result.backend).toBe('noop');
  });

  it('accepts JAK_TRIAL_EMAIL_LOG_DIR inside JAK_ALLOWED_DATA_ROOT', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'trial-email-root-'));
    process.env.JAK_ALLOWED_DATA_ROOT = root;
    process.env.JAK_TRIAL_EMAIL_LOG_DIR = path.join(root, 'subdir');
    const svc = new TrialEmailService(fakeLog);
    const result = await svc.sendVerifyEmail({
      to: 'ok@example.com',
      cleartextToken: tokenFixture('cccccccccccccccc', 'cccccccccccccccc'),
      companyName: null,
    });
    expect(result.delivered).toBe(true);
    expect(result.backend).toBe('file');
    await fs.rm(root, { recursive: true, force: true });
  });
});
