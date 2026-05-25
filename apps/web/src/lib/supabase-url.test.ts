import { describe, expect, it } from 'vitest';
import { hasRestPathSuffix, normalizeSupabaseProjectUrl } from './supabase-url';

describe('supabase URL normalization', () => {
  it('normalizes REST endpoint URLs to project origin', () => {
    expect(normalizeSupabaseProjectUrl('https://ttrhawuqydfecndehdhx.supabase.co/rest/v1/')).toBe(
      'https://ttrhawuqydfecndehdhx.supabase.co',
    );
  });

  it('keeps project origin unchanged', () => {
    expect(normalizeSupabaseProjectUrl('https://ttrhawuqydfecndehdhx.supabase.co')).toBe(
      'https://ttrhawuqydfecndehdhx.supabase.co',
    );
  });

  it('detects REST path suffix correctly', () => {
    expect(hasRestPathSuffix('https://ttrhawuqydfecndehdhx.supabase.co/rest/v1')).toBe(true);
    expect(hasRestPathSuffix('https://ttrhawuqydfecndehdhx.supabase.co')).toBe(false);
  });
});
