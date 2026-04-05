import { describe, it, expect } from 'vitest';
// Import from the compiled package or source
// Since we're testing directly, import from source path
import { detectPII, containsPII } from '../../../packages/security/src/guardrails/pii-detector.js';

describe('PII Detector', () => {
  it('detects email addresses', () => {
    const result = detectPII('Contact john.doe@example.com for details');
    expect(result.found).toContain('EMAIL');
    expect(containsPII('no pii here')).toBe(false);
  });

  it('detects SSN patterns', () => {
    const result = detectPII('SSN: 123-45-6789');
    expect(result.found).toContain('SSN');
  });

  it('detects phone numbers', () => {
    const result = detectPII('Call me at (555) 123-4567');
    expect(result.found).toContain('PHONE');
  });

  it('redacts detected PII', () => {
    const result = detectPII('Email: test@example.com');
    expect(result.redacted).not.toContain('test@example.com');
    expect(result.redacted).toContain('[REDACTED-EMAIL]');
  });

  it('returns no PII for clean text', () => {
    const result = detectPII('The shipment arrived at the warehouse on Tuesday.');
    expect(result.found).toHaveLength(0);
    expect(containsPII('The shipment arrived at the warehouse')).toBe(false);
  });
});
