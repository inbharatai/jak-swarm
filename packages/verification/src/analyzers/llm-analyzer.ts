/**
 * LLM-powered analysis layer for the verification engine.
 * Replaces heuristic-only analysis with actual LLM calls.
 *
 * Tier 1: GPT-4o-mini or Gemini Flash (fast, cheap)
 * Tier 3: GPT-4o or Claude Opus (deep reasoning)
 *
 * Falls back to heuristic analysis when no LLM API keys are configured.
 */

export interface LLMVerificationResult {
  findings: LLMFinding[];
  confidence: number;
  reasoning: string;
  tokensUsed: number;
  costUsd: number;
  model: string;
}

export interface LLMFinding {
  id: string;
  severity: 'CRITICAL' | 'WARNING' | 'INFO';
  category: string;
  description: string;
  evidence: string;
  source: string;
}

type VerificationType = 'EMAIL' | 'DOCUMENT' | 'TRANSACTION' | 'IDENTITY';

const ANALYSIS_PROMPTS: Record<VerificationType, string> = {
  EMAIL: `You are a cybersecurity expert analyzing an email for threats. Check for:
- Phishing indicators (urgency, fear, credential requests)
- Sender spoofing (display name vs actual domain mismatch)
- Suspicious URLs (IP addresses, URL shorteners, lookalike domains)
- BEC fraud patterns (executive impersonation, payment requests)
- Social engineering tactics
- Malicious attachment indicators (.exe, .bat, .scr)
- SPF/DKIM authentication issues (if headers provided)

Return JSON with: { "findings": [{ "severity": "CRITICAL|WARNING|INFO", "category": "phishing|spoofing|bec|malware|social_engineering", "description": "...", "evidence": "exact text that triggered this" }], "confidence": 0.0-1.0, "reasoning": "brief explanation" }`,

  DOCUMENT: `You are a forensic document analyst. Check for:
- Metadata inconsistencies (creation date after modification)
- Author/creator mismatches
- Formatting anomalies suggesting copy-paste from different sources
- Suspicious legal language or unusual clauses
- Template fraud indicators
- Data inconsistencies within the document

Return JSON with: { "findings": [{ "severity": "CRITICAL|WARNING|INFO", "category": "metadata|forgery|template_fraud|inconsistency", "description": "...", "evidence": "exact text" }], "confidence": 0.0-1.0, "reasoning": "..." }`,

  TRANSACTION: `You are a financial fraud analyst. Check for:
- Invoice fraud indicators (round numbers, unusual amounts)
- Bank detail changes (classic BEC pattern)
- Duplicate transaction patterns
- Suspicious payee information
- Tax ID validation issues
- Currency or timing anomalies
- Cryptocurrency payment flags

Return JSON with: { "findings": [{ "severity": "CRITICAL|WARNING|INFO", "category": "invoice_fraud|bec|duplicate|suspicious_payee", "description": "...", "evidence": "..." }], "confidence": 0.0-1.0, "reasoning": "..." }`,

  IDENTITY: `You are an identity verification specialist. Check for:
- Resume timeline impossibilities (overlapping dates, impossible progression)
- Credential anomalies (fake degrees, non-existent institutions)
- Experience inflation (impossible claims for career length)
- Template/boilerplate indicators
- Inconsistencies between claimed skills and described work
- Employment gap patterns that suggest fabrication

Return JSON with: { "findings": [{ "severity": "CRITICAL|WARNING|INFO", "category": "timeline|credentials|inflation|template", "description": "...", "evidence": "..." }], "confidence": 0.0-1.0, "reasoning": "..." }`,
};

/**
 * Call an LLM for verification analysis.
 * Uses OpenAI API (works with gpt-4o-mini for Tier 1, gpt-4o for Tier 3).
 */
export async function callVerificationLLM(
  tier: 1 | 3,
  verificationType: VerificationType,
  content: string,
): Promise<LLMVerificationResult | null> {
  const openaiKey = process.env['OPENAI_API_KEY'];
  if (!openaiKey) return null; // No LLM available

  const model = tier === 1 ? 'gpt-4o-mini' : 'gpt-4o';
  const systemPrompt = ANALYSIS_PROMPTS[verificationType];

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Analyze the following content:\n\n${content.slice(0, 8000)}` },
        ],
        temperature: 0.1,
        max_tokens: 2000,
        response_format: { type: 'json_object' },
      }),
    });

    if (!response.ok) return null;

    const data = await response.json() as {
      choices: Array<{ message: { content: string } }>;
      usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
    };

    const text = data.choices[0]?.message?.content ?? '{}';
    const parsed = JSON.parse(text) as {
      findings?: Array<{ severity: string; category: string; description: string; evidence: string }>;
      confidence?: number;
      reasoning?: string;
    };

    const tokensUsed = data.usage?.total_tokens ?? 0;
    // Approximate cost: gpt-4o-mini ~$0.15/1M input + $0.6/1M output; gpt-4o ~$2.5/1M + $10/1M
    const costPerToken = tier === 1 ? 0.0000004 : 0.000006;
    const costUsd = tokensUsed * costPerToken;

    return {
      findings: (parsed.findings ?? []).map((f, i) => ({
        id: `llm_${verificationType.toLowerCase()}_${i}`,
        severity: (['CRITICAL', 'WARNING', 'INFO'].includes(f.severity) ? f.severity : 'INFO') as 'CRITICAL' | 'WARNING' | 'INFO',
        category: f.category ?? 'unknown',
        description: f.description ?? '',
        evidence: f.evidence ?? '',
        source: `AI_TIER${tier}`,
      })),
      confidence: Math.min(1, Math.max(0, parsed.confidence ?? 0.7)),
      reasoning: parsed.reasoning ?? '',
      tokensUsed,
      costUsd,
      model,
    };
  } catch {
    return null; // LLM call failed — fall back to heuristics
  }
}
