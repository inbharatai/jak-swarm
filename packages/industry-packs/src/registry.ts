import { Industry } from '@jak-swarm/shared';
import type { IndustryPack } from '@jak-swarm/shared';
import { INDUSTRY_KEYWORDS } from '@jak-swarm/shared';
import { healthcarePack } from './packs/healthcare.js';
import { educationPack } from './packs/education.js';
import { retailPack } from './packs/retail.js';
import { logisticsPack } from './packs/logistics.js';
import { financePack } from './packs/finance.js';
import { insurancePack } from './packs/insurance.js';
import { recruitingPack } from './packs/recruiting.js';
import { legalPack } from './packs/legal.js';
import { hospitalityPack } from './packs/hospitality.js';
import { customerSupportPack } from './packs/customer-support.js';
import { generalPack } from './packs/general.js';

// Stub packs for industries that share the general structure but have unique keywords
const manufacturingPack: IndustryPack = {
  ...generalPack,
  industry: Industry.MANUFACTURING,
  displayName: 'Manufacturing Operations',
  description:
    'Workflow automation for manufacturing operations including production scheduling, quality control, maintenance coordination, supply chain management, and compliance reporting.',
  subFunctions: [
    'Production Scheduling',
    'Quality Control',
    'Maintenance Coordination',
    'Supply Chain',
    'Safety Compliance',
    'Reporting',
  ],
  complianceNotes: [
    'ISO 9001: Quality management system documentation requirements',
    'OSHA: Workplace safety records must be maintained',
    'Environmental compliance: emissions and waste records required',
    'Corrective Action Reports (CARs) require root cause analysis',
  ],
  agentPromptSupplement: `MANUFACTURING CONTEXT:
1. Safety-first: Any task touching safety-critical systems requires human sign-off
2. Quality records must be traceable to production batches
3. Maintenance windows must be coordinated with production scheduling
4. Non-conformances require documented corrective action`,
};

const consultingPack: IndustryPack = {
  ...generalPack,
  industry: Industry.CONSULTING,
  displayName: 'Consulting Operations',
  description:
    'Workflow automation for consulting firms including engagement management, deliverable tracking, client communication, proposal generation, and billing.',
  subFunctions: [
    'Engagement Management',
    'Deliverable Tracking',
    'Client Communication',
    'Proposal Generation',
    'Resource Planning',
    'Billing',
  ],
  complianceNotes: [
    'Client confidentiality: deliverables and engagement details are confidential',
    'Conflict of interest checks required for new engagements',
    'IP ownership clauses in SOW govern deliverable sharing',
  ],
  agentPromptSupplement: `CONSULTING CONTEXT:
1. Client deliverables are confidential — never share one client's materials with another
2. All client-facing communications require senior review
3. Time tracking must be accurate and aligned to project codes
4. Proposal content must be approved before sending to prospects`,
};

export const INDUSTRY_PACK_REGISTRY: Record<Industry, IndustryPack> = {
  [Industry.HEALTHCARE]: healthcarePack,
  [Industry.EDUCATION]: educationPack,
  [Industry.RETAIL]: retailPack,
  [Industry.LOGISTICS]: logisticsPack,
  [Industry.FINANCE]: financePack,
  [Industry.INSURANCE]: insurancePack,
  [Industry.RECRUITING]: recruitingPack,
  [Industry.LEGAL]: legalPack,
  [Industry.HOSPITALITY]: hospitalityPack,
  [Industry.CUSTOMER_SUPPORT]: customerSupportPack,
  [Industry.MANUFACTURING]: manufacturingPack,
  [Industry.CONSULTING]: consultingPack,
  [Industry.GENERAL]: generalPack,
};

export function getIndustryPack(industry: Industry): IndustryPack {
  const pack = INDUSTRY_PACK_REGISTRY[industry];
  if (!pack) {
    return INDUSTRY_PACK_REGISTRY[Industry.GENERAL];
  }
  return pack;
}

/**
 * Classify an industry from free text using keyword matching.
 * Returns the industry with the most keyword matches, falling back to GENERAL.
 */
export function classifyIndustry(text: string): Industry {
  const lower = text.toLowerCase();
  let bestMatch: Industry = Industry.GENERAL;
  let bestScore = 0;

  for (const [industry, keywords] of Object.entries(INDUSTRY_KEYWORDS) as Array<[Industry, string[]]>) {
    const score = keywords.filter((kw) => lower.includes(kw)).length;
    if (score > bestScore) {
      bestScore = score;
      bestMatch = industry;
    }
  }

  return bestMatch;
}

export function listIndustries(): Array<{ industry: Industry; displayName: string; description: string }> {
  return Object.values(INDUSTRY_PACK_REGISTRY).map((pack) => ({
    industry: pack.industry,
    displayName: pack.displayName,
    description: pack.description,
  }));
}
