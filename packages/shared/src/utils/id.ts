/**
 * Generates a unique ID using crypto.randomUUID() with an optional prefix.
 * @example generateId('wf_')  // "wf_550e8400-e29b-41d4-a716-446655440000"
 * @example generateId()       // "550e8400-e29b-41d4-a716-446655440000"
 */
export function generateId(prefix?: string): string {
  const uuid = crypto.randomUUID();
  return prefix ? `${prefix}${uuid}` : uuid;
}

/**
 * Generates a trace ID with a timestamp and random suffix for log correlation.
 * @example "trc_1704067200000_a3f9b2c"
 */
export function generateTraceId(): string {
  return `trc_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}
