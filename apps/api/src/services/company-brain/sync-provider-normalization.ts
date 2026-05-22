export const COMPANY_SYNC_PROVIDERS = ['GITHUB', 'GMAIL', 'GOOGLE_DRIVE'] as const;

export type CompanySyncProvider = typeof COMPANY_SYNC_PROVIDERS[number];

const COMPANY_SYNC_PROVIDER_SET = new Set<string>(COMPANY_SYNC_PROVIDERS);

// MCP provider registry currently keys Google Drive as GOOGLE_DRIVE while
// dashboard/provider surfaces historically used DRIVE. Keep aliases here so
// route and sync logic stay consistent.
export function normalizeMcpProviderKey(provider: string): string {
  const upper = provider.trim().toUpperCase();
  if (upper === 'DRIVE') return 'GOOGLE_DRIVE';
  return upper;
}

export function normalizeCompanySyncProvider(provider: string): CompanySyncProvider | null {
  const canonical = normalizeMcpProviderKey(provider);
  if (!COMPANY_SYNC_PROVIDER_SET.has(canonical)) return null;
  return canonical as CompanySyncProvider;
}

export function getIntegrationProviderAliases(provider: CompanySyncProvider): string[] {
  if (provider === 'GOOGLE_DRIVE') {
    return ['GOOGLE_DRIVE', 'DRIVE'];
  }
  return [provider];
}

export function companySyncProviderToArtifactSource(provider: CompanySyncProvider): 'github' | 'gmail' | 'google_drive' {
  if (provider === 'GOOGLE_DRIVE') return 'google_drive';
  if (provider === 'GITHUB') return 'github';
  return 'gmail';
}
