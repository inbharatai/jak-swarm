/**
 * Detects raw JSON in agent output and converts it to readable markdown.
 *
 * When the Commander/Verifier fails to compose a human-readable summary,
 * `workflow.finalOutput` may contain raw JSON (e.g. a ResearchResult object
 * with `findings`, `keyPoints`, `recommendations`). This utility detects
 * that and renders it as structured markdown instead of showing the user
 * a wall of curly braces.
 *
 * For plain strings and markdown, it passes them through unchanged.
 */

const STUB_RE = /Agents completed their work but did not produce a user-facing response|No output produced/i;

interface AgentOutput {
  findings?: string;
  keyPoints?: string[];
  recommendations?: string[];
  risks?: string[];
  summary?: string;
  analysis?: string;
  opportunities?: string[];
  securityFindings?: string[];
  tradeoffs?: string[];
  action?: string;
  confidence?: number | string;
  limitations?: string[];
  sources?: string[];
  suggestedFollowUp?: string;
  [key: string]: unknown;
}

/**
 * Render agent output (which may be raw JSON) as readable markdown.
 * Returns the original string if it's already markdown or plain text.
 */
export function renderAgentOutput(raw: string): string {
  if (!raw || raw.trim().length === 0) {
    return 'JAK completed the run, but no final response was generated. You can view the detailed trace in [Run Inspector](/swarm).';
  }

  if (STUB_RE.test(raw)) {
    return 'JAK completed the run, but no final response was generated. You can view the detailed trace in [Run Inspector](/swarm).';
  }

  // Quick check: does it look like JSON?
  const trimmed = raw.trim();
  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) ||
      (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    try {
      const parsed = JSON.parse(trimmed);
      return formatStructuredOutput(parsed);
    } catch {
      // Not valid JSON — return as-is (may be markdown from a successful composition)
      return raw;
    }
  }

  return raw;
}

function formatStructuredOutput(obj: unknown, depth = 0): string {
  if (obj === null || obj === undefined) return '';
  if (typeof obj === 'string') return obj;
  if (typeof obj === 'number') return String(obj);
  if (typeof obj === 'boolean') return String(obj);

  if (Array.isArray(obj)) {
    if (obj.length === 0) return '';
    // If it's an array of strings, render as bullet list
    if (obj.every((item) => typeof item === 'string')) {
      return obj.map((item) => `${'  '.repeat(depth)}- ${item}`).join('\n');
    }
    // If it's an array of objects, render each
    return obj
      .map((item, i) => {
        const formatted = formatStructuredOutput(item, depth + 1);
        return formatted ? `${'  '.repeat(depth)}${i + 1}. ${formatted}` : '';
      })
      .filter(Boolean)
      .join('\n');
  }

  if (typeof obj === 'object') {
    const rec = obj as AgentOutput;
    const lines: string[] = [];

    // Known high-value fields — render with headers in a stable order
    const fieldLabels: Record<string, string> = {
      findings: 'Findings',
      keyPoints: 'Key Points',
      recommendations: 'Recommendations',
      risks: 'Risks',
      summary: 'Summary',
      analysis: 'Analysis',
      opportunities: 'Opportunities',
      securityFindings: 'Security Findings',
      tradeoffs: 'Trade-offs',
      action: 'Action',
      confidence: 'Confidence',
      limitations: 'Limitations',
      sources: 'Sources',
      suggestedFollowUp: 'Next Steps',
      output: 'Output',
      result: 'Result',
      message: 'Message',
      description: 'Description',
      dataUnavailable: 'Data Unavailable',
    };

    const orderedFields = [
      'summary', 'analysis', 'findings', 'keyPoints', 'recommendations',
      'risks', 'opportunities', 'securityFindings', 'tradeoffs', 'action',
      'confidence', 'limitations', 'sources', 'suggestedFollowUp',
      'output', 'result', 'message', 'description', 'dataUnavailable',
    ];

    for (const field of orderedFields) {
      const value = rec[field];
      if (value === undefined || value === null) continue;
      const label = fieldLabels[field] ?? field;
      if (Array.isArray(value)) {
        if (value.length > 0) {
          lines.push(`**${label}:**`);
          lines.push(formatStructuredOutput(value, depth + 1));
        }
      } else if (typeof value === 'object' && value !== null) {
        lines.push(`**${label}:**`);
        lines.push(formatStructuredOutput(value, depth + 1));
      } else {
        const strVal = String(value);
        if (strVal.trim().length > 0) {
          lines.push(`**${label}:** ${strVal}`);
        }
      }
    }

    // Then render any remaining fields not in the ordered list
    for (const [key, value] of Object.entries(rec)) {
      if (orderedFields.includes(key)) continue;
      if (value === undefined || value === null) continue;
      if (typeof value === 'string' && value.trim().length === 0) continue;
      const label = fieldLabels[key] ?? key.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase());
      if (Array.isArray(value) && value.length > 0) {
        lines.push(`**${label}:**`);
        lines.push(formatStructuredOutput(value, depth + 1));
      } else if (typeof value === 'object' && value !== null) {
        lines.push(`**${label}:**`);
        lines.push(formatStructuredOutput(value, depth + 1));
      } else if (typeof value !== 'object') {
        lines.push(`**${label}:** ${String(value)}`);
      }
    }

    return lines.filter(Boolean).join('\n\n');
  }

  return String(obj);
}