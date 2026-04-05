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
};
