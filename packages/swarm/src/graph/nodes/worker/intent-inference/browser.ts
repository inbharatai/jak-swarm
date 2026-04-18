import { extractUrlFromDescription } from './text.js';

// ─── Types ─────────────────────────────────────────────────────────────────

export type BrowserActionType = 'NAVIGATE' | 'EXTRACT' | 'FILL_FORM' | 'CLICK' | 'SCREENSHOT' | 'WAIT';
export type BrowserActionRisk = 'READ' | 'NAVIGATION' | 'WRITE';
export type IntentConfidence = 'LOW' | 'MEDIUM' | 'HIGH';

export interface BrowserActionShape {
  type: BrowserActionType;
  url?: string;
  selector?: string;
}

export interface BrowserIntentCandidate {
  action: BrowserActionShape;
  confidence: IntentConfidence;
  risk: BrowserActionRisk;
  reason: string;
}

export interface BrowserExecutionPlan {
  actions: BrowserActionShape[];
  safetyMode: 'NORMAL' | 'SAFE_READ_ONLY';
  safetyReason?: string;
}

// ─── Plan builder ──────────────────────────────────────────────────────────

export function buildBrowserExecutionPlan(
  description: string,
  upstreamApprovalRequired: boolean,
): BrowserExecutionPlan {
  const candidates = inferBrowserIntentCandidates(description);
  const deterministic = candidates.filter((c) => c.confidence !== 'LOW');

  if (deterministic.length === 0) {
    return {
      // Ambiguous browser tasks default to read-only extraction for deterministic behavior.
      actions: [{ type: 'EXTRACT', selector: 'body' }],
      safetyMode: 'SAFE_READ_ONLY',
      safetyReason: 'Low-confidence browser intent; falling back to safe read-only extraction.',
    };
  }

  // Worker never escalates write actions into execution unless approval was already required upstream.
  const blockedWrite = deterministic.filter((c) => c.risk === 'WRITE' && !upstreamApprovalRequired);
  if (blockedWrite.length > 0) {
    const safeActions = deterministic
      .filter((c) => c.risk !== 'WRITE')
      .map((c) => c.action);

    return {
      actions: safeActions.length > 0 ? safeActions : [{ type: 'EXTRACT', selector: 'body' }],
      safetyMode: 'SAFE_READ_ONLY',
      safetyReason: `Blocked side-effect browser intents without explicit upstream approval: ${blockedWrite
        .map((c) => c.action.type)
        .join(', ')}`,
    };
  }

  return {
    actions: deterministic.map((c) => c.action),
    safetyMode: 'NORMAL',
  };
}

// ─── Intent inference ──────────────────────────────────────────────────────

function inferBrowserIntentCandidates(description: string): BrowserIntentCandidate[] {
  const desc = description.toLowerCase();
  const candidates: BrowserIntentCandidate[] = [];
  const url = extractUrlFromDescription(description);

  if (url) {
    candidates.push({
      action: { type: 'NAVIGATE', url },
      confidence: 'HIGH',
      risk: 'NAVIGATION',
      reason: 'Explicit URL detected in task description.',
    });
  }

  if (/\b(extract|read|scrape|capture|inspect)\b/.test(desc)) {
    candidates.push({
      action: { type: 'EXTRACT', selector: 'body' },
      confidence: 'MEDIUM',
      risk: 'READ',
      reason: 'Read-only extraction intent detected.',
    });
  }

  if (/\b(wait|load|appear|visible)\b/.test(desc)) {
    candidates.push({
      action: { type: 'WAIT' },
      confidence: 'MEDIUM',
      risk: 'READ',
      reason: 'Wait intent detected for page readiness.',
    });
  }

  if (/\b(fill form|complete form|enter details|submit form|apply now|send application)\b/.test(desc)) {
    candidates.push({
      action: { type: 'FILL_FORM' },
      confidence: 'MEDIUM',
      risk: 'WRITE',
      reason: 'Potential side-effect form interaction intent detected.',
    });
  }

  if (/\b(click|submit|confirm|purchase|delete|send)\b/.test(desc)) {
    candidates.push({
      action: { type: 'CLICK' },
      confidence: 'LOW',
      risk: 'WRITE',
      reason: 'Click/submit intent detected but ambiguous without explicit selector context.',
    });
  }

  return dedupeBrowserCandidates(candidates);
}

function dedupeBrowserCandidates(candidates: BrowserIntentCandidate[]): BrowserIntentCandidate[] {
  const byType = new Map<BrowserActionType, BrowserIntentCandidate>();
  for (const candidate of candidates) {
    const existing = byType.get(candidate.action.type);
    if (!existing || confidenceRank(candidate.confidence) > confidenceRank(existing.confidence)) {
      byType.set(candidate.action.type, candidate);
    }
  }
  return [...byType.values()];
}

function confidenceRank(level: IntentConfidence): number {
  if (level === 'HIGH') return 3;
  if (level === 'MEDIUM') return 2;
  return 1;
}
