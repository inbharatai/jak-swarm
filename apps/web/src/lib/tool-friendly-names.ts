/**
 * User-friendly labels for tool names displayed in the chat.
 *
 * Maps internal tool names (e.g. "web_search") to human-readable
 * action descriptions (e.g. "Searching the web") so the user sees
 * "🔍 Searching the web — jakswarm.com" instead of
 * "🔧 Calling **web_search** — `site:jakswarm.com`".
 *
 * The `formatToolInputPreview` function also strips raw JSON and
 * URL parameters from tool input summaries, keeping only the
 * essential query or URL for display.
 */

const TOOL_FRIENDLY_NAMES: Record<string, string> = {
  // Research
  web_search: 'Searching the web',
  web_fetch: 'Fetching web page',
  search_knowledge: 'Searching knowledge base',

  // Browser
  browser_navigate: 'Inspecting website',
  browser_extract: 'Extracting page data',
  browser_get_text: 'Reading page content',
  browser_screenshot: 'Capturing screenshot',
  browser_analyze_page: 'Analyzing page structure',
  browser_fill_form: 'Filling form fields',
  browser_click: 'Clicking element',
  browser_wait_for: 'Waiting for page element',
  browser_type_text: 'Entering text',
  browser_press_key: 'Pressing key',
  browser_mouse_click: 'Clicking mouse',
  browser_scroll: 'Scrolling page',
  browser_select_option: 'Selecting option',
  browser_upload_file: 'Uploading file',
  browser_evaluate_js: 'Running script',
  browser_hover: 'Hovering element',
  browser_get_cookies: 'Reading cookies',
  browser_set_cookies: 'Setting cookies',
  browser_save_as_pdf: 'Saving as PDF',
  browser_manage_tabs: 'Managing tabs',

  // SEO
  audit_seo: 'Running SEO audit',
  research_keywords: 'Researching keywords',
  analyze_serp: 'Analyzing search results',

  // Document / Knowledge
  find_document: 'Looking up documents',
  ingest_document: 'Ingesting document',
  summarize_document: 'Summarizing document',
  extract_document_data: 'Extracting document data',
  classify_text: 'Classifying text',

  // GitHub
  github_list_files: 'Listing repository files',
  github_read_file: 'Reading source file',
  github_review_pr: 'Reviewing pull request',
  analyze_github_repo: 'Analyzing repository',
  check_dependencies: 'Checking dependencies',
  estimate_tech_debt: 'Estimating technical debt',

  // CRM
  lookup_crm_contact: 'Looking up contact',
  search_crm: 'Searching CRM',
  update_crm_record: 'Updating CRM record',

  // Email / Calendar
  read_email: 'Reading emails',
  draft_email: 'Drafting email',
  send_email: 'Sending email',
  gmail_read_inbox: 'Reading inbox',
  gmail_send_email: 'Sending email',
  list_calendar_events: 'Checking calendar',
  create_calendar_event: 'Creating calendar event',
  find_availability: 'Finding availability',

  // Social / Marketing
  monitor_brand_mentions: 'Monitoring brand mentions',
  auto_engage_reddit: 'Engaging on Reddit',
  auto_engage_twitter: 'Engaging on Twitter',
  auto_engage_linkedin: 'Engaging on LinkedIn',
  generate_seo_report: 'Generating SEO report',
  track_content_performance: 'Tracking content performance',
  generate_report: 'Generating report',

  // Finance
  parse_financial_csv: 'Parsing financial data',
  compute_statistics: 'Computing statistics',
  track_budget: 'Tracking budget',
  forecast_cashflow: 'Forecasting cash flow',

  // Strategy
  track_okrs: 'Tracking OKRs',
  monitor_competitors: 'Monitoring competitors',
  generate_board_report: 'Generating board report',

  // CEO / Activity
  compile_executive_summary: 'Compiling executive summary',

  // Growth
  enrich_contact: 'Enriching contact data',
  enrich_company: 'Enriching company data',
  verify_email_deliverability: 'Verifying email deliverability',
  score_lead: 'Scoring lead',
  create_email_sequence: 'Creating email sequence',
  personalize_email: 'Personalizing email',
  analyze_engagement: 'Analyzing engagement',
  predict_churn: 'Predicting churn risk',
  monitor_company_signals: 'Monitoring company signals',
  find_decision_makers: 'Finding decision makers',
  track_lead_pipeline: 'Tracking lead pipeline',

  // Support
  classify_ticket: 'Classifying ticket',
  search_knowledge_base: 'Searching knowledge base',
  lookup_customer: 'Looking up customer',

  // Memory
  memory_store: 'Storing memory',
  memory_retrieve: 'Retrieving memory',

  // File ops
  file_read: 'Reading file',
  file_write: 'Writing file',
  list_directory: 'Listing directory',

  // Code
  code_execute: 'Executing code',

  // Integrations
  send_webhook: 'Sending webhook',

  // HR
  screen_resume: 'Screening resume',
  post_job_listing: 'Posting job listing',
  generate_offer_letter: 'Generating offer letter',

  // Legal
  compare_contracts: 'Comparing contracts',
  extract_obligations: 'Extracting obligations',
  monitor_regulations: 'Monitoring regulations',

  // Spreadsheets
  parse_spreadsheet: 'Parsing spreadsheet',

  // Deployer
  deploy_to_vercel: 'Deploying to Vercel',
  github_create_repo: 'Creating repository',
  github_push_files: 'Pushing files to GitHub',

  // Phoring
  phoring_forecast: 'Running forecast',
  phoring_graph_query: 'Querying graph',
  phoring_validate: 'Validating data',
  phoring_simulate: 'Running simulation',
};

/**
 * Get a human-friendly label for a tool name.
 * Falls back to title-casing the snake_case name.
 */
export function getToolFriendlyLabel(toolName: string): string {
  return TOOL_FRIENDLY_NAMES[toolName]
    ?? toolName.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Format the tool input preview for display.
 * Strips raw JSON, extracts URLs for fetch/navigation tools,
 * and truncates to a readable length.
 */
export function formatToolInputPreview(toolName: string, inputSummary: string): string {
  if (!inputSummary || inputSummary.trim().length === 0) return '';

  // For URL-fetching tools, extract and show just the URL
  if (['web_fetch', 'browser_navigate'].includes(toolName)) {
    const urlMatch = inputSummary.match(/https?:\/\/[^\s"')\]]+/);
    if (urlMatch) return urlMatch[0];
  }

  // For search tools, strip the "site:" prefix and show just the query
  if (['web_search', 'search_knowledge'].includes(toolName)) {
    const cleaned = inputSummary.replace(/^site:[^\s]+\s*/i, '').trim();
    if (cleaned.length <= 80) return cleaned;
    return cleaned.slice(0, 77) + '...';
  }

  // For browser tools with URLs, show the URL
  if (toolName.startsWith('browser_')) {
    const urlMatch = inputSummary.match(/https?:\/\/[^\s"')\]]+/);
    if (urlMatch) return urlMatch[0];
  }

  // General: truncate at 60 chars
  if (inputSummary.length <= 60) return inputSummary;
  return inputSummary.slice(0, 57) + '...';
}