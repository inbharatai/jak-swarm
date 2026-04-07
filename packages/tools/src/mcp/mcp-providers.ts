/**
 * MCP server configurations for each supported provider.
 * Each provider defines how to spawn its MCP server process and what credentials are needed.
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
  testToolName?: string; // Tool to call for connection test
}

export const MCP_PROVIDERS: Record<string, McpProviderDef> = {
  SLACK: {
    name: 'Slack',
    description: 'Search messages, post to channels, list channels and users',
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

  NOTION: {
    name: 'Notion',
    description: 'Search pages, read content, create and update pages and databases',
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
    setupInstructions: '1. Go to notion.so/my-integrations\n2. Create a new integration\n3. Copy the Internal Integration Secret\n4. Share your Notion pages/databases with the integration (click Share -> Invite -> your integration name)',
    testToolName: 'notion_search',
  },

  // ─── CRM Providers ─────────────────────────────────────────────────────────

  HUBSPOT: {
    name: 'HubSpot',
    description: 'CRM contacts, companies, deals, tickets, engagement tracking, pipeline management',
    buildConfig: (creds) => ({
      command: 'npx',
      args: ['-y', '@anthropic/hubspot-mcp-server'],
      env: {
        HUBSPOT_ACCESS_TOKEN: creds['accessToken'] ?? '',
      },
    }),
    credentialFields: [
      { key: 'accessToken', label: 'Private App Access Token', placeholder: 'pat-na1-...', type: 'password', helpUrl: 'https://developers.hubspot.com/docs/api/private-apps' },
    ],
    setupInstructions: '1. Go to HubSpot Settings > Integrations > Private Apps\n2. Create a new private app\n3. Select scopes: crm.objects.contacts.read, crm.objects.contacts.write, crm.objects.deals.read, crm.objects.companies.read\n4. Copy the access token',
    testToolName: 'hubspot_list_contacts',
  },

  SALESFORCE: {
    name: 'Salesforce',
    description: 'Leads, contacts, accounts, opportunities, cases, SOQL queries, reports',
    buildConfig: (creds) => ({
      command: 'npx',
      args: ['-y', '@anthropic/salesforce-mcp-server'],
      env: {
        SALESFORCE_INSTANCE_URL: creds['instanceUrl'] ?? '',
        SALESFORCE_ACCESS_TOKEN: creds['accessToken'] ?? '',
      },
    }),
    credentialFields: [
      { key: 'instanceUrl', label: 'Instance URL', placeholder: 'https://yourorg.salesforce.com', type: 'text', helpUrl: 'https://help.salesforce.com/s/articleView?id=sf.user_security_token.htm' },
      { key: 'accessToken', label: 'Access Token', placeholder: 'Bearer token or session ID', type: 'password' },
    ],
    setupInstructions: '1. Go to Setup > Apps > App Manager > New Connected App\n2. Enable OAuth Settings with scopes: api, refresh_token\n3. Generate a security token from My Settings > Personal > Reset Security Token\n4. Use your access token (session ID) or OAuth flow',
    testToolName: 'salesforce_query',
  },

  PIPEDRIVE: {
    name: 'Pipedrive',
    description: 'Deals, persons, organizations, activities, pipelines, lead management',
    buildConfig: (creds) => ({
      command: 'npx',
      args: ['-y', 'pipedrive-mcp-server'],
      env: {
        PIPEDRIVE_API_TOKEN: creds['apiToken'] ?? '',
        PIPEDRIVE_DOMAIN: creds['domain'] ?? '',
      },
    }),
    credentialFields: [
      { key: 'apiToken', label: 'API Token', placeholder: 'Your Pipedrive API token', type: 'password', helpUrl: 'https://pipedrive.readme.io/docs/how-to-find-the-api-token' },
      { key: 'domain', label: 'Company Domain', placeholder: 'yourcompany', type: 'text' },
    ],
    setupInstructions: '1. Go to Settings > Personal Preferences > API\n2. Copy your personal API token\n3. Your domain is the subdomain of your Pipedrive URL (e.g., "yourcompany" from yourcompany.pipedrive.com)',
    testToolName: 'pipedrive_list_deals',
  },

  ZOHO_CRM: {
    name: 'Zoho CRM',
    description: 'Leads, contacts, accounts, deals, tasks, custom modules, analytics',
    buildConfig: (creds) => ({
      command: 'npx',
      args: ['-y', 'zoho-crm-mcp-server'],
      env: {
        ZOHO_CLIENT_ID: creds['clientId'] ?? '',
        ZOHO_CLIENT_SECRET: creds['clientSecret'] ?? '',
        ZOHO_REFRESH_TOKEN: creds['refreshToken'] ?? '',
        ZOHO_DOMAIN: creds['domain'] ?? 'https://www.zohoapis.com',
      },
    }),
    credentialFields: [
      { key: 'clientId', label: 'Client ID', placeholder: '1000.XXXX...', type: 'text', helpUrl: 'https://api-console.zoho.com/' },
      { key: 'clientSecret', label: 'Client Secret', placeholder: 'Your client secret', type: 'password' },
      { key: 'refreshToken', label: 'Refresh Token', placeholder: '1000.XXXX...', type: 'password' },
      { key: 'domain', label: 'API Domain', placeholder: 'https://www.zohoapis.com', type: 'text' },
    ],
    setupInstructions: '1. Go to api-console.zoho.com and create a Self Client\n2. Generate a grant token with scopes: ZohoCRM.modules.ALL, ZohoCRM.settings.ALL\n3. Exchange the grant token for a refresh token\n4. Copy Client ID, Client Secret, and Refresh Token',
    testToolName: 'zoho_list_leads',
  },

  FRESHSALES: {
    name: 'Freshsales',
    description: 'Leads, contacts, accounts, deals, tasks, appointments, sales sequences',
    buildConfig: (creds) => ({
      command: 'npx',
      args: ['-y', 'freshsales-mcp-server'],
      env: {
        FRESHSALES_API_KEY: creds['apiKey'] ?? '',
        FRESHSALES_DOMAIN: creds['domain'] ?? '',
      },
    }),
    credentialFields: [
      { key: 'apiKey', label: 'API Key', placeholder: 'Your Freshsales API key', type: 'password', helpUrl: 'https://support.freshsales.io/en/support/solutions/articles/220099-how-to-find-my-api-key' },
      { key: 'domain', label: 'Domain', placeholder: 'yourcompany.freshsales.io', type: 'text' },
    ],
    setupInstructions: '1. Go to Settings > API Settings in Freshsales\n2. Copy your API Key\n3. Your domain is your Freshsales URL (e.g., yourcompany.freshsales.io)',
    testToolName: 'freshsales_list_contacts',
  },

  // ─── Additional Popular Providers ───────────────────────────────────────────

  JIRA: {
    name: 'Jira',
    description: 'Issues, projects, boards, sprints, epics, JQL queries, comments',
    buildConfig: (creds) => ({
      command: 'npx',
      args: ['-y', '@anthropic/jira-mcp-server'],
      env: {
        JIRA_URL: creds['url'] ?? '',
        JIRA_EMAIL: creds['email'] ?? '',
        JIRA_API_TOKEN: creds['apiToken'] ?? '',
      },
    }),
    credentialFields: [
      { key: 'url', label: 'Jira URL', placeholder: 'https://yourorg.atlassian.net', type: 'text', helpUrl: 'https://id.atlassian.com/manage-profile/security/api-tokens' },
      { key: 'email', label: 'Email', placeholder: 'you@company.com', type: 'text' },
      { key: 'apiToken', label: 'API Token', placeholder: 'Your Jira API token', type: 'password' },
    ],
    setupInstructions: '1. Go to id.atlassian.com/manage-profile/security/api-tokens\n2. Create an API token\n3. Use your Jira URL (e.g., yourorg.atlassian.net) and the email associated with your account',
    testToolName: 'jira_list_projects',
  },

  LINEAR: {
    name: 'Linear',
    description: 'Issues, projects, cycles, teams, labels, comments, workflows',
    buildConfig: (creds) => ({
      command: 'npx',
      args: ['-y', '@anthropic/linear-mcp-server'],
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

  GOOGLE_DRIVE: {
    name: 'Google Drive',
    description: 'Search files, read documents, list folders, manage permissions',
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

  AIRTABLE: {
    name: 'Airtable',
    description: 'Bases, tables, records, views, formulas, automations',
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
    setupInstructions: '1. Go to airtable.com/create/tokens\n2. Create a personal access token\n3. Add scopes: data.records:read, data.records:write, schema.bases:read\n4. Select the bases you want to access',
    testToolName: 'airtable_list_bases',
  },

  STRIPE: {
    name: 'Stripe',
    description: 'Customers, subscriptions, invoices, payments, products, prices',
    buildConfig: (creds) => ({
      command: 'npx',
      args: ['-y', 'stripe-mcp-server'],
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

  // ─── Communication Providers ────────────────────────────────────────────

  DISCORD: {
    name: 'Discord',
    description: 'Send messages, manage channels, list servers, moderate content',
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
    setupInstructions: '1. Go to discord.com/developers/applications\n2. Create a new application and add a Bot\n3. Copy the bot token\n4. Invite the bot to your server with appropriate permissions',
    testToolName: 'discord_list_guilds',
  },

  TWILIO: {
    name: 'Twilio',
    description: 'Send SMS, make calls, manage phone numbers, WhatsApp messaging',
    buildConfig: (creds) => ({
      command: 'npx',
      args: ['-y', 'twilio-mcp-server'],
      env: {
        TWILIO_ACCOUNT_SID: creds['accountSid'] ?? '',
        TWILIO_AUTH_TOKEN: creds['authToken'] ?? '',
      },
    }),
    credentialFields: [
      { key: 'accountSid', label: 'Account SID', placeholder: 'AC...', type: 'text', helpUrl: 'https://console.twilio.com/' },
      { key: 'authToken', label: 'Auth Token', placeholder: 'Your Twilio auth token', type: 'password' },
    ],
    setupInstructions: '1. Go to console.twilio.com\n2. Copy your Account SID and Auth Token from the dashboard\n3. Purchase a phone number if you need to send SMS',
    testToolName: 'twilio_list_messages',
  },

  SENDGRID: {
    name: 'SendGrid',
    description: 'Send transactional and marketing emails, manage contacts, templates',
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
    setupInstructions: '1. Go to app.sendgrid.com/settings/api_keys\n2. Create an API key with Full Access or restricted scopes\n3. Copy the key (starts with SG.)',
    testToolName: 'sendgrid_list_templates',
  },

  // ─── Analytics & Data Providers ─────────────────────────────────────────

  GOOGLE_ANALYTICS: {
    name: 'Google Analytics',
    description: 'GA4 reports, real-time data, user metrics, conversion tracking',
    buildConfig: (creds) => ({
      command: 'npx',
      args: ['-y', 'google-analytics-mcp-server'],
      env: {
        GA_PROPERTY_ID: creds['propertyId'] ?? '',
        GA_SERVICE_ACCOUNT_KEY: creds['serviceAccountKey'] ?? '',
      },
    }),
    credentialFields: [
      { key: 'propertyId', label: 'GA4 Property ID', placeholder: '123456789', type: 'text', helpUrl: 'https://analytics.google.com/analytics/web/' },
      { key: 'serviceAccountKey', label: 'Service Account JSON Key', placeholder: 'Paste the full JSON key', type: 'password' },
    ],
    setupInstructions: '1. Create a service account in Google Cloud Console\n2. Enable the Google Analytics Data API\n3. Add the service account email as a viewer in GA4 property\n4. Download the JSON key file and paste its contents',
  },

  // ─── Project Management ─────────────────────────────────────────────────

  ASANA: {
    name: 'Asana',
    description: 'Tasks, projects, sections, tags, custom fields, team workspaces',
    buildConfig: (creds) => ({
      command: 'npx',
      args: ['-y', 'asana-mcp-server'],
      env: {
        ASANA_ACCESS_TOKEN: creds['accessToken'] ?? '',
      },
    }),
    credentialFields: [
      { key: 'accessToken', label: 'Personal Access Token', placeholder: '1/12345...', type: 'password', helpUrl: 'https://app.asana.com/0/developer-console' },
    ],
    setupInstructions: '1. Go to app.asana.com/0/developer-console\n2. Create a Personal Access Token\n3. Copy the token',
    testToolName: 'asana_list_workspaces',
  },

  CLICKUP: {
    name: 'ClickUp',
    description: 'Tasks, lists, spaces, goals, time tracking, custom views',
    buildConfig: (creds) => ({
      command: 'npx',
      args: ['-y', 'clickup-mcp-server'],
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

  // ─── Database & Storage ─────────────────────────────────────────────────

  SUPABASE: {
    name: 'Supabase',
    description: 'Database queries, auth management, storage, real-time subscriptions',
    buildConfig: (creds) => ({
      command: 'npx',
      args: ['-y', '@supabase/mcp-server'],
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
};
