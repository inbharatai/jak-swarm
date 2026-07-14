/**
 * gmail-ingestion.test.ts — pins the B1 deep-Gmail extraction helpers
 * (truth-doc B1: the brain no longer feeds on a truncated snippet).
 *
 * Pure helpers exported from company-connector-sync.service.ts:
 *   - base64UrlToUtf8: Gmail's unpadded base64url body encoding -> utf8.
 *   - extractGmailTextAndAttachments: walks a format=full payload, returns
 *     inline text/plain (preferred), text/html, and attachment metadata.
 */
import { describe, it, expect } from 'vitest';
import {
  base64UrlToUtf8,
  extractGmailTextAndAttachments,
} from '../../../apps/api/src/services/company-brain/company-connector-sync.service.js';

function b64url(s: string): string {
  return Buffer.from(s, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

describe('base64UrlToUtf8 (Gmail body decoding)', () => {
  it('decodes unpadded base64url back to the original utf8 string', () => {
    const original = 'Hello from InBharat — rates are going up next quarter.';
    expect(base64UrlToUtf8(b64url(original))).toBe(original);
  });

  it('returns null for non-string / empty input', () => {
    expect(base64UrlToUtf8(undefined)).toBeNull();
    expect(base64UrlToUtf8('')).toBeNull();
    expect(base64UrlToUtf8(123)).toBeNull();
  });
});

describe('extractGmailTextAndAttachments (format=full payload walk)', () => {
  it('extracts text/plain, text/html, and attachment metadata from a multipart payload', () => {
    const payload = {
      mimeType: 'multipart/mixed',
      parts: [
        {
          mimeType: 'text/plain',
          body: { data: b64url('The decision: ship on Friday. Owner: Reetu.') },
        },
        {
          mimeType: 'text/html',
          body: { data: b64url('<p>The decision: ship on Friday.</p>') },
        },
        {
          mimeType: 'application/pdf',
          filename: 'contract.pdf',
          body: { attachmentId: 'att_123', size: 4096 },
        },
        {
          mimeType: 'multipart/alternative',
          parts: [
            { mimeType: 'text/plain', body: { data: b64url('Second plain part.') } },
          ],
        },
      ],
    };

    const out = extractGmailTextAndAttachments(payload);
    expect(out.text).toContain('The decision: ship on Friday. Owner: Reetu.');
    expect(out.text).toContain('Second plain part.');
    expect(out.html).toContain('<p>The decision: ship on Friday.</p>');
    expect(out.attachments).toHaveLength(1);
    expect(out.attachments[0]).toEqual({
      filename: 'contract.pdf',
      mimeType: 'application/pdf',
      size: 4096,
      attachmentId: 'att_123',
    });
  });

  it('returns empty text/html and no attachments for a plain-text-only message', () => {
    const payload = { mimeType: 'text/plain', body: { data: b64url('Just a short note.') } };
    const out = extractGmailTextAndAttachments(payload);
    expect(out.text).toBe('Just a short note.');
    expect(out.html).toBeNull();
    expect(out.attachments).toEqual([]);
  });

  it('handles malformed payloads without throwing', () => {
    expect(() => extractGmailTextAndAttachments(null)).not.toThrow();
    expect(() => extractGmailTextAndAttachments({ parts: 'not-an-array' })).not.toThrow();
    expect(extractGmailTextAndAttachments({ parts: 'not-an-array' }).text).toBe('');
    // A part with non-string body data is skipped (base64UrlToUtf8 returns null), not thrown.
    const out = extractGmailTextAndAttachments({ mimeType: 'text/plain', body: { data: 123 } });
    expect(out.text).toBe('');
    expect(out.attachments).toEqual([]);
  });
});
