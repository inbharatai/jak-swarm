export enum PIIType {
  EMAIL = 'EMAIL',
  PHONE = 'PHONE',
  SSN = 'SSN',
  CREDIT_CARD = 'CREDIT_CARD',
  DATE_OF_BIRTH = 'DATE_OF_BIRTH',
  MEDICAL_RECORD_NUMBER = 'MEDICAL_RECORD_NUMBER',
  PASSPORT = 'PASSPORT',
  IP_ADDRESS = 'IP_ADDRESS',
  BANK_ACCOUNT = 'BANK_ACCOUNT',
  DRIVER_LICENSE = 'DRIVER_LICENSE',
}

export interface PIIMatch {
  type: PIIType;
  value: string;
  startIndex: number;
  endIndex: number;
}

export interface PIIDetectionResult {
  found: PIIType[];
  matches: PIIMatch[];
  redacted: string;
  containsPII: boolean;
}

interface PIIPattern {
  type: PIIType;
  pattern: RegExp;
  redactedLabel: string;
}

const PII_PATTERNS: PIIPattern[] = [
  {
    type: PIIType.EMAIL,
    pattern: /\b[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}\b/g,
    redactedLabel: '[REDACTED-EMAIL]',
  },
  {
    type: PIIType.SSN,
    // Matches ###-##-#### or ######### (9 digits)
    pattern: /\b\d{3}[-\s]?\d{2}[-\s]?\d{4}\b/g,
    redactedLabel: '[REDACTED-SSN]',
  },
  {
    type: PIIType.CREDIT_CARD,
    // Visa, Mastercard, Amex, Discover (with optional spaces/dashes)
    pattern:
      /\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13}|3(?:0[0-5]|[68][0-9])[0-9]{11}|6(?:011|5[0-9]{2})[0-9]{12}|(?:\d{4}[-\s]?){3}\d{4})\b/g,
    redactedLabel: '[REDACTED-CC]',
  },
  {
    type: PIIType.PHONE,
    // US and international formats
    pattern:
      /(\+?1[\s\-.]?)?\(?\d{3}\)?[\s\-.]?\d{3}[\s\-.]?\d{4}\b|\+\d{1,3}[\s\-.]?\d{2,4}[\s\-.]?\d{4,}/g,
    redactedLabel: '[REDACTED-PHONE]',
  },
  {
    type: PIIType.DATE_OF_BIRTH,
    // MM/DD/YYYY or YYYY-MM-DD (birth dates, not arbitrary dates)
    pattern:
      /\b(?:DOB|Date of Birth|Birth Date|Born)[:\s]+(?:\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}|\d{4}[\/\-\.]\d{1,2}[\/\-\.]\d{1,2})\b/gi,
    redactedLabel: '[REDACTED-DOB]',
  },
  {
    type: PIIType.MEDICAL_RECORD_NUMBER,
    pattern: /\b(?:MRN|Medical Record)[#:\s]+\s*\d{6,10}\b/gi,
    redactedLabel: '[REDACTED-MRN]',
  },
  {
    type: PIIType.PASSPORT,
    // US and common international passport formats
    pattern: /\b(?:Passport[#:\s]+)?[A-Z]{1,2}\d{6,9}\b/g,
    redactedLabel: '[REDACTED-PASSPORT]',
  },
  {
    type: PIIType.IP_ADDRESS,
    // IPv4 addresses
    pattern:
      /\b(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\b/g,
    redactedLabel: '[REDACTED-IP]',
  },
  {
    type: PIIType.BANK_ACCOUNT,
    pattern: /\b(?:Account|Acct|Routing)[\s#:]+\d{7,17}\b/gi,
    redactedLabel: '[REDACTED-BANK-ACCT]',
  },
  {
    type: PIIType.DRIVER_LICENSE,
    pattern: /\b(?:DL|Driver['\s]?s?\s+License)[#:\s]+[A-Z0-9]{5,15}\b/gi,
    redactedLabel: '[REDACTED-DL]',
  },
];

export function detectPII(text: string): PIIDetectionResult {
  const matches: PIIMatch[] = [];
  const foundTypes = new Set<PIIType>();
  let redacted = text;

  for (const { type, pattern, redactedLabel } of PII_PATTERNS) {
    // Reset lastIndex for global patterns
    pattern.lastIndex = 0;

    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      matches.push({
        type,
        value: match[0],
        startIndex: match.index,
        endIndex: match.index + match[0].length,
      });
      foundTypes.add(type);
    }

    // Perform redaction
    pattern.lastIndex = 0;
    redacted = redacted.replace(pattern, redactedLabel);
  }

  return {
    found: [...foundTypes],
    matches,
    redacted,
    containsPII: foundTypes.size > 0,
  };
}

export function containsPII(text: string): boolean {
  return detectPII(text).containsPII;
}

export function redactPII(text: string): string {
  return detectPII(text).redacted;
}

/**
 * Checks specifically for HIPAA-sensitive PHI identifiers (all 18 safe harbor categories).
 */
export function containsPHI(text: string): boolean {
  const result = detectPII(text);

  // PHI-specific types that require HIPAA protection
  const phiTypes: PIIType[] = [
    PIIType.SSN,
    PIIType.MEDICAL_RECORD_NUMBER,
    PIIType.PHONE,
    PIIType.EMAIL,
    PIIType.DATE_OF_BIRTH,
    PIIType.IP_ADDRESS,
  ];

  return result.found.some((t) => phiTypes.includes(t));
}
