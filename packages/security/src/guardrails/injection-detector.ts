export interface InjectionDetectionResult {
  detected: boolean;
  patterns: string[];
  risk: 'LOW' | 'HIGH';
  confidence: number;
}

interface InjectionPattern {
  pattern: RegExp;
  risk: 'LOW' | 'HIGH';
  description: string;
  forBrowserContent?: boolean;
}

// Standard injection patterns
const STANDARD_PATTERNS: InjectionPattern[] = [
  {
    pattern: /ignore\s+(all\s+)?previous\s+instructions/i,
    risk: 'HIGH',
    description: 'Ignore previous instructions',
  },
  {
    pattern: /ignore\s+(all\s+)?your\s+(system\s+)?prompt/i,
    risk: 'HIGH',
    description: 'Ignore system prompt',
  },
  {
    pattern: /you\s+are\s+now\s+(a\s+)?(\w+\s+)?(assistant|bot|ai|model|gpt|claude)/i,
    risk: 'HIGH',
    description: 'Identity override attempt',
  },
  {
    pattern: /new\s+instructions:\s*\n/i,
    risk: 'HIGH',
    description: 'New instructions injection',
  },
  {
    pattern: /^SYSTEM:\s/m,
    risk: 'HIGH',
    description: 'System role injection (line start)',
  },
  {
    pattern: /```\s*system/i,
    risk: 'HIGH',
    description: 'Code block system injection',
  },
  {
    pattern: /act\s+as\s+(a\s+)?(?:different|new|unrestricted|unfiltered|uncensored|free|evil|jailbroken)/i,
    risk: 'HIGH',
    description: 'Act as unrestricted AI',
  },
  {
    pattern: /pretend\s+(you\s+are|to\s+be)\s+(an?\s+)?(unrestricted|uncensored|free|evil|unethical)/i,
    risk: 'HIGH',
    description: 'Pretend to be unconstrained',
  },
  {
    pattern: /disregard\s+(all\s+)?(?:previous|your|the\s+above)\s+(?:instructions|rules|guidelines|constraints)/i,
    risk: 'HIGH',
    description: 'Disregard instructions',
  },
  {
    pattern: /forget\s+everything\s+(?:you\s+know|i\s+said|i\s+told\s+you|above)/i,
    risk: 'HIGH',
    description: 'Forget prior context',
  },
  {
    pattern: /\bDAN\s+mode\b|\byou\s+are\s+now\s+DAN\b|\bact\s+as\s+DAN\b/i,
    risk: 'HIGH',
    description: 'DAN jailbreak pattern',
  },
  {
    pattern: /jailbreak/i,
    risk: 'HIGH',
    description: 'Explicit jailbreak mention',
  },
  {
    pattern: /<\|system\|>/i,
    risk: 'HIGH',
    description: 'System token injection',
  },
  {
    pattern: /override\s+(safety|policy|restriction|rule|filter|guardrail)/i,
    risk: 'HIGH',
    description: 'Override safety policy',
  },
  {
    pattern: /bypass\s+(safety|policy|restriction|rule|filter|guardrail)/i,
    risk: 'HIGH',
    description: 'Bypass guardrails',
  },
  {
    pattern: /\[\[.*?\]\]/s,
    risk: 'LOW',
    description: 'Suspicious double bracket syntax',
  },
  {
    pattern: /<<SYS>>/i,
    risk: 'HIGH',
    description: 'LLaMA system tag injection',
  },
  {
    pattern: /\[INST\]/i,
    risk: 'HIGH',
    description: 'LLaMA instruction tag injection',
  },
  {
    pattern: /<\|im_start\|>/i,
    risk: 'HIGH',
    description: 'ChatML start token injection',
  },
  {
    pattern: /translate\s+the\s+following\s+.*\s+to\s+\w+\s+then\s+(?:output|return|say|print)\s+your\s+(?:system\s+)?prompt/i,
    risk: 'HIGH',
    description: 'Indirect prompt extraction via translation',
  },
  {
    pattern: /what\s+(?:are|is)\s+your\s+(?:original|initial|actual|real|full|complete|entire)\s+(?:instructions|prompt|system\s+prompt|directives)/i,
    risk: 'HIGH',
    description: 'System prompt extraction attempt',
  },
  {
    pattern: /in\s+base64,?\s+(?:encoded?|decode?)[:\s]/i,
    risk: 'LOW',
    description: 'Base64 encoding obfuscation',
  },
  {
    pattern: /\bdo\s+anything\s+now\b/i,
    risk: 'HIGH',
    description: 'DAN variant (do anything now)',
  },
];

// Additional patterns for browser-scraped content (more aggressive detection)
const BROWSER_CONTENT_PATTERNS: InjectionPattern[] = [
  ...STANDARD_PATTERNS,
  {
    pattern: /<!--.*?inject.*?-->/is,
    risk: 'HIGH',
    description: 'HTML comment injection',
    forBrowserContent: true,
  },
  {
    pattern: /<script[^>]*>[\s\S]*?<\/script>/gi,
    risk: 'HIGH',
    description: 'Script tag in scraped content',
    forBrowserContent: true,
  },
  {
    pattern: /\bon\w+\s*=\s*["'][^"']*["']/i,
    risk: 'HIGH',
    description: 'Event handler in scraped content',
    forBrowserContent: true,
  },
  {
    pattern: /display:\s*none|visibility:\s*hidden/i,
    risk: 'LOW',
    description: 'Hidden text (potential invisible injection)',
    forBrowserContent: true,
  },
  {
    pattern: /font-size:\s*0|color:\s*(?:white|#fff|#ffffff)\s*;.*background.*white/i,
    risk: 'LOW',
    description: 'White-on-white hidden text pattern',
    forBrowserContent: true,
  },
];

export function detectInjection(
  text: string,
  isBrowserContent = false,
): InjectionDetectionResult {
  const patterns = isBrowserContent ? BROWSER_CONTENT_PATTERNS : STANDARD_PATTERNS;
  const matchedPatterns: string[] = [];
  let highRisk = false;
  let matchCount = 0;

  for (const { pattern, risk, description } of patterns) {
    // Clone pattern to reset lastIndex
    const testPattern = new RegExp(pattern.source, pattern.flags);
    if (testPattern.test(text)) {
      matchedPatterns.push(description);
      matchCount++;
      if (risk === 'HIGH') highRisk = true;
    }
  }

  const detected = matchedPatterns.length > 0;
  const confidence = detected
    ? Math.min(0.5 + matchCount * 0.15 + (highRisk ? 0.3 : 0), 1.0)
    : 0;

  return {
    detected,
    patterns: matchedPatterns,
    risk: highRisk ? 'HIGH' : 'LOW',
    confidence,
  };
}

export function isInjectionAttempt(text: string, isBrowserContent = false): boolean {
  return detectInjection(text, isBrowserContent).detected;
}
