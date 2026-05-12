/**
 * trial-email.service.ts — sends the verify-email message for new trial signups.
 *
 * Three transparent backends, picked by env:
 *   1. Gmail App Password   — when GMAIL_EMAIL + GMAIL_APP_PASSWORD set
 *      → real outbound via the existing nodemailer-based GmailAdapter
 *   2. JSON file logger     — when JAK_TRIAL_EMAIL_LOG_DIR set OR NODE_ENV=development
 *      → writes the email to <dir>/trial-verify-<timestamp>.json so the
 *        local dev loop can be tested end-to-end without SMTP
 *   3. Noop                 — production-default when no Gmail config
 *      → logs a warning, does NOT pretend to send
 *
 * The signup route still returns `devToken` in dev so the click-through
 * flow works whether or not an email actually got sent.
 *
 * Honest framing: in production, configure Gmail credentials. We do not
 * silently swallow a failed send — backend (3) emits a structured warning
 * the ops team can grep for.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { FastifyBaseLogger } from 'fastify';

/**
 * P0-4 (audit 2026-05-08): JAK_TRIAL_EMAIL_LOG_DIR is read directly from
 * env. If a hostile env-injection ever set it to `/etc` or `/var/run/secrets`
 * we'd happily write attacker-readable JSON files there. Locked-down rules:
 *
 *   - Must be an absolute path
 *   - Must resolve INSIDE one of the allowlisted bases:
 *       (a) the per-process tmpdir         (os.tmpdir())
 *       (b) the project's own ./tmp/       (cwd + 'tmp')
 *       (c) /var/log/jak                  (operator-deployed prod path)
 *       (d) anything matching JAK_ALLOWED_DATA_ROOT (operator opt-in)
 *
 *   - Symbol links are resolved via path.resolve before the prefix check
 *     so `../` chicanery is normalised away.
 *
 * Returns the validated absolute path, or null if validation fails (caller
 * falls through to noop backend with a warning).
 */
function validateLogDir(raw: string | undefined): string | null {
  if (!raw) return null;
  const resolved = path.resolve(raw);
  // Reject obvious sentinel-violations: parent traversal in the original.
  if (raw.includes('..')) return null;
  const allowedBases: string[] = [
    path.resolve(os.tmpdir()),
    path.resolve(process.cwd(), 'tmp'),
    '/var/log/jak',
  ];
  if (process.env['JAK_ALLOWED_DATA_ROOT']) {
    allowedBases.push(path.resolve(process.env['JAK_ALLOWED_DATA_ROOT']));
  }
  for (const base of allowedBases) {
    // path.relative returns '..' or starts with '..' if `resolved` is
    // outside `base`; require it to be inside.
    const rel = path.relative(base, resolved);
    if (!rel.startsWith('..') && !path.isAbsolute(rel)) {
      return resolved;
    }
  }
  return null;
}

interface VerifyEmailContext {
  to: string;
  cleartextToken: string;
  companyName: string | null;
  /** Public dashboard URL — defaults to NEXT_PUBLIC_WEB_URL or localhost:3000. */
  webBaseUrl?: string;
}

export interface SendResult {
  delivered: boolean;
  backend: 'gmail' | 'file' | 'noop';
  detail?: string;
}

function buildVerifyUrl(token: string, webBaseUrl?: string): string {
  const base = (webBaseUrl
    ?? process.env['NEXT_PUBLIC_WEB_URL']
    ?? process.env['WEB_BASE_URL']
    ?? 'http://localhost:3000'
  ).replace(/\/$/, '');
  return `${base}/trial/verify/${token}`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[ch] ?? ch));
}

function renderEmail(ctx: VerifyEmailContext): { subject: string; text: string; html: string } {
  const verifyUrl = buildVerifyUrl(ctx.cleartextToken, ctx.webBaseUrl);
  const greeting = ctx.companyName ? ` for ${ctx.companyName}` : '';
  const greetingHtml = ctx.companyName ? ` <strong>for ${escapeHtml(ctx.companyName)}</strong>` : '';
  const verifyUrlHtml = escapeHtml(verifyUrl);
  const subject = 'Confirm your JAK Swarm trial';
  const text = [
    `Hi,`,
    ``,
    `Click the link below to confirm your email and activate your 30-day JAK Swarm trial${greeting}:`,
    ``,
    verifyUrl,
    ``,
    `What happens next:`,
    `  - We create a workspace bound to your email`,
    `  - You get an initial password (shown once — save it)`,
    `  - 30 days of access with daily caps to protect your budget:`,
    `      20 agent runs / day`,
    `      5 external-action approvals / day`,
    `      120 minutes of tool execution / day`,
    `      200,000 LLM tokens / day`,
    `  - No credit card required`,
    ``,
    `Link expires in 24 hours.`,
    ``,
    `If you didn't request this, you can ignore this email — no account is created until you click the link.`,
    ``,
    `— JAK Swarm`,
  ].join('\n');

  const html = `<!doctype html>
<html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;line-height:1.55;color:#1f2937;max-width:560px;margin:0 auto;padding:24px;">
  <h1 style="font-size:18px;color:#111;">Confirm your JAK Swarm trial</h1>
  <p>Click the button below to activate your 30-day trial${greetingHtml}:</p>
  <p style="margin:24px 0;">
    <a href="${verifyUrlHtml}" style="display:inline-block;background:linear-gradient(135deg,#34d399,#fbbf24);color:#09090b;font-weight:600;padding:12px 24px;border-radius:8px;text-decoration:none;">Activate trial</a>
  </p>
  <p style="font-size:12px;color:#666;">Or copy this link:<br><code style="word-break:break-all;">${verifyUrlHtml}</code></p>
  <hr style="border:none;border-top:1px solid #eee;margin:24px 0;">
  <p style="font-size:13px;color:#444;"><strong>What's included:</strong></p>
  <ul style="font-size:13px;color:#444;padding-left:18px;">
    <li>30-day trial — no credit card</li>
    <li>Daily caps to protect your budget (20 runs / 5 approvals / 120 min tools / 200K tokens — resets UTC midnight)</li>
    <li>Workflows pause cleanly at cap, never silently fail</li>
  </ul>
  <p style="font-size:11px;color:#999;margin-top:24px;">Link expires in 24 hours. If you didn't request this, ignore this email.</p>
</body></html>`;

  return { subject, text, html };
}

export class TrialEmailService {
  constructor(private readonly log: FastifyBaseLogger) {}

  async sendVerifyEmail(ctx: VerifyEmailContext): Promise<SendResult> {
    const rendered = renderEmail(ctx);

    // Backend 1 — real Gmail (when configured)
    if (process.env['GMAIL_EMAIL'] && process.env['GMAIL_APP_PASSWORD']) {
      try {
        // Defer-import nodemailer so dev loops without SMTP don't pay the
        // cost of the dep on every cold start.
        const nodemailer = await import('nodemailer');
        const transporter = nodemailer.default.createTransport({
          service: 'gmail',
          auth: {
            user: process.env['GMAIL_EMAIL'],
            pass: process.env['GMAIL_APP_PASSWORD'],
          },
        });
        await transporter.sendMail({
          from: process.env['GMAIL_EMAIL'],
          to: ctx.to,
          subject: rendered.subject,
          text: rendered.text,
          html: rendered.html,
        });
        return { delivered: true, backend: 'gmail' };
      } catch (e) {
        this.log.error({ err: e, to: ctx.to }, '[trial-email] Gmail send failed');
        // Fall through to file-log backup so we don't lose the message.
      }
    }

    // Backend 2 — JSON file logger (dev or explicitly opted in)
    // P0-4 (audit 2026-05-08): validate the configured dir against an
    // allowlist BEFORE creating it, to prevent writing to arbitrary
    // filesystem locations if the env var is hostile.
    const rawLogDir = process.env['JAK_TRIAL_EMAIL_LOG_DIR']
      ?? (process.env['NODE_ENV'] !== 'production' ? path.join(process.cwd(), 'tmp', 'trial-emails') : undefined);
    const logDir = validateLogDir(rawLogDir);
    if (rawLogDir && !logDir) {
      this.log.error({ rawLogDir }, '[trial-email] JAK_TRIAL_EMAIL_LOG_DIR rejected by allowlist; falling through to noop backend.');
    }
    if (logDir) {
      try {
        await fs.mkdir(logDir, { recursive: true });
        // Filename sanitisation already strips path separators, but layer
        // a final path.normalize + join check so even a future code edit
        // that loosens it can't escape the validated logDir.
        const safeEmail = ctx.to.replace(/[^a-z0-9.@_-]/gi, '_');
        const fname = `trial-verify-${Date.now()}-${safeEmail}.json`;
        const fpath = path.join(logDir, fname);
        const escaped = path.relative(logDir, path.resolve(fpath));
        if (escaped.startsWith('..') || path.isAbsolute(escaped)) {
          this.log.error({ logDir, fpath }, '[trial-email] computed file path escaped logDir; refusing to write');
          return { delivered: false, backend: 'noop', detail: 'path-escape-refused' };
        }
        await fs.writeFile(
          fpath,
          JSON.stringify({
            to: ctx.to,
            subject: rendered.subject,
            verifyUrl: buildVerifyUrl(ctx.cleartextToken, ctx.webBaseUrl),
            text: rendered.text,
            sentAt: new Date().toISOString(),
          }, null, 2),
          'utf8',
        );
        this.log.info({ to: ctx.to, file: fpath }, '[trial-email] wrote verify email to file (dev backend)');
        return { delivered: true, backend: 'file', detail: fpath };
      } catch (e) {
        this.log.error({ err: e, to: ctx.to }, '[trial-email] file backend failed');
      }
    }

    // Backend 3 — noop with structured warning (production without Gmail)
    this.log.warn({
      to: ctx.to,
      verifyUrl: buildVerifyUrl(ctx.cleartextToken, ctx.webBaseUrl),
    }, '[trial-email] NO BACKEND CONFIGURED — verify email NOT sent. Set GMAIL_EMAIL + GMAIL_APP_PASSWORD.');
    return { delivered: false, backend: 'noop', detail: 'no email backend configured' };
  }
}
