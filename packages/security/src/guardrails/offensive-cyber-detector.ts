/**
 * offensive-cyber-detector — JAK Shield's defensive boundary.
 *
 * JAK Shield is the trust layer for autonomous AI work. It exists to
 * SUPPORT defensive security work (review my repo, find vulnerable
 * deps, scan for exposed secrets, recommend patches) and to BLOCK
 * offensive work (write malware, generate exploits, steal credentials,
 * phish targets, scan systems without authorization).
 *
 * This detector runs BEFORE the LLM sees user input. It pattern-matches
 * the documented offensive vocabulary against the user's task. When it
 * fires HIGH-confidence, the workflow is rejected with a clear safety
 * message and the request is NOT forwarded to any agent or tool.
 *
 * Honest scope:
 *   - This is a heuristic. A determined attacker can rephrase. We pair
 *     it with the existing injection detector + approval gates + tenant
 *     tool allowlist + sandboxed execution. No single layer is the
 *     whole defence.
 *   - Defensive vocabulary (audit, review, scan with permission, patch,
 *     CVE, harden, secure) explicitly does NOT trigger. The detector
 *     down-weights HIGH severity when defensive markers are present in
 *     the same request.
 *   - The detector returns a structured result. Callers decide whether
 *     to throw / log / down-rank confidence. The reference caller is
 *     `BaseAgent.executeWithTools` — pre-LLM gate.
 */

interface OffensivePattern {
  pattern: RegExp;
  /** What attack vocabulary this matches. Surfaced in audit logs. */
  category:
    | 'malware-creation'
    | 'exploit-generation'
    | 'credential-theft'
    | 'unauthorized-scanning'
    | 'phishing-content'
    | 'jailbreak-payload';
  /** Severity if matched without a defensive marker. */
  baseSeverity: 'HIGH' | 'MEDIUM';
  /** Plain-English description for the user-facing error. */
  description: string;
}

/**
 * Defensive-vocabulary markers that shift a borderline request from
 * blocked → allowed. "Review my repo for vulnerabilities" is fine;
 * "write me an exploit for $cve" is not, regardless of phrasing.
 */
const DEFENSIVE_MARKERS = [
  /\b(audit|review|scan)\s+(my|our|the)\s+(repo|codebase|code|repository|project|app)\b/i,
  /\b(find|detect|surface)\s+(vulnerab|cve|exposure|secret|leak)/i,
  /\b(harden|secure|patch|fix|mitigate|remediate)\b/i,
  /\b(security|defens(ive|e))\s+(review|audit|posture|baseline)\b/i,
  /\bdependency\s+(audit|review|check|scan)\b/i,
  /\b(secret|credential|token|key)\s+(scan|leak|expos|detect)/i,
  /\bsoftware\s+composition\s+analysis\b/i,
  // Each defensive-tool acronym must be its own anchored alternation —
  // an unanchored `SCA` matched the "sca" inside "obfu**sca**te" and
  // "**sca**n", causing false-positive softening on real attacks.
  /\b(SAST|DAST|SCA|SBOM|OWASP)\b/i,
  /\b(generate|write|create)\s+(a\s+)?(test|unit|integration)\b/i,
  /\bpenetration\s+test(ing)?\b.*\b(authorized|approved|own|my)\b/i,
];

const PATTERNS: OffensivePattern[] = [
  // ── Malware creation ─────────────────────────────────────────────
  {
    // Allow an optional adjective between the article and the malware
    // noun — "Build a Linux rootkit", "Create a stealthy keylogger".
    pattern: /\b(write|generate|create|build|develop)\s+(a\s+)?(\w+\s+)?(virus|malware|ransomware|worm|trojan|rootkit|keylogger|spyware|backdoor)\b/i,
    category: 'malware-creation',
    baseSeverity: 'HIGH',
    description: 'request to author malicious software',
  },
  {
    pattern: /\b(payload|shellcode|reverse\s+shell|c2\s+server|command\s+(and|&)\s+control)\b/i,
    category: 'malware-creation',
    baseSeverity: 'HIGH',
    description: 'request involves attack-payload primitives',
  },
  {
    pattern: /\b(obfuscate|pack|crypt)\s+(my\s+)?(payload|malware|stub|loader)\b/i,
    category: 'malware-creation',
    baseSeverity: 'HIGH',
    description: 'request to evade malware detection',
  },

  // ── Exploit generation ────────────────────────────────────────────
  {
    pattern: /\b(write|generate|develop|build)\s+(an?\s+)?(exploit|0[\s-]?day|zero[\s-]?day)\b/i,
    category: 'exploit-generation',
    baseSeverity: 'HIGH',
    description: 'request to author an exploit',
  },
  {
    pattern: /\b(weaponize|weaponise)\b/i,
    category: 'exploit-generation',
    baseSeverity: 'HIGH',
    description: 'request to weaponize a vulnerability',
  },
  {
    pattern: /\b(rop\s+chain|gadget\s+chain|heap\s+spray|use[\s-]after[\s-]free\s+exploit)\b/i,
    category: 'exploit-generation',
    baseSeverity: 'HIGH',
    description: 'request involves exploit-development primitives',
  },

  // ── Credential theft ──────────────────────────────────────────────
  {
    pattern: /\b(steal|exfiltrate|harvest|grab|dump)\s+(passwords?|credentials?|tokens?|cookies?|sessions?|hashes?)\b/i,
    category: 'credential-theft',
    baseSeverity: 'HIGH',
    description: 'request to take credentials without authorization',
  },
  {
    // Allow optional articles ("crack this hash", "brute-force the login")
    // and let "form" follow login.
    pattern: /\b(crack|brute[\s-]?force|dictionary[\s-]?attack)\s+(this\s+|that\s+|the\s+|my\s+|our\s+|a\s+)?(password|hash|account|login|form)/i,
    category: 'credential-theft',
    baseSeverity: 'HIGH',
    description: 'request to crack credentials',
  },
  {
    // LSASS-related cred-theft vocabulary: "lsass dump", "lsass memory",
    // "dump lsass", "extract lsass".
    pattern: /\b(mimikatz|lsass(\s+(dump|memory|extract|read))?|(dump|extract|read)\s+lsass|kerberoast(ing)?|pass[\s-]the[\s-]hash|ntds\.dit)\b/i,
    category: 'credential-theft',
    baseSeverity: 'HIGH',
    description: 'request involves named credential-theft tools',
  },

  // ── Unauthorized scanning ────────────────────────────────────────
  {
    // Match "without authorization", "without permission", "without consent",
    // "no consent" — `authoriz` matches "authorization" / "authorized" /
    // "authorize" because we drop the trailing word boundary (the suffix
    // is unconstrained).
    pattern: /\b(scan|enumerate|recon|reconnaissance)\s+(targets?|hosts?|ports?|networks?|subdomains?)\s+(without|with\s+no)\s+(consent|authoriz|permission)/i,
    category: 'unauthorized-scanning',
    baseSeverity: 'HIGH',
    description: 'scanning request explicitly without authorization',
  },
  {
    pattern: /\b(nmap|masscan|zmap|subfinder|amass|nuclei)\b.*\b(against|target)\b.*\b(?!my|our|own)\b/i,
    category: 'unauthorized-scanning',
    baseSeverity: 'MEDIUM',
    description: 'named scanner against unspecified-ownership target',
  },

  // ── Phishing ──────────────────────────────────────────────────────
  {
    pattern: /\b(write|craft|generate)\s+(a\s+)?phishing\s+(email|message|page|kit|template)\b/i,
    category: 'phishing-content',
    baseSeverity: 'HIGH',
    description: 'request to author phishing content',
  },
  {
    pattern: /\b(impersonate|spoof)\s+(microsoft|google|apple|amazon|bank|paypal|admin|it\s+support)\b/i,
    category: 'phishing-content',
    baseSeverity: 'HIGH',
    description: 'request to impersonate a trusted brand',
  },
  {
    // Allow a brand or descriptor between "the" and the login noun —
    // "Clone the Microsoft sign-in page", "Copy the Google login page".
    pattern: /\b(clone|copy)\s+(the\s+)?(\w+\s+)?(login|sign[\s-]in|signin|log[\s-]in)\s+page\b/i,
    category: 'phishing-content',
    baseSeverity: 'HIGH',
    description: 'request to clone a login page',
  },

  // ── Jailbreak payload (overlap with injection detector — kept
  //   here for category-aware audit logs) ─────────────────────────
  {
    pattern: /\b(do\s+anything\s+now|DAN\s+mode|developer\s+mode|jailbroken)\b/i,
    category: 'jailbreak-payload',
    baseSeverity: 'HIGH',
    description: 'jailbreak payload',
  },
];

export interface OffensiveDetectionResult {
  detected: boolean;
  category: OffensivePattern['category'] | null;
  /** Plain-English reason — safe to surface to the user. */
  reason: string | null;
  confidence: number;
  /** Defensive markers found in the same request — used to soften. */
  defensiveMarkers: number;
  /** Match snippet (truncated) — for audit logs only. NOT shown to user. */
  matchedFragment?: string;
}

/**
 * Run the detector on a piece of user input. Returns a structured
 * decision. The default threshold for blocking is confidence >= 0.7
 * AND no defensive marker present.
 *
 * Block decisions emit `JAK_SHIELD_BLOCKED` audit events at the caller.
 */
export function detectOffensiveCyberRequest(text: string): OffensiveDetectionResult {
  if (typeof text !== 'string' || text.length === 0) {
    return { detected: false, category: null, reason: null, confidence: 0, defensiveMarkers: 0 };
  }
  const MAX_SCAN = 50_000;
  const scan = text.length > MAX_SCAN ? text.slice(0, MAX_SCAN) : text;

  // Count defensive markers — they soften confidence.
  let defensiveCount = 0;
  for (const m of DEFENSIVE_MARKERS) if (m.test(scan)) defensiveCount++;

  // Find the highest-severity match.
  let topMatch: OffensivePattern | null = null;
  let matchedSnippet = '';
  for (const p of PATTERNS) {
    const m = scan.match(p.pattern);
    if (m) {
      const start = Math.max(0, (m.index ?? 0) - 20);
      matchedSnippet = scan.slice(start, start + 140);
      if (
        topMatch === null ||
        (p.baseSeverity === 'HIGH' && topMatch.baseSeverity !== 'HIGH')
      ) {
        topMatch = p;
        if (p.baseSeverity === 'HIGH') break; // first HIGH wins
      }
    }
  }
  if (!topMatch) {
    return { detected: false, category: null, reason: null, confidence: 0, defensiveMarkers: defensiveCount };
  }

  // Base confidence + defensive softening.
  const base = topMatch.baseSeverity === 'HIGH' ? 0.9 : 0.6;
  const softened = Math.max(0, base - defensiveCount * 0.25);

  return {
    detected: softened >= 0.5,
    category: topMatch.category,
    reason: topMatch.description,
    confidence: softened,
    defensiveMarkers: defensiveCount,
    matchedFragment: matchedSnippet,
  };
}

/**
 * Cheap boolean wrapper. The caller decides what threshold is "block".
 * Default threshold: confidence >= 0.7 with zero defensive markers.
 */
export function isOffensiveCyberRequest(text: string, threshold = 0.7): boolean {
  const r = detectOffensiveCyberRequest(text);
  return r.detected && r.confidence >= threshold;
}
