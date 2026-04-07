/**
 * Runtime input validation for agent execute() methods.
 *
 * Replaces unsafe `as` casts with actual validation.
 * Returns the validated input or throws a descriptive error.
 */

export function validateAgentInput<T>(
  input: unknown,
  requiredFields: string[],
  agentName: string,
): T {
  if (input === null || input === undefined) {
    throw new Error(`${agentName}: received null/undefined input`);
  }

  if (typeof input !== 'object') {
    throw new Error(`${agentName}: expected object input, got ${typeof input}`);
  }

  const obj = input as Record<string, unknown>;

  for (const field of requiredFields) {
    if (!(field in obj) || obj[field] === undefined || obj[field] === null) {
      throw new Error(`${agentName}: missing required field '${field}'. Got keys: ${Object.keys(obj).join(', ')}`);
    }
  }

  return input as T;
}

/**
 * Safely extract a string field with fallback.
 */
export function getString(obj: Record<string, unknown>, key: string, fallback: string = ''): string {
  const val = obj[key];
  if (typeof val === 'string') return val;
  if (val === undefined || val === null) return fallback;
  return String(val);
}

/**
 * Safely extract an array field with fallback.
 */
export function getArray<T>(obj: Record<string, unknown>, key: string): T[] {
  const val = obj[key];
  if (Array.isArray(val)) return val as T[];
  return [];
}
