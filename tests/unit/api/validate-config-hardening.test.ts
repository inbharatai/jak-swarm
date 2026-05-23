import { describe, expect, it } from 'vitest';
import {
  hasSpaceSeparatedCorsOrigins,
  hasUnresolvedTemplateValue,
  isLikelyWeakSecret,
} from '../../../apps/api/src/boot/validate-config.ts';

describe('validate-config hardening helpers', () => {
  describe('isLikelyWeakSecret', () => {
    it('flags known placeholder patterns', () => {
      expect(isLikelyWeakSecret('dev-secret-placeholder-please-rotate-001')).toBe(true);
      expect(isLikelyWeakSecret('local-dev-secret-not-for-production-001')).toBe(true);
    });

    it('flags short or low-entropy values', () => {
      expect(isLikelyWeakSecret('short-secret-123')).toBe(true);
      expect(isLikelyWeakSecret('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')).toBe(true);
    });

    it('accepts a high-entropy secret', () => {
      expect(
        isLikelyWeakSecret('b8ff3fb63c4f2bc0970fd261905ecf07d8e2f40b0f3da1ac4f1142b71ac4d56f'),
      ).toBe(false);
    });
  });

  describe('hasSpaceSeparatedCorsOrigins', () => {
    it('detects multi-origin values separated by spaces', () => {
      expect(hasSpaceSeparatedCorsOrigins('https://jakswarm.com https://www.jakswarm.com')).toBe(true);
      expect(hasSpaceSeparatedCorsOrigins('https://jakswarm.com\nhttps://www.jakswarm.com')).toBe(true);
    });

    it('allows valid comma-separated or single-origin values', () => {
      expect(hasSpaceSeparatedCorsOrigins('https://jakswarm.com,https://www.jakswarm.com')).toBe(false);
      expect(hasSpaceSeparatedCorsOrigins('https://jakswarm.com, https://www.jakswarm.com')).toBe(false);
      expect(hasSpaceSeparatedCorsOrigins('https://jakswarm.com')).toBe(false);
    });
  });

  describe('hasUnresolvedTemplateValue', () => {
    it('detects unresolved Railway templates', () => {
      expect(hasUnresolvedTemplateValue('${{Redis.REDIS_URL}}')).toBe(true);
      expect(hasUnresolvedTemplateValue('postgresql://u:p@h:5432/db?x=${{TOKEN}}')).toBe(true);
    });

    it('accepts fully-resolved values', () => {
      expect(hasUnresolvedTemplateValue('redis://default:abc123@redis:6379')).toBe(false);
      expect(hasUnresolvedTemplateValue(undefined)).toBe(false);
    });
  });
});
