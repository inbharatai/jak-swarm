// Registry
export { ToolRegistry, toolRegistry } from './registry/tool-registry.js';
export type { RegisteredTool, ToolExecutor } from './registry/tool-registry.js';

// Centralized approval policy (Phase 4 — closes "dead requiresApproval" gap)
export {
  DefaultApprovalPolicy,
  defaultApprovalPolicy,
  ToolActionCategory,
} from './registry/approval-policy.js';
export type {
  ApprovalDecision,
  ApprovalPolicyContext,
  AutoApproveCategoryMap,
} from './registry/approval-policy.js';

// Tool installer (Sprint 2 — real subprocess execution with allowlist)
export {
  ToolRequirementDetector,
  DryRunOnlyInstaller,
  TRUSTED_INSTALL_ADAPTERS,
} from './installer/tool-installer.js';
export {
  SandboxedInstaller,
  sandboxedInstaller,
  SANDBOX_ADAPTERS,
  InstallApprovalRequiredError,
  InstallNotAllowedError,
} from './installer/sandboxed-installer.js';
export type {
  SandboxedAdapter,
  InstallSafetyClass,
  SandboxedInstallOptions,
} from './installer/sandboxed-installer.js';
export type {
  ToolRequirement,
  ToolInstallRequest,
  InstallPlan,
  InstallResult,
  ToolInstallerService,
} from './installer/tool-installer.js';

// Browser-operator runtime (real Playwright-backed per-tenant sessions).
// Replaces the prior crash-loud `NotImplementedBrowserOperator` stub.
export {
  PlaywrightBrowserOperator,
  defaultIsUrlAllowed,
  resolveAndCheckHost,
} from './browser-operator/playwright-browser-operator.js';
export type {
  BrowserAuditEmitter,
  PlaywrightBrowserOperatorOptions,
} from './browser-operator/playwright-browser-operator.js';
export {
  ApprovalRequiredError as BrowserApprovalRequiredError,
  SessionAccessError,
} from './browser-operator/types.js';
export type {
  BrowserOperatorService,
  BrowserPlatform,
  BrowserSessionInfo,
  ExecutionResult as BrowserExecutionResult,
  PageObservation,
  ProposedAction,
  ProposedActionKind,
  ProposedActionPreview,
  StartSessionInput,
} from './browser-operator/types.js';

// Per-platform browser adapters (Sprint 1+). Each adapter implements
// the `PlatformAdapter` contract: URL allowlist + login-state
// detection + draft generation + approval-gated manual-handoff
// publish path. Adapters NEVER auto-post in this generation — the
// safest correct behavior is to record the approval + return a
// manualHandoffRequired result for the user to publish themselves.
export { LinkedInBrowserAdapter, linkedInAdapter, redactSensitiveValues } from './browser-operator/linkedin-adapter.js';
export { InstagramBrowserAdapter, instagramAdapter } from './browser-operator/instagram-adapter.js';
export { YouTubeStudioBrowserAdapter, youtubeAdapter } from './browser-operator/youtube-adapter.js';
export { MetaBusinessBrowserAdapter, metaAdapter } from './browser-operator/meta-adapter.js';
export type {
  PlatformAdapter,
  PlatformId,
  PlatformDraft,
  PlatformLoginState,
  PlatformPublishResult,
} from './browser-operator/platform-adapter.js';

// Connector Runtime — unified manifest + status registry on top of the
// existing tool/MCP/integration infrastructure. See packages/tools/src/
// connectors/types.ts for the design rationale.
export {
  connectorRegistry,
  bootstrapConnectorRegistry,
  resolveConnectorsForTask,
  REMOTION_MANIFEST,
  BLENDER_MANIFEST,
} from './connectors/index.js';
export type {
  ConnectorManifest,
  ConnectorStatus,
  ConnectorRuntimeType,
  ConnectorView,
  ConnectorCandidate,
  ConnectorResolveResult,
  ConnectorCredentialField,
  ConnectorRegistry,
  ResolveOptions,
} from './connectors/index.js';
// Re-export RiskLevel so connector consumers don't need a second import
// from @jak-swarm/shared just to type-narrow a manifest.
export { RiskLevel } from '@jak-swarm/shared';

// Tenant-scoped registry
export { TenantToolRegistry, getTenantToolRegistry, clearTenantToolRegistries } from './registry/tenant-tool-registry.js';
export type { TenantToolRegistryOptions } from './registry/tenant-tool-registry.js';

// Email adapter
export type {
  EmailAdapter,
  EmailMessage,
  EmailFilter,
  EmailDraft,
  EmailAttachment,
} from './adapters/email/email.interface.js';
export { UnconfiguredEmailAdapter } from './adapters/unconfigured.js';
export { GmailImapAdapter } from './adapters/email/gmail-imap.adapter.js';

// Calendar adapter
export type {
  CalendarAdapter,
  CalendarEvent,
  CalendarEventFilter,
  CreateEventParams,
  UpdateEventParams,
  AvailabilitySlot,
} from './adapters/calendar/calendar.interface.js';
export { UnconfiguredCalendarAdapter } from './adapters/unconfigured.js';
export { CalDAVCalendarAdapter } from './adapters/calendar/caldav-calendar.adapter.js';

// Adapter factory
export { getEmailAdapter, getCalendarAdapter, getCRMAdapter, getCRMAdapterFromEnv, getSalesforceCRMAdapterForTenant, hasRealAdapters } from './adapters/adapter-factory.js';

// CRM adapter
export type {
  CRMAdapter,
  CRMContact,
  CRMNote,
  CRMDeal,
  ContactFilter,
} from './adapters/crm/crm.interface.js';
export { UnconfiguredCRMAdapter } from './adapters/unconfigured.js';
export { PrismaCRMAdapter } from './adapters/crm/prisma-crm.adapter.js';
export { HubSpotCRMAdapter } from './adapters/crm/hubspot-crm.adapter.js';
export { SalesforceCRMAdapter } from './adapters/crm/salesforce-crm.adapter.js';

// Social media adapters
export type { SocialMediaAdapter, SocialPostInput, SocialPostResult } from './adapters/social/social.interface.js';
export { getSocialAdapter, getTwitterAdapter, getLinkedInAdapter, getRedditAdapter } from './adapters/social/social-factory.js';
export { DraftSocialAdapter } from './adapters/social/draft-social.adapter.js';

// Browser adapter
export type {
  BrowserAdapter,
  BrowserContext,
  NavigateResult,
  ExtractResult,
  FillResult,
  ClickResult,
  BrowserError,
} from './adapters/browser/browser.interface.js';

// Playwright engine (singleton)
export { playwrightEngine } from './adapters/browser/playwright-engine.js';
export type {
  NavigateResult as EngineNavigateResult,
  BrowserErrorResult,
} from './adapters/browser/playwright-engine.js';

// Memory adapter
export type { MemoryAdapter, MemorySetOptions } from './adapters/memory/db-memory.adapter.js';
export {
  InMemoryAdapter,
  DbMemoryAdapter,
  getMemoryAdapter,
  resetMemoryAdapter,
} from './adapters/memory/db-memory.adapter.js';

// Vector memory (semantic search)
export type { EmbeddingService } from './adapters/memory/embedding.service.js';
export { getEmbeddingService, resetEmbeddingService } from './adapters/memory/embedding.service.js';
export type { VectorMemoryAdapter, VectorSearchResult } from './adapters/memory/vector-memory.adapter.js';
export { getVectorMemoryAdapter, resetVectorMemoryAdapter, InMemoryVectorAdapter, PgVectorAdapter } from './adapters/memory/vector-memory.adapter.js';
export { DocumentIngestor, getDocumentIngestor, resetDocumentIngestor } from './adapters/memory/document-ingestor.js';

// MCP Bridge
export {
  toMcpTool,
  fromMcpTool,
  toMcpToolList,
  fromMcpToolList,
} from './mcp/mcp-tool-bridge.js';
export type { McpToolSpec, McpToolAnnotations, McpInputSchema } from './mcp/mcp-tool-bridge.js';

// MCP Client Manager
export { McpClientManager, mcpClientManager } from './mcp/mcp-client.js';
export { MCP_PROVIDERS } from './mcp/mcp-providers.js';

// Tenant-scoped MCP Manager
export { TenantMcpManager, getTenantMcpManager, clearTenantMcpManagers } from './mcp/tenant-mcp-manager.js';
export type { McpProviderDef, McpServerConfig, ProviderCredentialField } from './mcp/mcp-providers.js';

// Built-in tool registration
export { registerBuiltinTools } from './builtin/index.js';

// Sandbox adapters & templates
export type { SandboxAdapter, SandboxInfo, SandboxExecResult, SandboxFileEntry } from './adapters/sandbox/index.js';
export { getTemplate, listTemplates, generatePackageJson, getSandboxAdapter } from './adapters/sandbox/index.js';
export type { ProjectTemplate } from './adapters/sandbox/index.js';

// Auto-register built-in tools on first import
import { registerBuiltinTools as _autoRegister } from './builtin/index.js';
import { toolRegistry as _registry } from './registry/tool-registry.js';

let _initialized = false;
if (!_initialized && _registry.list().length === 0) {
  _autoRegister();
  _initialized = true;
}
