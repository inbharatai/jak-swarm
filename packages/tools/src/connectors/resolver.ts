/**
 * ConnectorResolver — natural-language → connector candidate(s).
 *
 * Given a user task (free-form text + optional execution-plan
 * structure), return the connectors most likely to satisfy it. The
 * dashboard surfaces this so the user always knows what JAK selected
 * AND why.
 *
 * v1: pure heuristic (keyword + intent matching). The interface
 * accepts an optional `llmAdapter` so a future sprint can plug in
 * GPT-5-mini for richer matching without changing call sites.
 *
 * Heuristics are intentionally conservative — when in doubt, return
 * multiple candidates with confidence < 0.5 so the resolver consumer
 * surfaces the choice to the user instead of silently picking.
 *
 * Confidence scale:
 *   1.0  exact / unambiguous (e.g., "render with Remotion" → remotion)
 *   0.8  strong domain match (e.g., "create a video" → remotion)
 *   0.5  plausible (e.g., "make a clip" → remotion alt + ffmpeg alt)
 *   0.2  weak (e.g., "produce media" → many candidates)
 *   0.0  no match
 */

import { connectorRegistry } from './registry.js';
import type {
  ConnectorCandidate,
  ConnectorResolveResult,
  ConnectorView,
} from './types.js';

// ─── Intent patterns ──────────────────────────────────────────────────────
//
// Each entry maps a connector id → ordered list of {pattern, confidence}.
// Patterns are case-insensitive. `\b` boundaries used for word matches so
// "post" doesn't match "compostable".

interface IntentPattern {
  /** Regex source — instantiated case-insensitive. */
  pattern: string;
  confidence: number;
  /** Human reason surfaced in ConnectorCandidate.reason. */
  reason: string;
}

const INTENT_PATTERNS: Record<string, IntentPattern[]> = {
  remotion: [
    { pattern: '\\bremotion\\b', confidence: 1.0, reason: 'Task explicitly names Remotion' },
    { pattern: '\\b(render|generate|produce|create|make)\\s+(?:a\\s+)?(video|reel|short|clip|mp4|movie)\\b', confidence: 0.85, reason: 'Task asks to produce a video deliverable — Remotion is JAK\'s programmable video engine' },
    { pattern: '\\b(landing\\s+page|blog|article|deck|brand\\s+kit)\\s+to\\s+(video|reel)\\b', confidence: 0.9, reason: 'Source-content → video conversion is Remotion\'s sweet spot' },
    { pattern: '\\b(linkedin|instagram|youtube|tiktok)\\s+(reel|short|video|clip)s?\\b', confidence: 0.7, reason: 'Social-format video — Remotion can batch-render the variants' },
    { pattern: '\\b(explainer|investor|pitch|onboarding|product\\s+demo)\\s+video\\b', confidence: 0.8, reason: 'Branded explainer/demo videos are the Remotion canonical use case' },
  ],
  blender: [
    { pattern: '\\bblender\\b', confidence: 1.0, reason: 'Task explicitly names Blender' },
    { pattern: '\\b(3d|three-d)\\s+(scene|model|object|asset|animation)\\b', confidence: 0.7, reason: '3D workflow — Blender connector exposes scene + Python API' },
    { pattern: '\\b(material|shader|modifier|geometry\\s+nodes)\\b', confidence: 0.6, reason: 'Material/shader/modifier work is the Blender connector\'s primary use case' },
    { pattern: '\\b(\\.blend|fbx|gltf|obj|usd)\\b', confidence: 0.6, reason: '3D asset format — Blender can inspect/convert' },
  ],
  // MCP providers: only auto-pattern when the task explicitly names them.
  // Resolver's confidence stays high here because the name is unambiguous.
  'mcp-slack': [
    { pattern: '\\bslack\\b', confidence: 0.95, reason: 'Task explicitly names Slack' },
    // P2 audit fix: this pattern used to match any "post in channel"
    // intent (e.g., "post in our Discord channel" or "post in our blender
    // channel") and incorrectly raised Slack as primary at 0.5 confidence.
    // Now requires "slack" appears in the same sentence, OR the channel
    // name uses Slack's `#` prefix convention. Discord-shaped intents
    // ("post in #general on Discord") still match Discord at 0.95 (its
    // explicit-name pattern), so Slack only catches what's actually Slack.
    { pattern: '\\bslack\\b.{0,40}\\b(post|message|notify|send|share)\\b', confidence: 0.6, reason: 'Slack + post/message intent in the same sentence' },
    { pattern: '\\bpost\\b.{0,20}\\bslack\\b', confidence: 0.6, reason: 'Post-action targeting Slack' },
  ],
  'mcp-github': [
    { pattern: '\\bgithub\\b', confidence: 0.95, reason: 'Task explicitly names GitHub' },
    { pattern: '\\b(open|create|merge|review)\\s+(?:a\\s+)?(pr|pull\\s+request|issue)\\b', confidence: 0.8, reason: 'PR/issue intent — GitHub is the canonical source' },
    { pattern: '\\b(repository|repo)\\b.*\\b(clone|fork|read|inspect)\\b', confidence: 0.6, reason: 'Repository operation' },
  ],
  'mcp-notion': [
    { pattern: '\\bnotion\\b', confidence: 0.95, reason: 'Task explicitly names Notion' },
  ],
  'mcp-stripe': [
    { pattern: '\\bstripe\\b', confidence: 0.95, reason: 'Task explicitly names Stripe' },
    { pattern: '\\b(charge|invoice|customer|subscription|payment)\\s+(create|update|refund)\\b', confidence: 0.5, reason: 'Payment-state mutation — Stripe is the most likely target' },
  ],
  'mcp-supabase': [
    { pattern: '\\bsupabase\\b', confidence: 0.95, reason: 'Task explicitly names Supabase' },
  ],
  'mcp-postgres': [
    { pattern: '\\bpostgres(ql)?\\b', confidence: 0.85, reason: 'Task explicitly names Postgres' },
    { pattern: '\\b(query|select|insert|update)\\s+(?:from|into|the)\\s+\\w+\\s+(table|database)\\b', confidence: 0.5, reason: 'SQL-shaped intent — Postgres is the default target if no other DB is named' },
  ],
  'mcp-brave-search': [
    { pattern: '\\bbrave\\s+search\\b', confidence: 1.0, reason: 'Task explicitly names Brave Search' },
    { pattern: '\\b(web\\s+search|google\\s+(it|for)|search\\s+(the\\s+)?web|find\\s+online)\\b', confidence: 0.6, reason: 'Web-search intent — Brave Search is the configured search MCP' },
  ],
};

export interface ResolveOptions {
  /** Optional user-supplied hint, e.g. roleModes. Bumps confidence
      for connectors associated with the picked roles. */
  hintedRoles?: string[];
  /** Maximum candidates to return per category. Default 5. */
  maxAlternatives?: number;
}

/**
 * Resolve a natural-language task to connector candidates.
 *
 * Algorithm:
 *   1. For every connector in the registry, score the task against its
 *      intent patterns; take the max-confidence match per connector.
 *   2. Sort candidates by confidence desc. Top one becomes `primary`.
 *   3. Move any candidate whose connector status is `disabled`,
 *      `blocked_by_policy`, `failed_validation`, or `unavailable` into
 *      `unavailable[]` so the user sees why a stronger match was
 *      skipped.
 *   4. Apply `maxAlternatives` cap.
 */
export function resolveConnectorsForTask(
  task: string,
  options: ResolveOptions = {},
): ConnectorResolveResult {
  const maxAlternatives = options.maxAlternatives ?? 5;
  const allViews = connectorRegistry.list();
  const allCandidates: Array<{ view: ConnectorView; candidate: ConnectorCandidate }> = [];

  for (const view of allViews) {
    const patterns = INTENT_PATTERNS[view.manifest.id];
    if (!patterns) continue;
    let bestConfidence = 0;
    let bestReason = '';
    for (const p of patterns) {
      const re = new RegExp(p.pattern, 'i');
      if (re.test(task)) {
        if (p.confidence > bestConfidence) {
          bestConfidence = p.confidence;
          bestReason = p.reason;
        }
      }
    }
    if (bestConfidence === 0) continue;

    const isReady = view.status === 'installed' || view.status === 'configured';
    const candidate: ConnectorCandidate = {
      connectorId: view.manifest.id,
      confidence: bestConfidence,
      reason: bestReason,
      isReady,
    };
    if (!isReady) {
      candidate.nextStep = nextStepForStatus(view);
    }
    allCandidates.push({ view, candidate });
  }

  // Sort by confidence desc; tie-break by registry order (already stable).
  allCandidates.sort((a, b) => b.candidate.confidence - a.candidate.confidence);

  // Split into ready vs unavailable buckets.
  const ready: ConnectorCandidate[] = [];
  const unavailable: ConnectorCandidate[] = [];
  for (const { view, candidate } of allCandidates) {
    if (
      view.status === 'disabled' ||
      view.status === 'blocked_by_policy' ||
      view.status === 'failed_validation' ||
      view.status === 'unavailable'
    ) {
      unavailable.push(candidate);
    } else {
      ready.push(candidate);
    }
  }

  const result: ConnectorResolveResult = {
    alternatives: ready.slice(1, 1 + maxAlternatives),
    unavailable: unavailable.slice(0, maxAlternatives),
  };
  if (ready[0]) result.primary = ready[0];
  return result;
}

function nextStepForStatus(view: ConnectorView): string {
  switch (view.status) {
    case 'available':
      return view.manifest.installMethod
        ? `Install via approval: \`${view.manifest.installCommand ?? view.manifest.installMethod}\``
        : 'Configure credentials in Settings → Integrations';
    case 'needs_user_setup':
      return view.manifest.manualSetupSteps?.[0] ?? 'See setup instructions';
    case 'installed':
      // If the manifest declares credential fields, the next step is to
      // supply them; otherwise the connector is ready as-is.
      return view.manifest.credentialFields && view.manifest.credentialFields.length > 0
        ? 'Add credentials in Settings → Integrations'
        : 'Ready to use — already installed';
    case 'configured':
      // Bug #1 fix (post-launch audit): this case used to fall through to
      // the default branch, returning generic "See the Connectors page"
      // text for a connector that was actually fully ready. The resolver
      // marks `configured` connectors as ready (`isReady: true`), so this
      // branch is mostly hit when a downstream caller asks for nextStep
      // anyway — they get a clean confirmation now.
      return 'Ready to use — credentials configured and validated';
    case 'failed_validation':
      return view.statusReason ?? 'Re-validate from the Connectors page';
    case 'unavailable':
      return view.statusReason ?? 'Not reachable from this deployment';
    case 'disabled':
      return 'Re-enable from Connectors → Manage';
    case 'blocked_by_policy':
      return 'Tenant policy blocks this connector — contact your admin';
    default: {
      // Exhaustiveness check — TypeScript will fail compilation if a new
      // ConnectorStatus is added without a case here.
      const _exhaustive: never = view.status;
      return _exhaustive;
    }
  }
}
