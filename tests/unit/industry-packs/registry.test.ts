import { describe, it, expect } from 'vitest';
import { getIndustryPack, classifyIndustry } from '../../../packages/industry-packs/src/registry.js';
import { Industry } from '../../../packages/shared/src/types/industry.js';

describe('Industry Pack Registry', () => {
  it('returns healthcare pack', () => {
    const pack = getIndustryPack(Industry.HEALTHCARE);
    expect(pack.industry).toBe(Industry.HEALTHCARE);
    expect(pack.complianceNotes.length).toBeGreaterThan(0);
    expect(pack.allowedTools.length).toBeGreaterThan(0);
  });

  it('classifies healthcare from text', () => {
    const industry = classifyIndustry('We process patient intake forms and route claims');
    expect(industry).toBe(Industry.HEALTHCARE);
  });

  it('classifies recruiting from text', () => {
    const industry = classifyIndustry('Screen these resumes and update the ATS with shortlisted candidates');
    expect(industry).toBe(Industry.RECRUITING);
  });

  it('classifies logistics from text', () => {
    const industry = classifyIndustry('Track shipment delays and notify clients about delivery updates');
    expect(industry).toBe(Industry.LOGISTICS);
  });

  it('falls back to GENERAL for unknown industry', () => {
    const industry = classifyIndustry('This is some completely unrelated text with no industry keywords xyz');
    expect(industry).toBe(Industry.GENERAL);
  });

  it('all 10 packs have compliance notes', () => {
    const industries = [
      Industry.HEALTHCARE, Industry.EDUCATION, Industry.RETAIL,
      Industry.LOGISTICS, Industry.FINANCE, Industry.INSURANCE,
      Industry.RECRUITING, Industry.LEGAL, Industry.HOSPITALITY,
      Industry.CUSTOMER_SUPPORT,
    ];
    for (const ind of industries) {
      const pack = getIndustryPack(ind);
      expect(pack.complianceNotes.length, `${ind} should have compliance notes`).toBeGreaterThan(0);
    }
  });
});
