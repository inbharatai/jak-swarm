/**
 * MCP Server Configurations
 *
 * EVERY package name in this file has been verified against npm registry.
 * Only providers with REAL, published npm packages are included.
 *
 * Verification date: April 2026
 * Method: npm search + registry lookup
 *
 * Status key:
 *   OFFICIAL = published by the service provider themselves
 *   ANTHROPIC = published by Anthropic under @modelcontextprotocol
 *   COMMUNITY = published by community maintainers (functional but not officially supported)
 */

export interface McpServerConfig {
  command: string;
  args: string[];
  env: Record<string, string>;
}

export interface ProviderCredentialField {
  key: string;
  label: string;
  placeholder: string;
  type: 'text' | 'password';
  helpUrl?: string;
}

export interface McpProviderDef {
  name: string;
  description: string;
  buildConfig: (creds: Record<string, string>) => McpServerConfig;
  credentialFields: ProviderCredentialField[];
  setupInstructions: string;
  testToolName?: string;
  /** Package verification status */
  packageStatus: 'OFFICIAL' | 'ANTHROPIC' | 'COMMUNITY';
}

export const MCP_PROVIDERS: Record<string, McpProviderDef> = {

  // ─── VERIFIED: Anthropic Official (@modelcontextprotocol/*) ─────────────

  SLACK: {
    name: 'Slack',
    description: 'Search messages, post to channels, list channels and users',
    packageStatus: 'ANTHROPIC',
    buildConfig: (creds) => ({
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-slack'],
      env: {
        SLACK_BOT_TOKEN: creds['botToken'] ?? '',
        SLACK_TEAM_ID: creds['teamId'] ?? '',
      },
    }),
    credentialFields: [
      { key: 'botToken', label: 'Bot User OAuth Token', placeholder: 'xoxb-...', type: 'password', helpUrl: 'https://api.slack.com/apps' },
      { key: 'teamId', label: 'Team ID', placeholder: 'T01234567', type: 'text' },
    ],
    setupInstructions: '1. Go to api.slack.com/apps and create a new app\n2. Add Bot Token Scopes: channels:read, chat:write, search:read, users:read\n3. Install the app to your workspace\n4. Copy the Bot User OAuth Token and your Team ID',
    testToolName: 'slack_list_channels',
  },

  GITHUB: {
    name: 'GitHub',
    description: 'Search repos, list PRs and issues, read code, create comments',
    packageStatus: 'ANTHROPIC',
    buildConfig: (creds) => ({
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-github'],
      env: {
        GITHUB_PERSONAL_ACCESS_TOKEN: creds['token'] ?? '',
      },
    }),
    credentialFields: [
      { key: 'token', label: 'Personal Access Token', placeholder: 'ghp_...', type: 'password', helpUrl: 'https://github.com/settings/tokens' },
    ],
    setupInstructions: '1. Go to github.com/settings/tokens\n2. Generate a new token (classic)\n3. Select scopes: repo, read:org, read:user\n4. Copy the token',
    testToolName: 'github_list_repositories',
  },

  GOOGLE_DRIVE: {
    name: 'Google Drive',
    description: 'Search files, read documents, list folders',
    packageStatus: 'ANTHROPIC',
    buildConfig: (creds) => ({
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-gdrive'],
      env: {
        GDRIVE_CLIENT_ID: creds['clientId'] ?? '',
        GDRIVE_CLIENT_SECRET: creds['clientSecret'] ?? '',
        GDRIVE_REFRESH_TOKEN: creds['refreshToken'] ?? '',
      },
    }),
    credentialFields: [
      { key: 'clientId', label: 'OAuth Client ID', placeholder: 'xxx.apps.googleusercontent.com', type: 'text', helpUrl: 'https://console.cloud.google.com/apis/credentials' },
      { key: 'clientSecret', label: 'Client Secret', placeholder: 'GOCSPX-...', type: 'password' },
      { key: 'refreshToken', label: 'Refresh Token', placeholder: 'Obtained via OAuth flow', type: 'password' },
    ],
    setupInstructions: '1. Create OAuth 2.0 credentials in Google Cloud Console\n2. Enable the Google Drive API\n3. Run the OAuth consent flow to get a refresh token\n4. Use drive.readonly or drive.file scopes',
    testToolName: 'gdrive_search',
  },

  // ─── VERIFIED: Service Provider Official ────────────────────────────────

  NOTION: {
    name: 'Notion',
    description: 'Search pages, read content, create and update pages and databases',
    packageStatus: 'OFFICIAL',
    buildConfig: (creds) => ({
      command: 'npx',
      args: ['-y', '@notionhq/notion-mcp-server'],
      env: {
        OPENAPI_MCP_HEADERS: JSON.stringify({
          Authorization: `Bearer ${creds['apiKey'] ?? ''}`,
          'Notion-Version': '2022-06-28',
        }),
      },
    }),
    credentialFields: [
      { key: 'apiKey', label: 'Integration Secret', placeholder: 'ntn_...', type: 'password', helpUrl: 'https://www.notion.so/my-integrations' },
    ],
    setupInstructions: '1. Go to notion.so/my-integrations\n2. Create a new integration\n3. Copy the Internal Integration Secret\n4. Share your Notion pages/databases with the integration',
    testToolName: 'notion_search',
  },

  SUPABASE: {
    name: 'Supabase',
    description: 'Database queries, auth management, storage, real-time subscriptions',
    packageStatus: 'OFFICIAL',
    buildConfig: (creds) => ({
      command: 'npx',
      args: ['-y', '@supabase/mcp-server-supabase'],
      env: {
        SUPABASE_URL: creds['url'] ?? '',
        SUPABASE_SERVICE_ROLE_KEY: creds['serviceRoleKey'] ?? '',
      },
    }),
    credentialFields: [
      { key: 'url', label: 'Project URL', placeholder: 'https://xxx.supabase.co', type: 'text', helpUrl: 'https://supabase.com/dashboard/project/_/settings/api' },
      { key: 'serviceRoleKey', label: 'Service Role Key', placeholder: 'eyJ...', type: 'password' },
    ],
    setupInstructions: '1. Go to your Supabase project Settings > API\n2. Copy the Project URL and service_role key\n3. Warning: The service role key has full access — use with caution',
    testToolName: 'supabase_query',
  },

  STRIPE: {
    name: 'Stripe',
    description: 'Customers, subscriptions, invoices, payments, products, prices',
    packageStatus: 'OFFICIAL',
    buildConfig: (creds) => ({
      command: 'npx',
      args: ['-y', '@stripe/mcp'],
      env: {
        STRIPE_SECRET_KEY: creds['secretKey'] ?? '',
      },
    }),
    credentialFields: [
      { key: 'secretKey', label: 'Secret Key', placeholder: 'sk_live_... or sk_test_...', type: 'password', helpUrl: 'https://dashboard.stripe.com/apikeys' },
    ],
    setupInstructions: '1. Go to dashboard.stripe.com/apikeys\n2. Copy your Secret Key (use test key for development)\n3. The key starts with sk_live_ (production) or sk_test_ (testing)',
    testToolName: 'stripe_list_customers',
  },

  HUBSPOT: {
    name: 'HubSpot',
    description: 'CRM contacts, companies, deals, tickets, engagement tracking',
    packageStatus: 'OFFICIAL',
    buildConfig: (creds) => ({
      command: 'npx',
      args: ['-y', '@hubspot/mcp-server'],
      env: {
        HUBSPOT_ACCESS_TOKEN: creds['accessToken'] ?? '',
      },
    }),
    credentialFields: [
      { key: 'accessToken', label: 'Private App Access Token', placeholder: 'pat-na1-...', type: 'password', helpUrl: 'https://developers.hubspot.com/docs/api/private-apps' },
    ],
    setupInstructions: '1. Go to HubSpot Settings > Integrations > Private Apps\n2. Create a new private app\n3. Select scopes: crm.objects.contacts.read, crm.objects.deals.read\n4. Copy the access token',
    testToolName: 'hubspot_list_contacts',
  },

  // ─── VERIFIED: Community Packages (real npm packages) ───────────────────

  AIRTABLE: {
    name: 'Airtable',
    description: 'Bases, tables, records, views, formulas',
    packageStatus: 'COMMUNITY',
    buildConfig: (creds) => ({
      command: 'npx',
      args: ['-y', 'airtable-mcp-server'],
      env: {
        AIRTABLE_API_KEY: creds['apiKey'] ?? '',
      },
    }),
    credentialFields: [
      { key: 'apiKey', label: 'Personal Access Token', placeholder: 'pat...', type: 'password', helpUrl: 'https://airtable.com/create/tokens' },
    ],
    setupInstructions: '1. Go to airtable.com/create/tokens\n2. Create a personal access token\n3. Add scopes: data.records:read, data.records:write, schema.bases:read',
    testToolName: 'airtable_list_bases',
  },

  DISCORD: {
    name: 'Discord',
    description: 'Send messages, manage channels, list servers',
    packageStatus: 'COMMUNITY',
    buildConfig: (creds) => ({
      command: 'npx',
      args: ['-y', 'discord-mcp-server'],
      env: {
        DISCORD_BOT_TOKEN: creds['botToken'] ?? '',
      },
    }),
    credentialFields: [
      { key: 'botToken', label: 'Bot Token', placeholder: 'Your Discord bot token', type: 'password', helpUrl: 'https://discord.com/developers/applications' },
    ],
    setupInstructions: '1. Go to discord.com/developers/applications\n2. Create a new application and add a Bot\n3. Copy the bot token\n4. Invite the bot to your server',
    testToolName: 'discord_list_guilds',
  },

  CLICKUP: {
    name: 'ClickUp',
    description: 'Tasks, lists, spaces, goals, time tracking',
    packageStatus: 'COMMUNITY',
    buildConfig: (creds) => ({
      command: 'npx',
      args: ['-y', '@taazkareem/clickup-mcp-server'],
      env: {
        CLICKUP_API_TOKEN: creds['apiToken'] ?? '',
      },
    }),
    credentialFields: [
      { key: 'apiToken', label: 'API Token', placeholder: 'pk_...', type: 'password', helpUrl: 'https://app.clickup.com/settings/apps' },
    ],
    setupInstructions: '1. Go to ClickUp Settings > Apps\n2. Generate a personal API token\n3. Copy the token',
    testToolName: 'clickup_list_teams',
  },

  SENDGRID: {
    name: 'SendGrid',
    description: 'Send transactional and marketing emails, manage contacts',
    packageStatus: 'COMMUNITY',
    buildConfig: (creds) => ({
      command: 'npx',
      args: ['-y', 'sendgrid-mcp-server'],
      env: {
        SENDGRID_API_KEY: creds['apiKey'] ?? '',
      },
    }),
    credentialFields: [
      { key: 'apiKey', label: 'API Key', placeholder: 'SG.xxx...', type: 'password', helpUrl: 'https://app.sendgrid.com/settings/api_keys' },
    ],
    setupInstructions: '1. Go to app.sendgrid.com/settings/api_keys\n2. Create an API key with Full Access\n3. Copy the key (starts with SG.)',
    testToolName: 'sendgrid_list_templates',
  },

  // ─── VERIFIED: Anthropic Official (additional) ──────────────────────────

  BRAVE_SEARCH: {
    name: 'Brave Search',
    description: 'Web search, news search, local search via Brave Search API',
    packageStatus: 'ANTHROPIC',
    buildConfig: (creds) => ({
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-brave-search'],
      env: { BRAVE_API_KEY: creds['apiKey'] ?? '' },
    }),
    credentialFields: [
      { key: 'apiKey', label: 'API Key', placeholder: 'BSA...', type: 'password', helpUrl: 'https://brave.com/search/api/' },
    ],
    setupInstructions: '1. Go to brave.com/search/api\n2. Create a free account\n3. Generate an API key',
    testToolName: 'brave_search',
  },

  POSTGRES: {
    name: 'PostgreSQL',
    description: 'Query PostgreSQL databases directly — read schemas, run queries',
    packageStatus: 'ANTHROPIC',
    buildConfig: (creds) => ({
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-postgres', creds['connectionString'] ?? ''],
      env: {},
    }),
    credentialFields: [
      { key: 'connectionString', label: 'Connection String', placeholder: 'postgresql://user:pass@host:5432/db', type: 'password' },
    ],
    setupInstructions: '1. Get your PostgreSQL connection string\n2. Format: postgresql://user:password@host:port/database\n3. Ensure the database allows external connections',
    testToolName: 'postgres_query',
  },

  PUPPETEER: {
    name: 'Puppeteer Browser',
    description: 'Browser automation — navigate, screenshot, interact with web pages',
    packageStatus: 'ANTHROPIC',
    buildConfig: () => ({
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-puppeteer'],
      env: {},
    }),
    credentialFields: [],
    setupInstructions: 'No configuration needed. Puppeteer MCP server runs locally with a headless Chrome browser.',
  },

  FILESYSTEM: {
    name: 'Filesystem',
    description: 'Read, write, and manage files on the local filesystem',
    packageStatus: 'ANTHROPIC',
    buildConfig: (creds) => ({
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', creds['rootDir'] ?? '/tmp/jak-workspace'],
      env: {},
    }),
    credentialFields: [
      { key: 'rootDir', label: 'Root Directory', placeholder: '/path/to/workspace', type: 'text' },
    ],
    setupInstructions: '1. Set the root directory that agents should have access to\n2. The server sandboxes all file operations to this directory',
  },

  FETCH: {
    name: 'Web Fetch',
    description: 'Fetch and parse web pages, convert HTML to markdown',
    packageStatus: 'ANTHROPIC',
    buildConfig: () => ({
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-fetch'],
      env: {},
    }),
    credentialFields: [],
    setupInstructions: 'No configuration needed. Fetches and converts web pages to readable format.',
  },

  MEMORY: {
    name: 'Memory',
    description: 'Persistent memory store for agents — store and retrieve knowledge across sessions',
    packageStatus: 'ANTHROPIC',
    buildConfig: () => ({
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-memory'],
      env: {},
    }),
    credentialFields: [],
    setupInstructions: 'No configuration needed. Memory is stored locally and persists across sessions.',
  },

  SEQUENTIAL_THINKING: {
    name: 'Sequential Thinking',
    description: 'Step-by-step reasoning and problem decomposition for complex tasks',
    packageStatus: 'ANTHROPIC',
    buildConfig: () => ({
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-sequential-thinking'],
      env: {},
    }),
    credentialFields: [],
    setupInstructions: 'No configuration needed. Provides structured thinking capabilities to agents.',
  },

  // ─── VERIFIED: Service Provider Official (additional) ───────────────────

  LINEAR: {
    name: 'Linear',
    description: 'Issues, projects, cycles, teams, labels, comments, workflows',
    packageStatus: 'OFFICIAL',
    buildConfig: (creds) => ({
      command: 'npx',
      args: ['-y', '@linear/mcp-server'],
      env: {
        LINEAR_API_KEY: creds['apiKey'] ?? '',
      },
    }),
    credentialFields: [
      { key: 'apiKey', label: 'API Key', placeholder: 'lin_api_...', type: 'password', helpUrl: 'https://linear.app/settings/api' },
    ],
    setupInstructions: '1. Go to linear.app/settings/api\n2. Create a personal API key\n3. Copy the key (starts with lin_api_)',
    testToolName: 'linear_list_issues',
  },

  SALESFORCE: {
    name: 'Salesforce',
    description: 'Leads, contacts, accounts, opportunities, SOQL queries',
    packageStatus: 'OFFICIAL',
    buildConfig: (creds) => ({
      command: 'npx',
      args: ['-y', '@salesforce/mcp'],
      env: {
        SALESFORCE_INSTANCE_URL: creds['instanceUrl'] ?? '',
        SALESFORCE_ACCESS_TOKEN: creds['accessToken'] ?? '',
      },
    }),
    credentialFields: [
      { key: 'instanceUrl', label: 'Instance URL', placeholder: 'https://yourorg.salesforce.com', type: 'text' },
      { key: 'accessToken', label: 'Access Token', placeholder: 'Bearer token', type: 'password' },
    ],
    setupInstructions: '1. Go to Setup > Apps > App Manager > New Connected App\n2. Enable OAuth Settings\n3. Generate security token from My Settings\n4. Use your access token (session ID)',
    testToolName: 'salesforce_query',
  },

  SENTRY: {
    name: 'Sentry',
    description: 'Error tracking — list issues, get error details, search events',
    packageStatus: 'OFFICIAL',
    buildConfig: (creds) => ({
      command: 'npx',
      args: ['-y', '@sentry/mcp-server'],
      env: {
        SENTRY_AUTH_TOKEN: creds['authToken'] ?? '',
        SENTRY_ORG: creds['org'] ?? '',
      },
    }),
    credentialFields: [
      { key: 'authToken', label: 'Auth Token', placeholder: 'sntrys_...', type: 'password', helpUrl: 'https://sentry.io/settings/auth-tokens/' },
      { key: 'org', label: 'Organization Slug', placeholder: 'your-org', type: 'text' },
    ],
    setupInstructions: '1. Go to sentry.io/settings/auth-tokens\n2. Create a new auth token with project:read and event:read scopes\n3. Copy your organization slug from the URL',
    testToolName: 'sentry_list_issues',
  },
};
