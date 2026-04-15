const OWNER_EMAIL = (process.env['PROVIDER_VISIBILITY_OWNER_EMAIL'] ?? 'reetu004@gmail.com')
  .trim()
  .toLowerCase();

export function canRevealProviderIdentity(email?: string | null): boolean {
  if (!email) return false;
  return email.trim().toLowerCase() === OWNER_EMAIL;
}

export function anonymizeProviderName(index: number): string {
  return `managed_provider_${index + 1}`;
}

export function redactProviderCosts(
  byProvider: Record<string, number>,
  allowIdentity: boolean,
): Record<string, number> {
  if (allowIdentity) return byProvider;

  const total = Object.values(byProvider).reduce((sum, value) => sum + value, 0);
  return { managed_ai: total };
}

export function redactModelCosts(
  byModel: Record<string, { tokens: number; costUsd: number; calls: number }>,
  allowIdentity: boolean,
): Record<string, { tokens: number; costUsd: number; calls: number }> {
  if (allowIdentity) return byModel;

  const aggregate = Object.values(byModel).reduce(
    (acc, value) => {
      acc.tokens += value.tokens;
      acc.costUsd += value.costUsd;
      acc.calls += value.calls;
      return acc;
    },
    { tokens: 0, costUsd: 0, calls: 0 },
  );

  return { managed_model: aggregate };
}