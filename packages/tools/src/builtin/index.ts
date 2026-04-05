import { ToolCategory, ToolRiskClass } from '@jak-swarm/shared';
import type { ToolExecutionContext } from '@jak-swarm/shared';
import { toolRegistry } from '../registry/tool-registry.js';
import { MockCRMAdapter } from '../adapters/crm/mock-crm.adapter.js';
import { getMemoryAdapter } from '../adapters/memory/db-memory.adapter.js';
import { registerPhoringTools } from './phoring.tools.js';
import { getEmailAdapter, getCalendarAdapter, hasRealAdapters } from '../adapters/adapter-factory.js';

const emailAdapter = getEmailAdapter();
const calendarAdapter = getCalendarAdapter();
const crmAdapter = new MockCRMAdapter();

if (hasRealAdapters()) {
  console.log('[tools] Using REAL Gmail + Calendar adapters');
} else {
  console.log('[tools] Using MOCK email + calendar adapters (set GMAIL_EMAIL + GMAIL_APP_PASSWORD for real)');
}

/**
 * Register all built-in tools in the global ToolRegistry.
 * Call this once at application startup.
 */
export function registerBuiltinTools(): void {
  // ─── EMAIL TOOLS ─────────────────────────────────────────────────────────

  toolRegistry.register(
    {
      name: 'read_email',
      description: 'Read emails from the inbox with optional filters. Returns list of email messages.',
      category: ToolCategory.EMAIL,
      riskClass: ToolRiskClass.READ_ONLY,
      requiresApproval: false,
      inputSchema: {
        type: 'object',
        properties: {
          filter: {
            type: 'object',
            properties: {
              from: { type: 'string', description: 'Filter by sender email' },
              subject: { type: 'string', description: 'Filter by subject keywords' },
              labels: { type: 'array', items: { type: 'string' } },
              limit: { type: 'number', description: 'Max number of emails to return' },
              after: { type: 'string', description: 'ISO date string - emails after this date' },
              before: { type: 'string', description: 'ISO date string - emails before this date' },
            },
          },
        },
      },
      outputSchema: {
        type: 'object',
        properties: { emails: { type: 'array' } },
      },
      version: '1.0.0',
    },
    async (input: unknown, _context: ToolExecutionContext) => {
      const { filter } = (input as { filter?: Parameters<typeof emailAdapter.listMessages>[0] }) ?? {};
      return emailAdapter.listMessages(filter ?? {});
    },
  );

  toolRegistry.register(
    {
      name: 'draft_email',
      description: 'Create a draft email. Does not send. Returns draft ID for later review or send.',
      category: ToolCategory.EMAIL,
      riskClass: ToolRiskClass.WRITE,
      requiresApproval: false,
      inputSchema: {
        type: 'object',
        properties: {
          to: { type: 'array', items: { type: 'string' }, description: 'Recipient email addresses' },
          subject: { type: 'string', description: 'Email subject' },
          body: { type: 'string', description: 'Email body (plain text or HTML)' },
          cc: { type: 'array', items: { type: 'string' }, description: 'CC recipients' },
        },
        required: ['to', 'subject', 'body'],
      },
      outputSchema: { type: 'object', properties: { draft: { type: 'object' } } },
      version: '1.0.0',
    },
    async (input: unknown, _context: ToolExecutionContext) => {
      const { to, subject, body, cc } = input as { to: string[]; subject: string; body: string; cc?: string[] };
      return emailAdapter.createDraft(to, subject, body, cc);
    },
  );

  toolRegistry.register(
    {
      name: 'send_email',
      description: 'Send a previously created email draft. REQUIRES explicit human approval before execution. Cannot be undone.',
      category: ToolCategory.EMAIL,
      riskClass: ToolRiskClass.EXTERNAL_SIDE_EFFECT,
      requiresApproval: true,
      inputSchema: {
        type: 'object',
        properties: {
          draftId: { type: 'string', description: 'ID of the draft to send' },
        },
        required: ['draftId'],
      },
      outputSchema: { type: 'object', properties: { success: { type: 'boolean' } } },
      version: '1.0.0',
    },
    async (input: unknown, _context: ToolExecutionContext) => {
      const { draftId } = input as { draftId: string };
      await emailAdapter.sendDraft(draftId);
      return { success: true, draftId, sentAt: new Date().toISOString() };
    },
  );

  // ─── CALENDAR TOOLS ───────────────────────────────────────────────────────

  toolRegistry.register(
    {
      name: 'list_calendar_events',
      description: 'List calendar events within a date range with optional filters.',
      category: ToolCategory.CALENDAR,
      riskClass: ToolRiskClass.READ_ONLY,
      requiresApproval: false,
      inputSchema: {
        type: 'object',
        properties: {
          after: { type: 'string', description: 'ISO datetime - events after this time' },
          before: { type: 'string', description: 'ISO datetime - events before this time' },
          query: { type: 'string', description: 'Search term' },
          maxResults: { type: 'number' },
        },
      },
      outputSchema: { type: 'object', properties: { events: { type: 'array' } } },
      version: '1.0.0',
    },
    async (input: unknown, _context: ToolExecutionContext) => {
      const filter = input as Parameters<typeof calendarAdapter.listEvents>[0] ?? {};
      return calendarAdapter.listEvents(filter);
    },
  );

  toolRegistry.register(
    {
      name: 'create_calendar_event',
      description: 'Create a new calendar event and optionally invite attendees.',
      category: ToolCategory.CALENDAR,
      riskClass: ToolRiskClass.WRITE,
      requiresApproval: false,
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          startTime: { type: 'string', description: 'ISO datetime' },
          endTime: { type: 'string', description: 'ISO datetime' },
          description: { type: 'string' },
          attendees: { type: 'array', items: { type: 'string' } },
          location: { type: 'string' },
        },
        required: ['title', 'startTime', 'endTime'],
      },
      outputSchema: { type: 'object', properties: { event: { type: 'object' } } },
      version: '1.0.0',
    },
    async (input: unknown, _context: ToolExecutionContext) => {
      return calendarAdapter.createEvent(input as Parameters<typeof calendarAdapter.createEvent>[0]);
    },
  );

  // ─── CRM TOOLS ───────────────────────────────────────────────────────────

  toolRegistry.register(
    {
      name: 'lookup_crm_contact',
      description: 'Look up a CRM contact by email, name, or company. Returns contact details and recent activity.',
      category: ToolCategory.CRM,
      riskClass: ToolRiskClass.READ_ONLY,
      requiresApproval: false,
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Name, email, or company to search for' },
        },
        required: ['query'],
      },
      outputSchema: { type: 'object', properties: { contacts: { type: 'array' } } },
      version: '1.0.0',
    },
    async (input: unknown, _context: ToolExecutionContext) => {
      const { query } = input as { query: string };
      return crmAdapter.searchContacts(query);
    },
  );

  toolRegistry.register(
    {
      name: 'update_crm_record',
      description: 'Update a CRM contact record. REQUIRES approval for significant field changes. Returns updated contact.',
      category: ToolCategory.CRM,
      riskClass: ToolRiskClass.WRITE,
      requiresApproval: true,
      inputSchema: {
        type: 'object',
        properties: {
          contactId: { type: 'string' },
          updates: { type: 'object' },
        },
        required: ['contactId', 'updates'],
      },
      outputSchema: { type: 'object', properties: { contact: { type: 'object' } } },
      version: '1.0.0',
    },
    async (input: unknown, context: ToolExecutionContext) => {
      const { contactId, updates } = input as { contactId: string; updates: Record<string, unknown> };
      const updated = await crmAdapter.updateContact(contactId, updates);
      await crmAdapter.createNote(
        contactId,
        `Record updated via workflow ${context.workflowId}`,
        context.userId,
        'JAK Swarm',
      );
      return updated;
    },
  );

  // ─── KNOWLEDGE TOOLS ─────────────────────────────────────────────────────

  toolRegistry.register(
    {
      name: 'search_knowledge',
      description: 'Search the tenant knowledge base for relevant information, policies, and procedures.',
      category: ToolCategory.KNOWLEDGE,
      riskClass: ToolRiskClass.READ_ONLY,
      requiresApproval: false,
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
          maxResults: { type: 'number', description: 'Maximum number of results (default: 5)' },
        },
        required: ['query'],
      },
      outputSchema: { type: 'object', properties: { results: { type: 'array' } } },
      version: '1.0.0',
    },
    async (input: unknown, _context: ToolExecutionContext) => {
      const { query } = input as { query: string; maxResults?: number };
      // Honest stub: no knowledge base connected yet.
      // Returns a clear signal so the LLM knows to use its own knowledge.
      return {
        results: [],
        query,
        totalFound: 0,
        connected: false,
        message: `Knowledge base not connected. No stored documents found for "${query}". The agent should use its built-in knowledge and web_search tool instead.`,
      };
    },
  );

  // ─── DOCUMENT TOOLS ─────────────────────────────────────────────────────

  toolRegistry.register(
    {
      name: 'summarize_document',
      description: 'Generate a structured summary of a document with key points and action items.',
      category: ToolCategory.DOCUMENT,
      riskClass: ToolRiskClass.READ_ONLY,
      requiresApproval: false,
      inputSchema: {
        type: 'object',
        properties: {
          content: { type: 'string', description: 'Document content to summarize' },
          focusArea: { type: 'string', description: 'Optional focus area for summary' },
        },
        required: ['content'],
      },
      outputSchema: { type: 'object', properties: { summary: { type: 'string' }, keyPoints: { type: 'array' } } },
      version: '1.0.0',
    },
    async (input: unknown, _context: ToolExecutionContext) => {
      const { content, focusArea } = input as { content: string; focusArea?: string };
      // Real implementation: pass the actual content back so the LLM can summarize it
      // The LLM calling this tool already has the content — return it with metadata
      // so the agent can process it in the conversation loop
      return {
        content: content.slice(0, 8000), // Cap to prevent token overflow
        focusArea: focusArea ?? 'general',
        wordCount: content.split(/\s+/).length,
        charCount: content.length,
        message: 'Document content loaded. Please analyze and summarize based on the content above.',
      };
    },
  );

  toolRegistry.register(
    {
      name: 'extract_document_data',
      description: 'Extract structured data fields from a document using a provided schema. Returns fields with confidence scores.',
      category: ToolCategory.DOCUMENT,
      riskClass: ToolRiskClass.READ_ONLY,
      requiresApproval: false,
      inputSchema: {
        type: 'object',
        properties: {
          content: { type: 'string', description: 'Document content' },
          fields: { type: 'array', items: { type: 'string' }, description: 'List of fields to extract' },
        },
        required: ['content', 'fields'],
      },
      outputSchema: { type: 'object', properties: { extractedFields: { type: 'array' } } },
      version: '1.0.0',
    },
    async (input: unknown, _context: ToolExecutionContext) => {
      const { content, fields } = input as { content: string; fields: string[] };
      // Return the content and requested fields back to the LLM for extraction
      // The LLM is the actual extraction engine — this tool provides the interface
      return {
        content: content.slice(0, 8000),
        requestedFields: fields,
        message: `Document loaded (${content.split(/\s+/).length} words). Extract the following fields: ${fields.join(', ')}`,
      };
    },
  );

  // ─── TEXT TOOLS ──────────────────────────────────────────────────────────

  toolRegistry.register(
    {
      name: 'classify_text',
      description: 'Classify text content into predefined categories with confidence scores.',
      category: ToolCategory.RESEARCH,
      riskClass: ToolRiskClass.READ_ONLY,
      requiresApproval: false,
      inputSchema: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'Text to classify' },
          categories: { type: 'array', items: { type: 'string' }, description: 'Categories to classify into' },
        },
        required: ['text'],
      },
      outputSchema: {
        type: 'object',
        properties: { category: { type: 'string' }, confidence: { type: 'number' } },
      },
      version: '1.0.0',
    },
    async (input: unknown, _context: ToolExecutionContext) => {
      const { text, categories = [] } = input as {
        text: string;
        categories?: string[];
      };
      // Return the text and categories back to the LLM for classification
      // The LLM is the actual classifier — this tool provides the interface
      return {
        text: text.slice(0, 4000),
        availableCategories: categories,
        textLength: text.length,
        message: `Text loaded (${text.length} chars). Classify into one of: ${categories.length > 0 ? categories.join(', ') : 'auto-detect categories'}`,
      };
    },
  );

  // ─── WEB SEARCH TOOLS ────────────────────────────────────────────────────
  // FREE web search — no API key required.
  // Strategy: DuckDuckGo HTML search (primary) → extract results from HTML.
  // If TAVILY_API_KEY is set, uses Tavily for higher quality results.
  // Falls back gracefully if all search methods fail.

  /**
   * Parse DuckDuckGo HTML search results.
   * DDG's lite HTML endpoint doesn't require authentication or API keys.
   */
  async function searchDuckDuckGo(query: string, maxResults: number): Promise<{
    results: Array<{ title: string; url: string; snippet: string }>;
    source: string;
  }> {
    const encodedQuery = encodeURIComponent(query);
    const response = await fetch(`https://html.duckduckgo.com/html/?q=${encodedQuery}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
      body: `q=${encodedQuery}`,
    });

    if (!response.ok) {
      throw new Error(`DuckDuckGo returned ${response.status}`);
    }

    const html = await response.text();
    const results: Array<{ title: string; url: string; snippet: string }> = [];

    // Parse result blocks from DDG HTML — each result is in a div.result
    // Extract: title from <a class="result__a">, URL from href, snippet from <a class="result__snippet">
    const resultBlocks = html.split('class="result__body"');

    for (let i = 1; i < resultBlocks.length && results.length < maxResults; i++) {
      const block = resultBlocks[i]!;

      // Extract title
      const titleMatch = block.match(/class="result__a"[^>]*>([^<]*)</);
      const title = titleMatch?.[1]?.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').trim() ?? '';

      // Extract URL — DDG wraps URLs in a redirect, the actual URL is in the uddg parameter
      const urlMatch = block.match(/href="([^"]*uddg=([^&"]*))/);
      let url = '';
      if (urlMatch?.[2]) {
        try {
          url = decodeURIComponent(urlMatch[2]);
        } catch {
          url = urlMatch[2];
        }
      } else {
        // Fallback: try to find any https URL in the block
        const directUrlMatch = block.match(/href="(https?:\/\/[^"]+)"/);
        url = directUrlMatch?.[1] ?? '';
      }

      // Extract snippet
      const snippetMatch = block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/);
      const snippet = snippetMatch?.[1]
        ?.replace(/<\/?[^>]+(>|$)/g, '') // strip HTML tags
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#x27;/g, "'").replace(/&quot;/g, '"')
        .trim() ?? '';

      if (title && url) {
        results.push({ title, url, snippet });
      }
    }

    return { results, source: 'duckduckgo' };
  }

  /**
   * Fetch and extract readable text content from a URL.
   * Used to get full page content for the top search results.
   */
  async function fetchPageContent(url: string, maxChars: number = 3000): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'text/html,application/xhtml+xml',
        },
        redirect: 'follow',
      });
      clearTimeout(timeout);

      if (!response.ok) return '';

      const html = await response.text();

      // Strip scripts, styles, nav, header, footer
      let text = html
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<nav[\s\S]*?<\/nav>/gi, '')
        .replace(/<header[\s\S]*?<\/header>/gi, '')
        .replace(/<footer[\s\S]*?<\/footer>/gi, '')
        .replace(/<[^>]+>/g, ' ')  // strip remaining HTML tags
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&#x27;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/\s+/g, ' ')     // collapse whitespace
        .trim();

      return text.slice(0, maxChars);
    } catch {
      clearTimeout(timeout);
      return '';
    }
  }

  toolRegistry.register(
    {
      name: 'web_search',
      description: 'Search the web for current information. FREE — no API key required. Uses DuckDuckGo for search results and fetches page content from top results.',
      category: ToolCategory.RESEARCH,
      riskClass: ToolRiskClass.READ_ONLY,
      requiresApproval: false,
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
          maxResults: { type: 'number', description: 'Maximum number of results (default: 5)' },
          fetchContent: { type: 'boolean', description: 'Fetch full page content from top results (default: true)' },
        },
        required: ['query'],
      },
      outputSchema: {
        type: 'object',
        properties: {
          results: { type: 'array' },
          source: { type: 'string' },
        },
      },
      version: '2.0.0',
    },
    async (input: unknown, _context: ToolExecutionContext) => {
      const { query, maxResults = 5, fetchContent = true } = input as {
        query: string; maxResults?: number; fetchContent?: boolean;
      };

      // Strategy 1: If Tavily key is available, use it (higher quality)
      const tavilyKey = process.env['TAVILY_API_KEY'];
      if (tavilyKey) {
        try {
          const response = await fetch('https://api.tavily.com/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              api_key: tavilyKey,
              query,
              search_depth: 'basic',
              max_results: maxResults,
              include_answer: true,
            }),
          });

          if (response.ok) {
            const data = (await response.json()) as {
              answer?: string;
              results?: Array<{ title: string; url: string; content: string; score: number }>;
            };
            return {
              results: (data.results ?? []).map(r => ({
                title: r.title,
                url: r.url,
                content: r.content,
                relevanceScore: r.score,
              })),
              answer: data.answer ?? null,
              query,
              source: 'tavily',
              resultCount: (data.results ?? []).length,
            };
          }
          // Tavily failed — fall through to DuckDuckGo
        } catch {
          // Tavily unavailable — fall through to DuckDuckGo
        }
      }

      // Strategy 2: FREE DuckDuckGo search (always available, no API key)
      try {
        const { results: ddgResults, source } = await searchDuckDuckGo(query, maxResults);

        // Optionally fetch full content from top results for better context
        const enrichedResults = [];
        for (const result of ddgResults) {
          let content = result.snippet;
          if (fetchContent && enrichedResults.length < 3) {
            // Fetch full page content for top 3 results only (performance)
            const pageContent = await fetchPageContent(result.url);
            if (pageContent.length > content.length) {
              content = pageContent;
            }
          }
          enrichedResults.push({
            title: result.title,
            url: result.url,
            content,
            relevanceScore: 1 - (enrichedResults.length * 0.1), // rank-based score
          });
        }

        return {
          results: enrichedResults,
          query,
          source,
          resultCount: enrichedResults.length,
          message: enrichedResults.length > 0
            ? `Found ${enrichedResults.length} results via DuckDuckGo (free, no API key needed)`
            : 'No results found. Try rephrasing your query.',
        };
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        return {
          results: [],
          query,
          source: 'search_failed',
          message: `Web search failed: ${errorMessage}. The agent should rely on its built-in knowledge.`,
        };
      }
    },
  );

  // Companion tool: fetch any URL and extract readable content
  toolRegistry.register(
    {
      name: 'web_fetch',
      description: 'Fetch a specific URL and extract its readable text content. No API key required.',
      category: ToolCategory.RESEARCH,
      riskClass: ToolRiskClass.READ_ONLY,
      requiresApproval: false,
      inputSchema: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL to fetch' },
          maxChars: { type: 'number', description: 'Maximum characters to extract (default: 5000)' },
        },
        required: ['url'],
      },
      outputSchema: { type: 'object', properties: { content: { type: 'string' }, url: { type: 'string' } } },
      version: '1.0.0',
    },
    async (input: unknown, _context: ToolExecutionContext) => {
      const { url, maxChars = 5000 } = input as { url: string; maxChars?: number };

      // Basic URL validation
      try {
        const parsed = new URL(url);
        if (!['http:', 'https:'].includes(parsed.protocol)) {
          return { error: 'Only http and https URLs are supported', url };
        }
      } catch {
        return { error: 'Invalid URL', url };
      }

      const content = await fetchPageContent(url, maxChars);
      if (!content) {
        return { error: 'Failed to fetch or extract content from URL', url, content: '' };
      }

      return {
        url,
        content,
        charCount: content.length,
        fetched: true,
      };
    },
  );

  // ─── SPREADSHEET PARSING TOOLS ──────────────────────────────────────────

  toolRegistry.register(
    {
      name: 'parse_spreadsheet',
      description: 'Parse CSV or structured string data into a structured array of row objects.',
      category: ToolCategory.SPREADSHEET,
      riskClass: ToolRiskClass.READ_ONLY,
      requiresApproval: false,
      inputSchema: {
        type: 'object',
        properties: {
          data: { type: 'string', description: 'CSV string or raw data to parse' },
          delimiter: { type: 'string', description: 'Column delimiter (default: comma)' },
          hasHeaders: { type: 'boolean', description: 'Whether the first row is headers (default: true)' },
        },
        required: ['data'],
      },
      outputSchema: {
        type: 'object',
        properties: {
          rows: { type: 'array' },
          headers: { type: 'array' },
          rowCount: { type: 'number' },
        },
      },
      version: '1.0.0',
    },
    async (input: unknown, _context: ToolExecutionContext) => {
      const { data, delimiter = ',', hasHeaders = true } = input as {
        data: string;
        delimiter?: string;
        hasHeaders?: boolean;
      };

      const lines = data.split('\n').filter((line) => line.trim().length > 0);
      if (lines.length === 0) {
        return { rows: [], headers: [], rowCount: 0 };
      }

      const parseLine = (line: string): string[] =>
        line.split(delimiter).map((cell) => cell.trim().replace(/^["']|["']$/g, ''));

      let headers: string[];
      let dataLines: string[];

      if (hasHeaders && lines.length > 0) {
        headers = parseLine(lines[0]!);
        dataLines = lines.slice(1);
      } else {
        const firstLine = parseLine(lines[0]!);
        headers = firstLine.map((_, i) => `column_${i}`);
        dataLines = lines;
      }

      const rows = dataLines.map((line) => {
        const cells = parseLine(line);
        const row: Record<string, string> = {};
        headers.forEach((h, i) => {
          row[h] = cells[i] ?? '';
        });
        return row;
      });

      return { rows, headers, rowCount: rows.length };
    },
  );

  toolRegistry.register(
    {
      name: 'compute_statistics',
      description: 'Compute basic descriptive statistics (mean, median, min, max, sum, stddev) from numeric array data.',
      category: ToolCategory.SPREADSHEET,
      riskClass: ToolRiskClass.READ_ONLY,
      requiresApproval: false,
      inputSchema: {
        type: 'object',
        properties: {
          values: { type: 'array', description: 'Array of numbers to compute statistics for' },
          label: { type: 'string', description: 'Optional label for the dataset' },
        },
        required: ['values'],
      },
      outputSchema: {
        type: 'object',
        properties: {
          count: { type: 'number' },
          mean: { type: 'number' },
          median: { type: 'number' },
          min: { type: 'number' },
          max: { type: 'number' },
          sum: { type: 'number' },
          stddev: { type: 'number' },
        },
      },
      version: '1.0.0',
    },
    async (input: unknown, _context: ToolExecutionContext) => {
      const { values, label } = input as { values: unknown[]; label?: string };
      const nums = values
        .map((v) => (typeof v === 'number' ? v : parseFloat(String(v))))
        .filter((n) => !isNaN(n));

      if (nums.length === 0) {
        return {
          label: label ?? 'dataset',
          count: 0,
          mean: 0,
          median: 0,
          min: 0,
          max: 0,
          sum: 0,
          stddev: 0,
          error: 'No valid numeric values found',
        };
      }

      const sorted = [...nums].sort((a, b) => a - b);
      const count = nums.length;
      const sum = nums.reduce((a, b) => a + b, 0);
      const mean = sum / count;
      const median =
        count % 2 === 0
          ? (sorted[count / 2 - 1]! + sorted[count / 2]!) / 2
          : sorted[Math.floor(count / 2)]!;
      const min = sorted[0]!;
      const max = sorted[count - 1]!;
      const variance = nums.reduce((acc, val) => acc + (val - mean) ** 2, 0) / count;
      const stddev = Math.sqrt(variance);

      return {
        label: label ?? 'dataset',
        count,
        mean: Math.round(mean * 1000) / 1000,
        median: Math.round(median * 1000) / 1000,
        min,
        max,
        sum: Math.round(sum * 1000) / 1000,
        stddev: Math.round(stddev * 1000) / 1000,
      };
    },
  );

  // ─── REPORTING TOOLS ─────────────────────────────────────────────────────

  toolRegistry.register(
    {
      name: 'generate_report',
      description: 'Generate a structured report from provided data. Supports daily ops, summary, and KPI report types.',
      category: ToolCategory.DOCUMENT,
      riskClass: ToolRiskClass.WRITE,
      requiresApproval: false,
      inputSchema: {
        type: 'object',
        properties: {
          reportType: {
            type: 'string',
            description: 'Type of report: daily_ops, summary, kpi, custom',
          },
          data: { type: 'object', description: 'Data to include in the report' },
          title: { type: 'string', description: 'Report title' },
        },
        required: ['reportType'],
      },
      outputSchema: {
        type: 'object',
        properties: { reportId: { type: 'string' }, content: { type: 'string' } },
      },
      version: '1.0.0',
    },
    async (input: unknown, context: ToolExecutionContext) => {
      const { reportType, data, title } = input as {
        reportType: string;
        data?: Record<string, unknown>;
        title?: string;
      };
      return {
        reportId: `report_${Date.now()}`,
        title: title ?? `${reportType} Report`,
        content: `# ${title ?? reportType} Report\n\nGenerated: ${new Date().toISOString()}\nWorkflow: ${context.workflowId}\n\nData summary: ${JSON.stringify(data ?? {}, null, 2).slice(0, 500)}`,
        generatedAt: new Date().toISOString(),
        reportType,
      };
    },
  );

  // ─── BROWSER TOOLS (Playwright-powered) ──────────────────────────────────

  toolRegistry.register(
    {
      name: 'browser_navigate',
      description: 'Navigate a real Chromium browser to a URL. Returns page title, final URL, HTTP status code, and extracted text content.',
      category: ToolCategory.BROWSER,
      riskClass: ToolRiskClass.WRITE,
      requiresApproval: false,
      inputSchema: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL to navigate to' },
        },
        required: ['url'],
      },
      outputSchema: { type: 'object' },
      version: '2.0.0',
    },
    async (input: unknown, _context: ToolExecutionContext) => {
      const { url } = input as { url: string };
      try {
        const { playwrightEngine } = await import('../adapters/browser/playwright-engine.js');
        const result = await playwrightEngine.navigate(url);
        return result;
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err), code: 'BROWSER_ERROR' };
      }
    },
  );

  toolRegistry.register(
    {
      name: 'browser_extract',
      description: 'Extract text content from the current browser page using a CSS selector. Optionally navigates to a URL first, otherwise uses the active page.',
      category: ToolCategory.BROWSER,
      riskClass: ToolRiskClass.READ_ONLY,
      requiresApproval: false,
      inputSchema: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL to navigate to before extracting (optional, uses active page if omitted)' },
          selector: { type: 'string', description: 'CSS selector to extract text from' },
        },
        required: ['selector'],
      },
      outputSchema: { type: 'object' },
      version: '2.0.0',
    },
    async (input: unknown, _context: ToolExecutionContext) => {
      const { url, selector } = input as { url?: string; selector: string };
      try {
        const { playwrightEngine } = await import('../adapters/browser/playwright-engine.js');
        const page = await playwrightEngine.getActivePage();
        if (url) {
          await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
        }
        const text = await playwrightEngine.extractText(page, selector);
        const count = (await page.$$(selector)).length;
        return { selector, text, count, url: page.url() };
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err), code: 'EXTRACT_ERROR' };
      }
    },
  );

  toolRegistry.register(
    {
      name: 'browser_fill_form',
      description: 'Fill form fields on a web page via CSS selectors. REQUIRES approval. Navigates to URL first, then fills fields.',
      category: ToolCategory.BROWSER,
      riskClass: ToolRiskClass.WRITE,
      requiresApproval: true,
      inputSchema: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL to navigate to before filling (optional, uses active page if omitted)' },
          fields: { type: 'object', description: 'Map of CSS selector to value to fill' },
        },
        required: ['fields'],
      },
      outputSchema: { type: 'object' },
      version: '2.0.0',
    },
    async (input: unknown, _context: ToolExecutionContext) => {
      const { url, fields } = input as { url?: string; fields: Record<string, string> };
      try {
        const { playwrightEngine } = await import('../adapters/browser/playwright-engine.js');
        const page = await playwrightEngine.getActivePage();
        if (url) {
          await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
        }
        const result = await playwrightEngine.fillForm(page, fields);
        return { ...result, url: page.url() };
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err), code: 'FILL_ERROR' };
      }
    },
  );

  toolRegistry.register(
    {
      name: 'browser_click',
      description: 'Click an element on a web page by CSS selector. REQUIRES approval. Navigates to URL first.',
      category: ToolCategory.BROWSER,
      riskClass: ToolRiskClass.WRITE,
      requiresApproval: true,
      inputSchema: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL to navigate to before clicking (optional, uses active page if omitted)' },
          selector: { type: 'string', description: 'CSS selector of the element to click' },
        },
        required: ['selector'],
      },
      outputSchema: { type: 'object' },
      version: '1.0.0',
    },
    async (input: unknown, _context: ToolExecutionContext) => {
      const { url, selector } = input as { url?: string; selector: string };
      try {
        const { playwrightEngine } = await import('../adapters/browser/playwright-engine.js');
        const page = await playwrightEngine.getActivePage();
        if (url) {
          await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
        }
        const result = await playwrightEngine.clickElement(page, selector);
        return { ...result, url: page.url() };
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err), code: 'CLICK_ERROR' };
      }
    },
  );

  toolRegistry.register(
    {
      name: 'browser_screenshot',
      description: 'Take a full-page screenshot of a URL. Returns a base64-encoded PNG image.',
      category: ToolCategory.BROWSER,
      riskClass: ToolRiskClass.READ_ONLY,
      requiresApproval: false,
      inputSchema: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL to navigate to and screenshot (optional, uses active page if omitted)' },
        },
        required: [],
      },
      outputSchema: { type: 'object' },
      version: '1.0.0',
    },
    async (input: unknown, _context: ToolExecutionContext) => {
      const { url } = input as { url?: string };
      try {
        const { playwrightEngine } = await import('../adapters/browser/playwright-engine.js');
        const page = await playwrightEngine.getActivePage();
        if (url) {
          await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
        }
        const buffer = await playwrightEngine.screenshot(page);
        return { url: page.url(), screenshot: buffer.toString('base64'), format: 'png' };
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err), code: 'SCREENSHOT_ERROR' };
      }
    },
  );

  toolRegistry.register(
    {
      name: 'browser_get_text',
      description: 'Get all visible text content from a web page. Returns cleaned text with scripts/styles/nav stripped.',
      category: ToolCategory.BROWSER,
      riskClass: ToolRiskClass.READ_ONLY,
      requiresApproval: false,
      inputSchema: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL to navigate to and extract text from (optional, uses active page if omitted)' },
        },
        required: [],
      },
      outputSchema: { type: 'object' },
      version: '1.0.0',
    },
    async (input: unknown, _context: ToolExecutionContext) => {
      const { url } = input as { url?: string };
      try {
        const { playwrightEngine } = await import('../adapters/browser/playwright-engine.js');
        const page = await playwrightEngine.getActivePage();
        if (url) {
          await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
        }
        const text = await playwrightEngine.getPageContent(page);
        return { url: page.url(), text, charCount: text.length };
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err), code: 'GET_TEXT_ERROR' };
      }
    },
  );

  // ─── BROWSER CONTROL TOOLS ──────────────────────────────────────────────
  // These provide full interactive browser control: typing, keyboard, mouse,
  // scrolling, and AI-powered page analysis. They use a persistent "active page"
  // that stays open across calls (unlike the URL-based tools above).

  toolRegistry.register(
    {
      name: 'browser_type_text',
      description: 'Type text into the currently focused element or a specific element by CSS selector. Use for form inputs, search boxes, text areas. Uses the persistent active browser page.',
      category: ToolCategory.BROWSER,
      riskClass: ToolRiskClass.WRITE,
      requiresApproval: false,
      inputSchema: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'Text to type' },
          selector: { type: 'string', description: 'Optional CSS selector to focus first' },
          pressEnter: { type: 'boolean', description: 'Press Enter after typing (default false)' },
        },
        required: ['text'],
      },
      outputSchema: { type: 'object' },
      version: '1.0.0',
    },
    async (input: unknown, _context: ToolExecutionContext) => {
      const { text, selector, pressEnter } = input as { text: string; selector?: string; pressEnter?: boolean };
      try {
        const { playwrightEngine } = await import('../adapters/browser/playwright-engine.js');
        const page = await playwrightEngine.getActivePage();
        if (selector) {
          await page.click(selector, { timeout: 5000 });
        }
        await page.keyboard.type(text, { delay: 50 });
        if (pressEnter) {
          await page.keyboard.press('Enter');
        }
        return { success: true, data: { typed: text, selector, pressedEnter: !!pressEnter } };
      } catch (err) {
        return { success: false, error: `Failed to type text: ${err instanceof Error ? err.message : String(err)}` };
      }
    },
  );

  toolRegistry.register(
    {
      name: 'browser_press_key',
      description: 'Press a keyboard key or key combination. Examples: "Enter", "Tab", "Escape", "Control+a", "Control+c", "ArrowDown". Uses the persistent active browser page.',
      category: ToolCategory.BROWSER,
      riskClass: ToolRiskClass.WRITE,
      requiresApproval: false,
      inputSchema: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'Key to press (e.g. "Enter", "Tab", "Control+a")' },
          count: { type: 'number', description: 'Number of times to press (default 1, max 20)' },
        },
        required: ['key'],
      },
      outputSchema: { type: 'object' },
      version: '1.0.0',
    },
    async (input: unknown, _context: ToolExecutionContext) => {
      const { key, count = 1 } = input as { key: string; count?: number };
      try {
        const { playwrightEngine } = await import('../adapters/browser/playwright-engine.js');
        const page = await playwrightEngine.getActivePage();
        for (let i = 0; i < Math.min(count, 20); i++) {
          await page.keyboard.press(key);
        }
        return { success: true, data: { key, count: Math.min(count, 20) } };
      } catch (err) {
        return { success: false, error: `Failed to press key: ${err instanceof Error ? err.message : String(err)}` };
      }
    },
  );

  toolRegistry.register(
    {
      name: 'browser_mouse_click',
      description: 'Click at specific x,y pixel coordinates on the page. Use when CSS selectors are not available. Uses the persistent active browser page.',
      category: ToolCategory.BROWSER,
      riskClass: ToolRiskClass.WRITE,
      requiresApproval: true,
      inputSchema: {
        type: 'object',
        properties: {
          x: { type: 'number', description: 'X coordinate in pixels from left' },
          y: { type: 'number', description: 'Y coordinate in pixels from top' },
          button: { type: 'string', description: 'Mouse button: "left" (default), "right", "middle"' },
          doubleClick: { type: 'boolean', description: 'Double-click (default false)' },
        },
        required: ['x', 'y'],
      },
      outputSchema: { type: 'object' },
      version: '1.0.0',
    },
    async (input: unknown, _context: ToolExecutionContext) => {
      const { x, y, button = 'left', doubleClick = false } = input as { x: number; y: number; button?: string; doubleClick?: boolean };
      try {
        const { playwrightEngine } = await import('../adapters/browser/playwright-engine.js');
        const page = await playwrightEngine.getActivePage();
        if (doubleClick) {
          await page.mouse.dblclick(x, y, { button: button as 'left' | 'right' | 'middle' });
        } else {
          await page.mouse.click(x, y, { button: button as 'left' | 'right' | 'middle' });
        }
        return { success: true, data: { x, y, button, doubleClick } };
      } catch (err) {
        return { success: false, error: `Failed to click: ${err instanceof Error ? err.message : String(err)}` };
      }
    },
  );

  toolRegistry.register(
    {
      name: 'browser_scroll',
      description: 'Scroll the page up, down, or to a specific element. Uses the persistent active browser page.',
      category: ToolCategory.BROWSER,
      riskClass: ToolRiskClass.READ_ONLY,
      requiresApproval: false,
      inputSchema: {
        type: 'object',
        properties: {
          direction: { type: 'string', description: '"up" or "down"' },
          pixels: { type: 'number', description: 'Pixels to scroll (default 500)' },
          selector: { type: 'string', description: 'CSS selector to scroll into view (overrides direction/pixels)' },
        },
        required: [],
      },
      outputSchema: { type: 'object' },
      version: '1.0.0',
    },
    async (input: unknown, _context: ToolExecutionContext) => {
      const { direction, pixels = 500, selector } = input as { direction?: string; pixels?: number; selector?: string };
      try {
        const { playwrightEngine } = await import('../adapters/browser/playwright-engine.js');
        const page = await playwrightEngine.getActivePage();
        if (selector) {
          await page.locator(selector).scrollIntoViewIfNeeded({ timeout: 5000 });
          return { success: true, data: { scrolledTo: selector } };
        }
        const amount = direction === 'up' ? -Math.abs(pixels) : Math.abs(pixels);
        await page.evaluate(`window.scrollBy(0, ${amount})`);
        return { success: true, data: { direction: direction ?? 'down', pixels: Math.abs(amount) } };
      } catch (err) {
        return { success: false, error: `Failed to scroll: ${err instanceof Error ? err.message : String(err)}` };
      }
    },
  );

  toolRegistry.register(
    {
      name: 'browser_analyze_page',
      description: 'Take a screenshot of the current active browser page and analyze it using AI vision (GPT-4o). Returns a detailed description of what is visible: layout, text, buttons, forms, images, data. Use when you need to UNDERSTAND what a page looks like. Requires OPENAI_API_KEY env var for vision analysis.',
      category: ToolCategory.BROWSER,
      riskClass: ToolRiskClass.READ_ONLY,
      requiresApproval: false,
      inputSchema: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: 'What to look for in the page (optional, default: general analysis)' },
          fullPage: { type: 'boolean', description: 'Capture full page or just viewport (default: viewport only)' },
        },
        required: [],
      },
      outputSchema: { type: 'object' },
      version: '1.0.0',
    },
    async (input: unknown, _context: ToolExecutionContext) => {
      const { prompt, fullPage = false } = input as { prompt?: string; fullPage?: boolean };
      try {
        const { playwrightEngine } = await import('../adapters/browser/playwright-engine.js');
        const page = await playwrightEngine.getActivePage();

        // Take screenshot
        const screenshotBuffer = await playwrightEngine.screenshot(page, fullPage);
        const base64 = screenshotBuffer.toString('base64');

        // Use OpenAI vision to analyze
        const apiKey = process.env['OPENAI_API_KEY'];
        if (!apiKey) {
          return {
            success: true,
            data: {
              screenshot: base64.slice(0, 100) + '...(truncated)',
              analysis: 'Vision analysis unavailable (no OPENAI_API_KEY). Screenshot captured as base64.',
              screenshotBase64: base64,
            },
          };
        }

        const OpenAI = (await import('openai')).default;
        const openai = new OpenAI({ apiKey });
        const analysisPrompt = prompt || 'Analyze this webpage screenshot. Describe: 1) Page layout and structure, 2) Key text content visible, 3) Interactive elements (buttons, forms, links), 4) Any data or tables shown, 5) Overall purpose of the page.';

        const response = await openai.chat.completions.create({
          model: 'gpt-4o',
          messages: [
            {
              role: 'user',
              content: [
                { type: 'image_url', image_url: { url: `data:image/png;base64,${base64}`, detail: 'high' } },
                { type: 'text', text: analysisPrompt },
              ],
            },
          ],
          max_tokens: 1500,
        });

        const analysis = response.choices[0]?.message?.content ?? 'Unable to analyze screenshot.';
        return { success: true, data: { screenshot: base64.slice(0, 100) + '...(truncated)', analysis } };
      } catch (err) {
        return { success: false, error: `Page analysis failed: ${err instanceof Error ? err.message : String(err)}` };
      }
    },
  );

  // ─── PDF TOOLS ──────────────────────────────────────────────────────────

  toolRegistry.register(
    {
      name: 'pdf_extract_text',
      description: 'Extract all text content from a PDF file. Provide a file path (relative to workspace) or a URL.',
      category: ToolCategory.DOCUMENT,
      riskClass: ToolRiskClass.READ_ONLY,
      requiresApproval: false,
      inputSchema: {
        type: 'object',
        properties: {
          source: { type: 'string', description: 'File path in workspace or URL to PDF' },
        },
        required: ['source'],
      },
      outputSchema: { type: 'object' },
      version: '1.0.0',
    },
    async (input: unknown, _context: ToolExecutionContext) => {
      const { source } = input as { source: string };
      try {
        let buffer: Buffer;

        if (source.startsWith('http://') || source.startsWith('https://')) {
          const response = await fetch(source);
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          buffer = Buffer.from(await response.arrayBuffer());
        } else {
          const fs = await import('node:fs/promises');
          const nodePath = await import('node:path');
          const workspaceDir = process.env['JAK_WORKSPACE_DIR'] ?? process.cwd();
          const fullPath = nodePath.resolve(workspaceDir, source);
          if (!fullPath.startsWith(nodePath.resolve(workspaceDir))) {
            throw new Error('Path traversal not allowed');
          }
          buffer = await fs.readFile(fullPath);
        }

        const { PDFParse } = await import('pdf-parse');
        const parser = new PDFParse({ data: new Uint8Array(buffer) });
        const textResult = await parser.getText();
        const infoResult = await parser.getInfo();
        await parser.destroy();
        const data = { text: textResult.text, numpages: textResult.total, info: infoResult, metadata: null as unknown };

        return {
          success: true,
          data: {
            text: data.text,
            pages: data.numpages,
            info: data.info,
            metadata: data.metadata,
          },
        };
      } catch (err) {
        return { success: false, error: `PDF extraction failed: ${err instanceof Error ? err.message : String(err)}` };
      }
    },
  );

  toolRegistry.register(
    {
      name: 'pdf_analyze',
      description: 'Extract text from a PDF and analyze its content using AI (GPT-4o). Returns structured analysis including summary, key data, and entities. Requires OPENAI_API_KEY for AI analysis; falls back to raw text extraction without it.',
      category: ToolCategory.DOCUMENT,
      riskClass: ToolRiskClass.READ_ONLY,
      requiresApproval: false,
      inputSchema: {
        type: 'object',
        properties: {
          source: { type: 'string', description: 'File path in workspace or URL to PDF' },
          query: { type: 'string', description: 'What to analyze or extract from the PDF (optional, default: general analysis)' },
        },
        required: ['source'],
      },
      outputSchema: { type: 'object' },
      version: '1.0.0',
    },
    async (input: unknown, _context: ToolExecutionContext) => {
      const { source, query } = input as { source: string; query?: string };
      try {
        let buffer: Buffer;
        if (source.startsWith('http://') || source.startsWith('https://')) {
          const response = await fetch(source);
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          buffer = Buffer.from(await response.arrayBuffer());
        } else {
          const fs = await import('node:fs/promises');
          const nodePath = await import('node:path');
          const workspaceDir = process.env['JAK_WORKSPACE_DIR'] ?? process.cwd();
          const fullPath = nodePath.resolve(workspaceDir, source);
          if (!fullPath.startsWith(nodePath.resolve(workspaceDir))) throw new Error('Path traversal not allowed');
          buffer = await fs.readFile(fullPath);
        }

        const { PDFParse } = await import('pdf-parse');
        const parser = new PDFParse({ data: new Uint8Array(buffer) });
        const textResult = await parser.getText();
        const infoResult = await parser.getInfo();
        await parser.destroy();
        const data = { text: textResult.text, numpages: textResult.total, info: infoResult, metadata: null as unknown };

        const apiKey = process.env['OPENAI_API_KEY'];
        if (!apiKey) {
          return {
            success: true,
            data: {
              text: data.text.slice(0, 5000),
              pages: data.numpages,
              analysis: 'LLM analysis unavailable (no OPENAI_API_KEY). Raw text extracted.',
            },
          };
        }

        const OpenAI = (await import('openai')).default;
        const openai = new OpenAI({ apiKey });

        const analysisPrompt = query
          ? `Analyze this PDF text and answer: ${query}\n\nPDF TEXT:\n${data.text.slice(0, 8000)}`
          : `Analyze this PDF document. Provide: 1) Summary, 2) Key findings/data, 3) Important entities (names, dates, amounts), 4) Document type and purpose.\n\nPDF TEXT:\n${data.text.slice(0, 8000)}`;

        const response = await openai.chat.completions.create({
          model: process.env['OPENAI_MODEL'] ?? 'gpt-4o',
          messages: [{ role: 'user', content: analysisPrompt }],
          max_tokens: 2000,
        });

        return {
          success: true,
          data: {
            pages: data.numpages,
            textLength: data.text.length,
            analysis: response.choices[0]?.message?.content ?? 'Analysis failed.',
          },
        };
      } catch (err) {
        return { success: false, error: `PDF analysis failed: ${err instanceof Error ? err.message : String(err)}` };
      }
    },
  );

  // ─── GMAIL BROWSER AUTOMATION TOOLS ─────────────────────────────────────
  // These automate Gmail through the browser. The user must be logged in to
  // Gmail in the persistent browser profile (~/.jak-swarm/browser-profile).
  // No API key required.

  toolRegistry.register(
    {
      name: 'gmail_read_inbox',
      description: 'Read Gmail inbox via browser automation. Navigates to mail.google.com and extracts email subjects, senders, and dates. User must be logged in to Gmail in the browser profile.',
      category: ToolCategory.EMAIL,
      riskClass: ToolRiskClass.READ_ONLY,
      requiresApproval: false,
      inputSchema: {
        type: 'object',
        properties: {
          maxEmails: { type: 'number', description: 'Maximum number of emails to extract (default: 20)' },
        },
      },
      outputSchema: { type: 'object' },
      version: '1.0.0',
    },
    async (input: unknown, _context: ToolExecutionContext) => {
      const { maxEmails = 20 } = (input as { maxEmails?: number }) ?? {};
      let page: import('playwright').Page | null = null;
      try {
        const { playwrightEngine } = await import('../adapters/browser/playwright-engine.js');
        page = await playwrightEngine.getPage();
        await page.goto('https://mail.google.com/mail/u/0/#inbox', {
          waitUntil: 'networkidle',
          timeout: 45_000,
        });

        // Wait for inbox to load — Gmail uses dynamic rendering
        await page.waitForTimeout(3000);

        // Check if we're on a login page
        const currentUrl = page.url();
        if (currentUrl.includes('accounts.google.com')) {
          return {
            error: 'Not logged in to Gmail. Please log in manually in the browser profile first. Run with JAK_BROWSER_HEADLESS=false to open the browser and log in.',
            code: 'NOT_LOGGED_IN',
          };
        }

        // Extract email rows from the inbox (string-based evaluate to avoid DOM type issues)
        const emails = await page.evaluate(`((limit) => {
          const rows = document.querySelectorAll('tr.zA');
          const results = [];
          for (let i = 0; i < Math.min(rows.length, limit); i++) {
            const row = rows[i];
            if (!row) continue;
            const senderEl = row.querySelector('.yX.xY .yP, .yX.xY .zF');
            const subjectEl = row.querySelector('.y6 span:first-child, .bog span');
            const snippetEl = row.querySelector('.y2');
            const dateEl = row.querySelector('.xW.xY span[title], .xW.xY span');
            const isUnread = row.classList.contains('zE');
            results.push({
              sender: (senderEl && senderEl.getAttribute('name')) || (senderEl && senderEl.textContent && senderEl.textContent.trim()) || '',
              subject: (subjectEl && subjectEl.textContent && subjectEl.textContent.trim()) || '',
              snippet: (snippetEl && snippetEl.textContent && snippetEl.textContent.trim().replace(/^\\s*-\\s*/, '')) || '',
              date: (dateEl && dateEl.getAttribute('title')) || (dateEl && dateEl.textContent && dateEl.textContent.trim()) || '',
              isUnread: isUnread,
            });
          }
          return results;
        })(${maxEmails})`) as Array<{ sender: string; subject: string; snippet: string; date: string; isUnread: boolean }>;

        return {
          emails,
          count: emails.length,
          source: 'gmail_browser',
          url: currentUrl,
        };
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err), code: 'GMAIL_READ_ERROR' };
      } finally {
        if (page) {
          try { const { playwrightEngine } = await import('../adapters/browser/playwright-engine.js'); await playwrightEngine.closePage(page); } catch { /* ignore */ }
        }
      }
    },
  );

  toolRegistry.register(
    {
      name: 'gmail_send_email',
      description: 'Send an email via Gmail browser automation. Navigates to Gmail compose, fills to/subject/body, and clicks send. REQUIRES approval. User must be logged in.',
      category: ToolCategory.EMAIL,
      riskClass: ToolRiskClass.EXTERNAL_SIDE_EFFECT,
      requiresApproval: true,
      inputSchema: {
        type: 'object',
        properties: {
          to: { type: 'string', description: 'Recipient email address' },
          subject: { type: 'string', description: 'Email subject line' },
          body: { type: 'string', description: 'Email body text' },
        },
        required: ['to', 'subject', 'body'],
      },
      outputSchema: { type: 'object' },
      version: '1.0.0',
    },
    async (input: unknown, _context: ToolExecutionContext) => {
      const { to, subject, body } = input as { to: string; subject: string; body: string };
      let page: import('playwright').Page | null = null;
      try {
        const { playwrightEngine } = await import('../adapters/browser/playwright-engine.js');
        page = await playwrightEngine.getPage();

        // Navigate to Gmail compose URL
        await page.goto(`https://mail.google.com/mail/u/0/?view=cm&fs=1&to=${encodeURIComponent(to)}&su=${encodeURIComponent(subject)}`, {
          waitUntil: 'networkidle',
          timeout: 45_000,
        });

        await page.waitForTimeout(2000);

        // Check if we're on a login page
        const currentUrl = page.url();
        if (currentUrl.includes('accounts.google.com')) {
          return {
            error: 'Not logged in to Gmail. Please log in manually in the browser profile first.',
            code: 'NOT_LOGGED_IN',
          };
        }

        // Fill the body — Gmail compose uses a contenteditable div
        const bodySelector = 'div[aria-label="Message Body"], div.Am.Al.editable, div[role="textbox"]';
        try {
          await page.waitForSelector(bodySelector, { timeout: 10_000 });
          await page.click(bodySelector);
          await page.keyboard.type(body, { delay: 10 });
        } catch {
          return {
            error: 'Could not find Gmail compose body field. Gmail UI may have changed or page did not load.',
            code: 'COMPOSE_FIELD_NOT_FOUND',
          };
        }

        // Click send button
        const sendSelector = 'div[aria-label*="Send"], div.T-I.J-J5-Ji[role="button"]';
        try {
          await page.waitForSelector(sendSelector, { timeout: 5_000 });
          await page.click(sendSelector);
          await page.waitForTimeout(2000);
        } catch {
          return {
            error: 'Could not find Gmail send button. The email was composed but not sent.',
            code: 'SEND_BUTTON_NOT_FOUND',
          };
        }

        return {
          success: true,
          to,
          subject,
          sentAt: new Date().toISOString(),
          source: 'gmail_browser',
        };
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err), code: 'GMAIL_SEND_ERROR' };
      } finally {
        if (page) {
          try { const { playwrightEngine } = await import('../adapters/browser/playwright-engine.js'); await playwrightEngine.closePage(page); } catch { /* ignore */ }
        }
      }
    },
  );

  // ─── WEBHOOK TOOL ────────────────────────────────────────────────────────

  toolRegistry.register(
    {
      name: 'send_webhook',
      description: 'Send data to an external webhook URL. REQUIRES approval. Cannot be undone. Restricted in most industry packs.',
      category: ToolCategory.WEBHOOK,
      riskClass: ToolRiskClass.EXTERNAL_SIDE_EFFECT,
      requiresApproval: true,
      inputSchema: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'Webhook endpoint URL' },
          payload: { type: 'object', description: 'JSON payload to send' },
          method: { type: 'string', description: 'HTTP method (default: POST)' },
        },
        required: ['url', 'payload'],
      },
      outputSchema: { type: 'object', properties: { statusCode: { type: 'number' } } },
      version: '1.0.0',
    },
    async (input: unknown, _context: ToolExecutionContext) => {
      const { url, payload, method = 'POST' } = input as {
        url: string;
        payload: Record<string, unknown>;
        method?: string;
      };

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      return {
        success: response.ok,
        statusCode: response.status,
        url,
        method,
        sentAt: new Date().toISOString(),
      };
    },
  );

  // ─── MEMORY TOOLS ─────────────────────────────────────────────────────────
  // These connect to the TenantMemory system — used by BaseAgent.persistLearning()
  // and SwarmGraph.persistWorkflowLearning(). Without these, learning is silently skipped.

  toolRegistry.register(
    {
      name: 'memory_store',
      description: 'Store a key-value entry in tenant memory. Used for persisting learnings, preferences, and workflow results.',
      category: ToolCategory.KNOWLEDGE,
      riskClass: ToolRiskClass.WRITE,
      requiresApproval: false,
      inputSchema: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'Memory key (namespaced, e.g. "WORKER_RESEARCH:best_practices")' },
          value: { type: 'object', description: 'Value to store (any JSON-serializable data)' },
          type: { type: 'string', description: 'Memory type: KNOWLEDGE | POLICY | WORKFLOW | USER_PREF' },
          source: { type: 'string', description: 'Source that created this memory' },
        },
        required: ['key', 'value'],
      },
      outputSchema: { type: 'object', properties: { stored: { type: 'boolean' } } },
      version: '1.0.0',
    },
    async (input: unknown, context: ToolExecutionContext) => {
      const { key, value, type = 'KNOWLEDGE', source = 'agent' } = input as {
        key: string; value: unknown; type?: string; source?: string;
      };
      const adapter = getMemoryAdapter();
      await adapter.set(key, value, context.tenantId, { type, source });
      return { stored: true, key, type };
    },
  );

  toolRegistry.register(
    {
      name: 'memory_retrieve',
      description: 'Retrieve a value from tenant memory by key.',
      category: ToolCategory.KNOWLEDGE,
      riskClass: ToolRiskClass.READ_ONLY,
      requiresApproval: false,
      inputSchema: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'Memory key to retrieve' },
        },
        required: ['key'],
      },
      outputSchema: { type: 'object', properties: { value: {} } },
      version: '1.0.0',
    },
    async (input: unknown, context: ToolExecutionContext) => {
      const { key } = input as { key: string };
      const adapter = getMemoryAdapter();
      const result = await adapter.get(key, context.tenantId);
      if (!result) {
        return { found: false, key, value: null };
      }
      return { found: true, key, ...(result as Record<string, unknown>) };
    },
  );

  // ─── FILESYSTEM TOOLS ─────────────────────────────────────────────────────
  // Sandboxed to a configurable workspace directory (JAK_WORKSPACE_DIR env var).
  // If not set, defaults to OS temp directory for safety.

  const getWorkspaceRoot = (): string => {
    return process.env['JAK_WORKSPACE_DIR'] ?? require('os').tmpdir();
  };

  const resolveSafePath = (relativePath: string): string | null => {
    const path = require('path') as typeof import('path');
    const root = getWorkspaceRoot();
    const resolved = path.resolve(root, relativePath);
    // Prevent directory traversal — resolved path must be under workspace root
    if (!resolved.startsWith(root)) return null;
    return resolved;
  };

  toolRegistry.register(
    {
      name: 'file_read',
      description: 'Read a file from the workspace directory. Path is relative to JAK_WORKSPACE_DIR.',
      category: ToolCategory.DOCUMENT,
      riskClass: ToolRiskClass.READ_ONLY,
      requiresApproval: false,
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative file path within the workspace' },
          encoding: { type: 'string', description: 'File encoding (default: utf-8)' },
        },
        required: ['path'],
      },
      outputSchema: { type: 'object', properties: { content: { type: 'string' } } },
      version: '1.0.0',
    },
    async (input: unknown, _context: ToolExecutionContext) => {
      const { path: filePath, encoding = 'utf-8' } = input as { path: string; encoding?: string };
      const fs = require('fs').promises as typeof import('fs').promises;
      const safePath = resolveSafePath(filePath);
      if (!safePath) return { error: 'Path traversal blocked — path must be within workspace directory' };
      try {
        const content = await fs.readFile(safePath, encoding as BufferEncoding);
        const stats = await fs.stat(safePath);
        return { content, path: filePath, size: stats.size, modified: stats.mtime.toISOString() };
      } catch (err) {
        return { error: `File not found or unreadable: ${filePath}`, detail: String(err) };
      }
    },
  );

  toolRegistry.register(
    {
      name: 'file_write',
      description: 'Write content to a file in the workspace directory. Creates parent directories if needed.',
      category: ToolCategory.DOCUMENT,
      riskClass: ToolRiskClass.WRITE,
      requiresApproval: true,
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative file path within the workspace' },
          content: { type: 'string', description: 'Content to write' },
          append: { type: 'boolean', description: 'Append instead of overwrite (default: false)' },
        },
        required: ['path', 'content'],
      },
      outputSchema: { type: 'object', properties: { written: { type: 'boolean' } } },
      version: '1.0.0',
    },
    async (input: unknown, _context: ToolExecutionContext) => {
      const { path: filePath, content, append = false } = input as { path: string; content: string; append?: boolean };
      const fs = require('fs').promises as typeof import('fs').promises;
      const pathMod = require('path') as typeof import('path');
      const safePath = resolveSafePath(filePath);
      if (!safePath) return { error: 'Path traversal blocked — path must be within workspace directory' };
      try {
        await fs.mkdir(pathMod.dirname(safePath), { recursive: true });
        if (append) {
          await fs.appendFile(safePath, content, 'utf-8');
        } else {
          await fs.writeFile(safePath, content, 'utf-8');
        }
        return { written: true, path: filePath, bytes: Buffer.byteLength(content, 'utf-8') };
      } catch (err) {
        return { error: `Failed to write file: ${filePath}`, detail: String(err) };
      }
    },
  );

  toolRegistry.register(
    {
      name: 'list_directory',
      description: 'List files and subdirectories in a workspace directory.',
      category: ToolCategory.DOCUMENT,
      riskClass: ToolRiskClass.READ_ONLY,
      requiresApproval: false,
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative directory path (default: workspace root)' },
          recursive: { type: 'boolean', description: 'List recursively (default: false)' },
        },
      },
      outputSchema: { type: 'object', properties: { entries: { type: 'array' } } },
      version: '1.0.0',
    },
    async (input: unknown, _context: ToolExecutionContext) => {
      const { path: dirPath = '.', recursive = false } = (input as { path?: string; recursive?: boolean }) ?? {};
      const fs = require('fs').promises as typeof import('fs').promises;
      const pathMod = require('path') as typeof import('path');
      const safePath = resolveSafePath(dirPath);
      if (!safePath) return { error: 'Path traversal blocked' };
      try {
        const entries = await fs.readdir(safePath, { withFileTypes: true });
        const result = entries.map(e => ({
          name: e.name,
          type: e.isDirectory() ? 'directory' : 'file',
          path: pathMod.join(dirPath, e.name),
        }));

        if (recursive) {
          const dirs = result.filter(e => e.type === 'directory');
          for (const dir of dirs) {
            try {
              const subEntries = await fs.readdir(pathMod.join(safePath, dir.name), { withFileTypes: true });
              result.push(...subEntries.map(e => ({
                name: e.name,
                type: e.isDirectory() ? 'directory' as const : 'file' as const,
                path: pathMod.join(dir.path, e.name),
              })));
            } catch { /* skip unreadable subdirs */ }
          }
        }
        return { entries: result, count: result.length, path: dirPath };
      } catch (err) {
        return { error: `Cannot read directory: ${dirPath}`, detail: String(err) };
      }
    },
  );

  // ─── CODE EXECUTION TOOL ──────────────────────────────────────────────────
  // Sandboxed JavaScript execution using Node.js vm module.
  // Python execution via child_process if python3 is available.

  toolRegistry.register(
    {
      name: 'code_execute',
      description: 'Execute code in a sandboxed environment. Supports JavaScript (via Node.js vm) and Python (via subprocess). Returns stdout, stderr, and result.',
      category: ToolCategory.RESEARCH,
      riskClass: ToolRiskClass.WRITE,
      requiresApproval: true,
      inputSchema: {
        type: 'object',
        properties: {
          language: { type: 'string', description: 'Programming language: javascript | python' },
          code: { type: 'string', description: 'Code to execute' },
          timeoutMs: { type: 'number', description: 'Execution timeout in milliseconds (default: 10000)' },
        },
        required: ['language', 'code'],
      },
      outputSchema: {
        type: 'object',
        properties: {
          stdout: { type: 'string' },
          stderr: { type: 'string' },
          result: {},
          executionTimeMs: { type: 'number' },
        },
      },
      version: '1.0.0',
    },
    async (input: unknown, _context: ToolExecutionContext) => {
      const { language, code, timeoutMs = 10_000 } = input as {
        language: string; code: string; timeoutMs?: number;
      };
      const startTime = Date.now();

      if (language === 'javascript' || language === 'js') {
        const vm = require('vm') as typeof import('vm');
        const logs: string[] = [];
        const errors: string[] = [];
        const sandbox = {
          console: {
            log: (...args: unknown[]) => logs.push(args.map(String).join(' ')),
            error: (...args: unknown[]) => errors.push(args.map(String).join(' ')),
            warn: (...args: unknown[]) => logs.push(`[warn] ${args.map(String).join(' ')}`),
          },
          Math, Date, JSON, Array, Object, String, Number, Boolean,
          parseInt, parseFloat, isNaN, isFinite,
          setTimeout: undefined, setInterval: undefined, // blocked
          require: undefined, process: undefined, // blocked
        };
        try {
          const script = new vm.Script(code);
          const context = vm.createContext(sandbox);
          const result = script.runInContext(context, { timeout: timeoutMs });
          return {
            stdout: logs.join('\n'),
            stderr: errors.join('\n'),
            result: result !== undefined ? String(result) : null,
            executionTimeMs: Date.now() - startTime,
            language: 'javascript',
          };
        } catch (err) {
          return {
            stdout: logs.join('\n'),
            stderr: err instanceof Error ? err.message : String(err),
            result: null,
            executionTimeMs: Date.now() - startTime,
            language: 'javascript',
            error: true,
          };
        }
      }

      if (language === 'python' || language === 'py') {
        const { execFile } = require('child_process') as typeof import('child_process');
        return new Promise((resolve) => {
          const proc = execFile(
            'python3', ['-c', code],
            { timeout: timeoutMs, maxBuffer: 1024 * 1024 },
            (err, stdout, stderr) => {
              resolve({
                stdout: stdout ?? '',
                stderr: (stderr ?? '') + (err ? `\n${err.message}` : ''),
                result: null,
                executionTimeMs: Date.now() - startTime,
                language: 'python',
                error: !!err,
              });
            },
          );
          // Safety: kill if it somehow exceeds timeout
          setTimeout(() => { try { proc.kill('SIGKILL'); } catch {} }, timeoutMs + 1000);
        });
      }

      return {
        error: `Unsupported language: ${language}. Supported: javascript, python`,
        executionTimeMs: Date.now() - startTime,
      };
    },
  );

  // ─── MISSING AGENT-REFERENCED TOOLS ───────────────────────────────────────
  // Tools referenced by specific worker agents but not previously registered.
  // These are honest pass-through stubs that return the input data for LLM processing.

  toolRegistry.register(
    {
      name: 'find_availability',
      description: 'Find available time slots across calendars.',
      category: ToolCategory.CALENDAR,
      riskClass: ToolRiskClass.READ_ONLY,
      requiresApproval: false,
      inputSchema: { type: 'object', properties: { attendees: { type: 'array' }, dateRange: { type: 'object' } } },
      outputSchema: { type: 'object' },
      version: '1.0.0',
    },
    async (input: unknown, _context: ToolExecutionContext) => {
      return { ...input as Record<string, unknown>, message: 'Calendar not connected. Suggest time slots based on general business hours.', connected: false };
    },
  );

  toolRegistry.register(
    {
      name: 'search_deals',
      description: 'Search CRM deals and pipeline opportunities.',
      category: ToolCategory.CRM,
      riskClass: ToolRiskClass.READ_ONLY,
      requiresApproval: false,
      inputSchema: { type: 'object', properties: { query: { type: 'string' }, status: { type: 'string' } }, required: ['query'] },
      outputSchema: { type: 'object' },
      version: '1.0.0',
    },
    async (input: unknown, _context: ToolExecutionContext) => {
      return { ...input as Record<string, unknown>, deals: [], message: 'CRM not connected. No deal data available.', connected: false };
    },
  );

  toolRegistry.register(
    {
      name: 'classify_ticket',
      description: 'Classify a support ticket by category, priority, and sentiment.',
      category: ToolCategory.RESEARCH,
      riskClass: ToolRiskClass.READ_ONLY,
      requiresApproval: false,
      inputSchema: { type: 'object', properties: { content: { type: 'string' } }, required: ['content'] },
      outputSchema: { type: 'object' },
      version: '1.0.0',
    },
    async (input: unknown, _context: ToolExecutionContext) => {
      const { content } = input as { content: string };
      return { content: content.slice(0, 2000), message: 'Classify this ticket based on the content provided.', toolType: 'llm_passthrough' };
    },
  );

  toolRegistry.register(
    {
      name: 'lookup_customer',
      description: 'Look up customer information by email or ID.',
      category: ToolCategory.CRM,
      riskClass: ToolRiskClass.READ_ONLY,
      requiresApproval: false,
      inputSchema: { type: 'object', properties: { email: { type: 'string' }, customerId: { type: 'string' } } },
      outputSchema: { type: 'object' },
      version: '1.0.0',
    },
    async (input: unknown, _context: ToolExecutionContext) => {
      return { ...input as Record<string, unknown>, customer: null, message: 'CRM not connected. No customer data available.', connected: false };
    },
  );

  toolRegistry.register(
    {
      name: 'search_knowledge_base',
      description: 'Search the support knowledge base for solutions and articles.',
      category: ToolCategory.KNOWLEDGE,
      riskClass: ToolRiskClass.READ_ONLY,
      requiresApproval: false,
      inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
      outputSchema: { type: 'object' },
      version: '1.0.0',
    },
    async (input: unknown, _context: ToolExecutionContext) => {
      const { query } = input as { query: string };
      return { query, results: [], message: 'Knowledge base not connected. Use your built-in knowledge to help the customer.', connected: false };
    },
  );

  // ─── GROWTH ENGINE TOOLS ──────────────────────────────────────────────────
  // Lead enrichment, SEO, email sequences, retention, and social signal tools.
  // All FREE — powered by web search, heuristics, and in-memory storage.

  // 1. enrich_contact — web-search-based contact enrichment
  toolRegistry.register(
    {
      name: 'enrich_contact',
      description: 'Enrich a contact by searching the web for their professional info (LinkedIn, title, company details). FREE — web search based.',
      category: ToolCategory.CRM,
      riskClass: ToolRiskClass.READ_ONLY,
      requiresApproval: false,
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Contact full name' },
          company: { type: 'string', description: 'Company name' },
          role: { type: 'string', description: 'Optional known role or title' },
        },
        required: ['name', 'company'],
      },
      outputSchema: { type: 'object' },
      version: '1.0.0',
    },
    async (input: unknown, _context: ToolExecutionContext) => {
      try {
        const { name, company, role } = input as { name: string; company: string; role?: string };
        const query = `${name} ${company} LinkedIn${role ? ' ' + role : ''}`;
        const { results } = await searchDuckDuckGo(query, 5);
        const linkedinResult = results.find(r => r.url.includes('linkedin.com'));
        return {
          name,
          company,
          title: role ?? null,
          linkedin: linkedinResult?.url ?? null,
          email: null,
          phone: null,
          searchResults: results.slice(0, 3).map(r => ({ title: r.title, url: r.url, snippet: r.snippet })),
          source: 'web_search',
          message: `Found ${results.length} results for "${name} ${company}". Review search results to extract professional details.`,
        };
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    },
  );

  // 2. enrich_company — web-search-based company enrichment
  toolRegistry.register(
    {
      name: 'enrich_company',
      description: 'Enrich a company profile by searching for funding, employee count, tech stack, and news. FREE — web search based.',
      category: ToolCategory.CRM,
      riskClass: ToolRiskClass.READ_ONLY,
      requiresApproval: false,
      inputSchema: {
        type: 'object',
        properties: {
          company: { type: 'string', description: 'Company name' },
        },
        required: ['company'],
      },
      outputSchema: { type: 'object' },
      version: '1.0.0',
    },
    async (input: unknown, _context: ToolExecutionContext) => {
      try {
        const { company } = input as { company: string };
        const { results } = await searchDuckDuckGo(`${company} about funding employees`, 5);
        const contentSnippets = results.map(r => r.snippet).join(' ');
        return {
          name: company,
          domain: null,
          industry: null,
          employeeCount: null,
          fundingStage: null,
          recentNews: results.slice(0, 3).map(r => ({ title: r.title, url: r.url, snippet: r.snippet })),
          techStack: [],
          searchContent: contentSnippets.slice(0, 2000),
          source: 'web_search',
          message: `Found ${results.length} results for "${company}". Parse the search content to extract company details.`,
        };
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    },
  );

  // 3. verify_email — regex + DNS MX record check, completely FREE
  toolRegistry.register(
    {
      name: 'verify_email',
      description: 'Verify an email address using format validation and DNS MX record lookup. Completely FREE, no API needed.',
      category: ToolCategory.CRM,
      riskClass: ToolRiskClass.READ_ONLY,
      requiresApproval: false,
      inputSchema: {
        type: 'object',
        properties: {
          email: { type: 'string', description: 'Email address to verify' },
        },
        required: ['email'],
      },
      outputSchema: { type: 'object' },
      version: '1.0.0',
    },
    async (input: unknown, _context: ToolExecutionContext) => {
      try {
        const { email } = input as { email: string };
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        const formatValid = emailRegex.test(email);
        if (!formatValid) {
          return { email, valid: false, hasMxRecord: false, domain: null, reason: 'Invalid email format' };
        }
        const domain = email.split('@')[1]!;
        let hasMxRecord = false;
        let provider: string | null = null;
        try {
          const dns = require('dns') as typeof import('dns');
          const mxRecords = await dns.promises.resolveMx(domain);
          hasMxRecord = mxRecords.length > 0;
          if (hasMxRecord) {
            const topMx = mxRecords.sort((a, b) => a.priority - b.priority)[0]!.exchange.toLowerCase();
            if (topMx.includes('google') || topMx.includes('gmail')) provider = 'Google Workspace';
            else if (topMx.includes('outlook') || topMx.includes('microsoft')) provider = 'Microsoft 365';
            else if (topMx.includes('zoho')) provider = 'Zoho';
            else if (topMx.includes('proton')) provider = 'ProtonMail';
          }
        } catch {
          hasMxRecord = false;
        }
        return { email, valid: formatValid && hasMxRecord, hasMxRecord, domain, provider };
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    },
  );

  // 4. score_lead — heuristic lead scoring
  toolRegistry.register(
    {
      name: 'score_lead',
      description: 'Score a lead using heuristic rules based on title, company size, funding, and activity signals. Returns 0-100 score with tier.',
      category: ToolCategory.CRM,
      riskClass: ToolRiskClass.READ_ONLY,
      requiresApproval: false,
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Job title' },
          company: { type: 'string', description: 'Company name' },
          employeeCount: { type: 'number', description: 'Number of employees' },
          fundingStage: { type: 'string', description: 'Funding stage (seed, series_a, etc.)' },
          recentActivity: { type: 'string', description: 'Recent activity description' },
          signals: { type: 'array', items: { type: 'string' }, description: 'Additional signals' },
        },
      },
      outputSchema: { type: 'object' },
      version: '1.0.0',
    },
    async (input: unknown, _context: ToolExecutionContext) => {
      try {
        const { title, employeeCount, fundingStage, recentActivity, signals = [] } = input as {
          title?: string; company?: string; employeeCount?: number; fundingStage?: string;
          recentActivity?: string; signals?: string[];
        };
        let score = 0;
        const factors: string[] = [];
        const t = (title ?? '').toLowerCase();
        if (/\b(ceo|cto|cfo|coo|cmo|cro|founder|co-founder|chief|c-level)\b/.test(t)) { score += 25; factors.push('C-level/Founder title (+25)'); }
        else if (/\b(vp|vice president)\b/.test(t)) { score += 25; factors.push('VP title (+25)'); }
        else if (/\b(director)\b/.test(t)) { score += 15; factors.push('Director title (+15)'); }
        else if (/\b(manager|head)\b/.test(t)) { score += 10; factors.push('Manager/Head title (+10)'); }
        if (employeeCount && employeeCount >= 50 && employeeCount <= 500) { score += 20; factors.push('Company 50-500 employees (+20)'); }
        else if (employeeCount && employeeCount > 500 && employeeCount <= 5000) { score += 15; factors.push('Company 500-5000 employees (+15)'); }
        if (fundingStage) {
          const fs = fundingStage.toLowerCase();
          if (fs.includes('series') || fs.includes('growth') || fs.includes('ipo')) { score += 20; factors.push('Recent/active funding (+20)'); }
          else if (fs.includes('seed') || fs.includes('pre-seed')) { score += 10; factors.push('Early-stage funding (+10)'); }
        }
        if (recentActivity) { score += 10; factors.push('Recent activity detected (+10)'); }
        if (signals.length > 0) { score += Math.min(signals.length * 5, 15); factors.push(`${signals.length} signal(s) (+${Math.min(signals.length * 5, 15)})`); }
        score = Math.min(score, 100);
        const tier = score >= 70 ? 'hot' : score >= 40 ? 'warm' : 'cold';
        return { score, factors, tier };
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    },
  );

  // 5. deduplicate_contacts — Levenshtein-based deduplication
  toolRegistry.register(
    {
      name: 'deduplicate_contacts',
      description: 'Deduplicate a list of contacts using fuzzy name and email matching (Levenshtein distance).',
      category: ToolCategory.CRM,
      riskClass: ToolRiskClass.READ_ONLY,
      requiresApproval: false,
      inputSchema: {
        type: 'object',
        properties: {
          contacts: {
            type: 'array',
            items: {
              type: 'object',
              properties: { name: { type: 'string' }, email: { type: 'string' }, company: { type: 'string' } },
            },
            description: 'Array of contacts to deduplicate',
          },
        },
        required: ['contacts'],
      },
      outputSchema: { type: 'object' },
      version: '1.0.0',
    },
    async (input: unknown, _context: ToolExecutionContext) => {
      try {
        const { contacts } = input as { contacts: Array<{ name: string; email: string; company: string }> };
        // Simple Levenshtein distance
        function levenshtein(a: string, b: string): number {
          const m = a.length, n = b.length;
          const dp: number[][] = Array.from({ length: m + 1 }, (_, i) => {
            const row = new Array<number>(n + 1);
            row[0] = i;
            return row;
          });
          for (let j = 0; j <= n; j++) dp[0]![j] = j;
          for (let i = 1; i <= m; i++) {
            for (let j = 1; j <= n; j++) {
              dp[i]![j] = a[i - 1] === b[j - 1]
                ? dp[i - 1]![j - 1]!
                : 1 + Math.min(dp[i - 1]![j]!, dp[i]![j - 1]!, dp[i - 1]![j - 1]!);
            }
          }
          return dp[m]![n]!;
        }
        const groups: Array<{ canonical: typeof contacts[0]; duplicates: typeof contacts }> = [];
        const assigned = new Set<number>();
        for (let i = 0; i < contacts.length; i++) {
          if (assigned.has(i)) continue;
          const group = { canonical: contacts[i]!, duplicates: [] as typeof contacts };
          assigned.add(i);
          for (let j = i + 1; j < contacts.length; j++) {
            if (assigned.has(j)) continue;
            const nameA = (contacts[i]!.name ?? '').toLowerCase();
            const nameB = (contacts[j]!.name ?? '').toLowerCase();
            const emailA = (contacts[i]!.email ?? '').toLowerCase();
            const emailB = (contacts[j]!.email ?? '').toLowerCase();
            const nameDist = levenshtein(nameA, nameB);
            const emailMatch = emailA && emailB && emailA === emailB;
            const nameSimilar = nameA.length > 0 && nameB.length > 0 && nameDist <= Math.max(2, Math.floor(nameA.length * 0.3));
            if (emailMatch || nameSimilar) {
              group.duplicates.push(contacts[j]!);
              assigned.add(j);
            }
          }
          groups.push(group);
        }
        const deduplicatedCount = contacts.length - groups.length;
        return { groups, deduplicatedCount, originalCount: contacts.length, uniqueCount: groups.length };
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    },
  );

  // 6. audit_seo — on-page SEO audit via URL fetch + HTML parse
  toolRegistry.register(
    {
      name: 'audit_seo',
      description: 'Perform an on-page SEO audit of a URL. Checks title, meta description, headings, images, mobile viewport, canonical, and schema markup.',
      category: ToolCategory.RESEARCH,
      riskClass: ToolRiskClass.READ_ONLY,
      requiresApproval: false,
      inputSchema: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL to audit' },
        },
        required: ['url'],
      },
      outputSchema: { type: 'object' },
      version: '1.0.0',
    },
    async (input: unknown, _context: ToolExecutionContext) => {
      try {
        const { url } = input as { url: string };
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);
        const response = await fetch(url, {
          signal: controller.signal,
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        });
        clearTimeout(timeout);
        if (!response.ok) return { error: `HTTP ${response.status}`, url };
        const html = await response.text();
        const issues: string[] = [];
        const passed: string[] = [];
        const recommendations: string[] = [];
        let score = 100;

        // Title tag
        const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
        const title = titleMatch?.[1]?.trim() ?? '';
        if (!title) { issues.push('Missing title tag'); score -= 15; recommendations.push('Add a descriptive title tag (50-60 characters)'); }
        else if (title.length < 30 || title.length > 70) { issues.push(`Title length ${title.length} chars (ideal: 50-60)`); score -= 5; }
        else { passed.push(`Title tag present (${title.length} chars)`); }

        // Meta description
        const metaDescMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']*)["']/i)
          ?? html.match(/<meta[^>]*content=["']([^"']*)["'][^>]*name=["']description["']/i);
        const metaDesc = metaDescMatch?.[1]?.trim() ?? '';
        if (!metaDesc) { issues.push('Missing meta description'); score -= 10; recommendations.push('Add a meta description (150-160 characters)'); }
        else if (metaDesc.length < 120 || metaDesc.length > 170) { issues.push(`Meta description length ${metaDesc.length} chars (ideal: 150-160)`); score -= 3; }
        else { passed.push(`Meta description present (${metaDesc.length} chars)`); }

        // H1 count
        const h1Matches = html.match(/<h1[\s>]/gi);
        const h1Count = h1Matches?.length ?? 0;
        if (h1Count === 0) { issues.push('No H1 tag found'); score -= 10; recommendations.push('Add exactly one H1 tag'); }
        else if (h1Count > 1) { issues.push(`Multiple H1 tags found (${h1Count})`); score -= 5; recommendations.push('Use only one H1 tag per page'); }
        else { passed.push('Single H1 tag present'); }

        // Image alt text
        const imgTags = html.match(/<img[^>]*>/gi) ?? [];
        const imgWithoutAlt = imgTags.filter(img => !img.match(/alt=["'][^"']+["']/i)).length;
        if (imgTags.length > 0 && imgWithoutAlt > 0) {
          issues.push(`${imgWithoutAlt}/${imgTags.length} images missing alt text`);
          score -= Math.min(imgWithoutAlt * 2, 10);
          recommendations.push('Add descriptive alt text to all images');
        } else if (imgTags.length > 0) { passed.push(`All ${imgTags.length} images have alt text`); }

        // Viewport meta (mobile)
        const hasViewport = /<meta[^>]*name=["']viewport["']/i.test(html);
        if (!hasViewport) { issues.push('Missing viewport meta tag (not mobile-friendly)'); score -= 10; recommendations.push('Add <meta name="viewport" content="width=device-width, initial-scale=1">'); }
        else { passed.push('Viewport meta tag present'); }

        // Canonical URL
        const hasCanonical = /<link[^>]*rel=["']canonical["']/i.test(html);
        if (!hasCanonical) { issues.push('Missing canonical URL'); score -= 5; recommendations.push('Add a canonical link element'); }
        else { passed.push('Canonical URL present'); }

        // Schema/JSON-LD
        const hasJsonLd = /<script[^>]*type=["']application\/ld\+json["']/i.test(html);
        if (!hasJsonLd) { issues.push('No structured data (JSON-LD) found'); score -= 5; recommendations.push('Add JSON-LD structured data for rich search results'); }
        else { passed.push('JSON-LD structured data present'); }

        score = Math.max(score, 0);
        return { url, score, issues, passed, recommendations, title: title.slice(0, 100), metaDescriptionLength: metaDesc.length, h1Count, imageCount: imgTags.length };
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    },
  );

  // 7. research_keywords — Google Autocomplete (FREE)
  toolRegistry.register(
    {
      name: 'research_keywords',
      description: 'Research keywords using Google Autocomplete suggestions. FREE — no API key needed.',
      category: ToolCategory.RESEARCH,
      riskClass: ToolRiskClass.READ_ONLY,
      requiresApproval: false,
      inputSchema: {
        type: 'object',
        properties: {
          seed_keyword: { type: 'string', description: 'Seed keyword to expand' },
          market: { type: 'string', description: 'Optional target market/language' },
        },
        required: ['seed_keyword'],
      },
      outputSchema: { type: 'object' },
      version: '1.0.0',
    },
    async (input: unknown, _context: ToolExecutionContext) => {
      try {
        const { seed_keyword } = input as { seed_keyword: string; market?: string };
        const fetchSuggestions = async (q: string): Promise<string[]> => {
          try {
            const resp = await fetch(`https://suggestqueries.google.com/complete/search?q=${encodeURIComponent(q)}&client=firefox`, {
              headers: { 'User-Agent': 'Mozilla/5.0' },
            });
            if (!resp.ok) return [];
            const data = await resp.json() as [string, string[]];
            return data[1] ?? [];
          } catch { return []; }
        };
        const [base, vs, forQ, howTo] = await Promise.all([
          fetchSuggestions(seed_keyword),
          fetchSuggestions(`${seed_keyword} vs`),
          fetchSuggestions(`${seed_keyword} for`),
          fetchSuggestions(`${seed_keyword} how to`),
        ]);
        const allSuggestions = [...new Set([...base, ...vs, ...forQ, ...howTo])];
        const intent = howTo.length > vs.length ? 'informational' : vs.length > 0 ? 'transactional' : 'navigational';
        return {
          keyword: seed_keyword,
          suggestions: base,
          relatedQueries: allSuggestions.filter(s => !base.includes(s)),
          vsQueries: vs,
          forQueries: forQ,
          howToQueries: howTo,
          intent,
          totalSuggestions: allSuggestions.length,
        };
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    },
  );

  // 8. analyze_serp — search + content analysis for top results
  toolRegistry.register(
    {
      name: 'analyze_serp',
      description: 'Analyze SERP (Search Engine Results Page) for a keyword. Fetches top results, analyzes word count, headings, and content type.',
      category: ToolCategory.RESEARCH,
      riskClass: ToolRiskClass.READ_ONLY,
      requiresApproval: false,
      inputSchema: {
        type: 'object',
        properties: {
          keyword: { type: 'string', description: 'Keyword to analyze SERP for' },
        },
        required: ['keyword'],
      },
      outputSchema: { type: 'object' },
      version: '1.0.0',
    },
    async (input: unknown, _context: ToolExecutionContext) => {
      try {
        const { keyword } = input as { keyword: string };
        const { results: searchResults } = await searchDuckDuckGo(keyword, 5);
        const analyzed = [];
        let totalWords = 0;
        for (const result of searchResults.slice(0, 5)) {
          const content = await fetchPageContent(result.url, 5000);
          const wordCount = content.split(/\s+/).filter(Boolean).length;
          totalWords += wordCount;
          analyzed.push({
            title: result.title,
            url: result.url,
            wordCount,
            snippet: result.snippet,
          });
        }
        const avgWordCount = analyzed.length > 0 ? Math.round(totalWords / analyzed.length) : 0;
        return {
          keyword,
          results: analyzed,
          avgWordCount,
          contentGaps: [],
          opportunities: avgWordCount > 0
            ? [`Target ${Math.round(avgWordCount * 1.2)} words to exceed average`, 'Include unique data or case studies']
            : [],
          resultCount: analyzed.length,
        };
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    },
  );

  // 9. monitor_rankings — track keyword position over time
  toolRegistry.register(
    {
      name: 'monitor_rankings',
      description: 'Monitor search ranking position for a keyword/URL pair. Stores history in memory for trend tracking.',
      category: ToolCategory.RESEARCH,
      riskClass: ToolRiskClass.READ_ONLY,
      requiresApproval: false,
      inputSchema: {
        type: 'object',
        properties: {
          keyword: { type: 'string', description: 'Keyword to check ranking for' },
          targetUrl: { type: 'string', description: 'Target URL to find in results' },
        },
        required: ['keyword', 'targetUrl'],
      },
      outputSchema: { type: 'object' },
      version: '1.0.0',
    },
    async (input: unknown, context: ToolExecutionContext) => {
      try {
        const { keyword, targetUrl } = input as { keyword: string; targetUrl: string };
        const { results } = await searchDuckDuckGo(keyword, 20);
        let position: number | null = null;
        const targetDomain = new URL(targetUrl).hostname.replace('www.', '');
        for (let i = 0; i < results.length; i++) {
          try {
            const resultDomain = new URL(results[i]!.url).hostname.replace('www.', '');
            if (resultDomain === targetDomain || results[i]!.url.includes(targetUrl)) {
              position = i + 1;
              break;
            }
          } catch { /* skip bad URLs */ }
        }
        // Store in memory for historical tracking
        const memKey = `ranking:${keyword}:${targetDomain}`;
        const adapter = getMemoryAdapter();
        let previousPosition: number | null = null;
        try {
          const prev = await adapter.get(memKey, context.tenantId) as { position?: number } | null;
          previousPosition = prev?.position ?? null;
        } catch { /* no previous data */ }
        await adapter.set(memKey, { position, timestamp: new Date().toISOString() }, context.tenantId, { type: 'KNOWLEDGE', source: 'monitor_rankings' });
        const change = previousPosition !== null && position !== null ? previousPosition - position : null;
        return { keyword, targetUrl, position, previousPosition, change, totalResultsChecked: results.length };
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    },
  );

  // 10. create_email_sequence — store an email sequence in memory
  toolRegistry.register(
    {
      name: 'create_email_sequence',
      description: 'Create an email drip sequence with multiple steps, delays, and conditions. Stored in memory for orchestration.',
      category: ToolCategory.EMAIL,
      riskClass: ToolRiskClass.WRITE,
      requiresApproval: false,
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Sequence name' },
          steps: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                delayDays: { type: 'number' },
                subject: { type: 'string' },
                bodyTemplate: { type: 'string' },
                condition: { type: 'string' },
              },
            },
            description: 'Sequence steps with delay, subject, body template, and optional condition',
          },
        },
        required: ['name', 'steps'],
      },
      outputSchema: { type: 'object' },
      version: '1.0.0',
    },
    async (input: unknown, context: ToolExecutionContext) => {
      try {
        const { name, steps } = input as { name: string; steps: Array<{ delayDays: number; subject: string; bodyTemplate: string; condition?: string }> };
        const sequenceId = `seq_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const totalDays = steps.reduce((sum, s) => sum + (s.delayDays ?? 0), 0);
        const adapter = getMemoryAdapter();
        await adapter.set(`sequence:${sequenceId}`, { name, steps, createdAt: new Date().toISOString() }, context.tenantId, { type: 'WORKFLOW', source: 'create_email_sequence' });
        return { sequenceId, name, stepCount: steps.length, estimatedDuration: `${totalDays} days`, createdAt: new Date().toISOString() };
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    },
  );

  // 11. personalize_email — template variable replacement
  toolRegistry.register(
    {
      name: 'personalize_email',
      description: 'Personalize an email template by replacing {{variables}} with contact data. Returns personalization score.',
      category: ToolCategory.EMAIL,
      riskClass: ToolRiskClass.READ_ONLY,
      requiresApproval: false,
      inputSchema: {
        type: 'object',
        properties: {
          template: { type: 'string', description: 'Email template with {{variable}} placeholders' },
          contactData: { type: 'object', description: 'Contact data object with name, company, title, etc.' },
        },
        required: ['template', 'contactData'],
      },
      outputSchema: { type: 'object' },
      version: '1.0.0',
    },
    async (input: unknown, _context: ToolExecutionContext) => {
      try {
        const { template, contactData } = input as { template: string; contactData: Record<string, string> };
        let body = template;
        let replacedCount = 0;
        const totalVars = (template.match(/\{\{[^}]+\}\}/g) ?? []).length;
        for (const [key, value] of Object.entries(contactData)) {
          const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'gi');
          if (regex.test(body)) {
            replacedCount++;
            body = body.replace(regex, value);
          }
        }
        const unreplaced = body.match(/\{\{[^}]+\}\}/g) ?? [];
        const personalizationScore = totalVars > 0 ? Math.round((replacedCount / totalVars) * 100) : 100;
        // Extract subject if template starts with "Subject: ..."
        const subjectMatch = body.match(/^Subject:\s*(.+?)[\r\n]/i);
        const subject = subjectMatch?.[1]?.trim() ?? null;
        const bodyContent = subject ? body.replace(/^Subject:\s*.+?[\r\n]+/i, '').trim() : body;
        return { subject, body: bodyContent, personalizationScore, replacedCount, unreplacedVars: unreplaced };
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    },
  );

  // 12. schedule_email — calculate optimal send time
  toolRegistry.register(
    {
      name: 'schedule_email',
      description: 'Schedule an email for optimal send time (Tue-Thu 9-11am). Does NOT send — creates a schedule entry in memory.',
      category: ToolCategory.EMAIL,
      riskClass: ToolRiskClass.WRITE,
      requiresApproval: false,
      inputSchema: {
        type: 'object',
        properties: {
          to: { type: 'string', description: 'Recipient email' },
          subject: { type: 'string', description: 'Email subject' },
          body: { type: 'string', description: 'Email body' },
          preferredTime: { type: 'string', description: 'Preferred send time (ISO)' },
          timezone: { type: 'string', description: 'Recipient timezone (e.g., America/New_York)' },
        },
        required: ['to', 'subject', 'body'],
      },
      outputSchema: { type: 'object' },
      version: '1.0.0',
    },
    async (input: unknown, context: ToolExecutionContext) => {
      try {
        const { to, subject, body, timezone = 'UTC' } = input as { to: string; subject: string; body: string; preferredTime?: string; timezone?: string };
        // Calculate next optimal send window: Tue-Thu 9-11am
        const now = new Date();
        const scheduled = new Date(now);
        // Move to next Tue/Wed/Thu
        const day = scheduled.getUTCDay();
        const daysToNext = day <= 2 ? 2 - day : day <= 4 ? 0 : 9 - day;
        scheduled.setUTCDate(scheduled.getUTCDate() + (daysToNext || 1));
        scheduled.setUTCHours(9 + Math.floor(Math.random() * 2), Math.floor(Math.random() * 60), 0, 0);
        const scheduleId = `sched_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const adapter = getMemoryAdapter();
        await adapter.set(`email_schedule:${scheduleId}`, { to, subject, body, scheduledAt: scheduled.toISOString(), timezone }, context.tenantId, { type: 'WORKFLOW', source: 'schedule_email' });
        return { scheduleId, scheduledAt: scheduled.toISOString(), timezone, reason: 'Scheduled for Tue-Thu 9-11am window for optimal open rates', to, subject };
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    },
  );

  // 13. track_email_engagement — store email engagement events
  toolRegistry.register(
    {
      name: 'track_email_engagement',
      description: 'Track an email engagement event (sent, opened, clicked, replied, bounced). Stored in memory for analytics.',
      category: ToolCategory.EMAIL,
      riskClass: ToolRiskClass.WRITE,
      requiresApproval: false,
      inputSchema: {
        type: 'object',
        properties: {
          emailId: { type: 'string', description: 'Email identifier' },
          event: { type: 'string', description: 'Event type: sent, opened, clicked, replied, bounced' },
        },
        required: ['emailId', 'event'],
      },
      outputSchema: { type: 'object' },
      version: '1.0.0',
    },
    async (input: unknown, context: ToolExecutionContext) => {
      try {
        const { emailId, event } = input as { emailId: string; event: string };
        const timestamp = new Date().toISOString();
        const adapter = getMemoryAdapter();
        const key = `email_event:${emailId}:${event}:${Date.now()}`;
        await adapter.set(key, { emailId, event, timestamp }, context.tenantId, { type: 'KNOWLEDGE', source: 'track_email_engagement' });
        return { tracked: true, emailId, event, timestamp };
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    },
  );

  // 14. analyze_engagement — compute engagement score from events
  toolRegistry.register(
    {
      name: 'analyze_engagement',
      description: 'Analyze customer engagement from event data. Computes frequency, recency, trend, and risk level.',
      category: ToolCategory.CRM,
      riskClass: ToolRiskClass.READ_ONLY,
      requiresApproval: false,
      inputSchema: {
        type: 'object',
        properties: {
          events: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                type: { type: 'string' },
                timestamp: { type: 'string' },
                value: { type: 'number' },
              },
            },
            description: 'Array of engagement events with type, timestamp, and optional value',
          },
        },
        required: ['events'],
      },
      outputSchema: { type: 'object' },
      version: '1.0.0',
    },
    async (input: unknown, _context: ToolExecutionContext) => {
      try {
        const { events } = input as { events: Array<{ type: string; timestamp: string; value?: number }> };
        if (events.length === 0) return { score: 0, trend: 'stable', riskLevel: 'critical', insights: ['No engagement events found'] };
        const now = Date.now();
        const timestamps = events.map(e => new Date(e.timestamp).getTime()).filter(t => !isNaN(t)).sort((a, b) => a - b);
        const mostRecent = timestamps[timestamps.length - 1] ?? now;
        const daysSinceLastEvent = Math.floor((now - mostRecent) / (1000 * 60 * 60 * 24));
        const oneWeekAgo = now - 7 * 24 * 60 * 60 * 1000;
        const eventsLastWeek = timestamps.filter(t => t >= oneWeekAgo).length;
        // Score calculation
        let score = 50;
        score += Math.min(eventsLastWeek * 10, 30); // frequency bonus
        score -= Math.min(daysSinceLastEvent * 5, 40); // recency penalty
        score = Math.max(0, Math.min(100, score));
        // Trend: compare first half vs second half
        const mid = Math.floor(timestamps.length / 2);
        const firstHalf = timestamps.slice(0, mid).length;
        const secondHalf = timestamps.slice(mid).length;
        const trend = secondHalf > firstHalf * 1.2 ? 'increasing' : secondHalf < firstHalf * 0.8 ? 'decreasing' : 'stable';
        const riskLevel = score >= 70 ? 'low' : score >= 50 ? 'medium' : score >= 30 ? 'high' : 'critical';
        const insights: string[] = [];
        if (daysSinceLastEvent > 14) insights.push(`No activity in ${daysSinceLastEvent} days`);
        if (eventsLastWeek === 0) insights.push('Zero events in the past week');
        if (trend === 'decreasing') insights.push('Engagement trending downward');
        if (trend === 'increasing') insights.push('Engagement trending upward');
        return { score, trend, riskLevel, insights, eventsLastWeek, daysSinceLastEvent, totalEvents: events.length };
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    },
  );

  // 15. predict_churn — weighted churn probability scoring
  toolRegistry.register(
    {
      name: 'predict_churn',
      description: 'Predict churn probability using weighted scoring of engagement, login recency, support tickets, billing issues, and tenure.',
      category: ToolCategory.CRM,
      riskClass: ToolRiskClass.READ_ONLY,
      requiresApproval: false,
      inputSchema: {
        type: 'object',
        properties: {
          engagementScore: { type: 'number', description: 'Engagement score 0-100' },
          daysSinceLastLogin: { type: 'number', description: 'Days since last login' },
          openTickets: { type: 'number', description: 'Number of open support tickets' },
          billingIssues: { type: 'boolean', description: 'Whether there are billing issues' },
          monthsAsCustomer: { type: 'number', description: 'Months as customer' },
        },
        required: ['engagementScore', 'daysSinceLastLogin'],
      },
      outputSchema: { type: 'object' },
      version: '1.0.0',
    },
    async (input: unknown, _context: ToolExecutionContext) => {
      try {
        const { engagementScore = 50, daysSinceLastLogin = 0, openTickets = 0, billingIssues = false, monthsAsCustomer = 12 } = input as {
          engagementScore?: number; daysSinceLastLogin?: number; openTickets?: number; billingIssues?: boolean; monthsAsCustomer?: number;
        };
        let churnProbability = 0;
        const riskFactors: string[] = [];
        const recommendedActions: string[] = [];
        if (engagementScore < 30) { churnProbability += 30; riskFactors.push('Low engagement score'); recommendedActions.push('Launch re-engagement campaign'); }
        else if (engagementScore < 50) { churnProbability += 15; riskFactors.push('Below-average engagement'); }
        if (daysSinceLastLogin >= 14) { churnProbability += 25; riskFactors.push(`No login in ${daysSinceLastLogin} days`); recommendedActions.push('Send personalized check-in email'); }
        else if (daysSinceLastLogin >= 7) { churnProbability += 10; riskFactors.push('Login frequency declining'); }
        if (openTickets >= 3) { churnProbability += 15; riskFactors.push(`${openTickets} open support tickets`); recommendedActions.push('Escalate support tickets for priority resolution'); }
        if (billingIssues) { churnProbability += 20; riskFactors.push('Billing issues present'); recommendedActions.push('Proactively reach out about billing concerns'); }
        if (monthsAsCustomer < 3) { churnProbability += 10; riskFactors.push('New customer (high-risk period)'); recommendedActions.push('Ensure onboarding is complete and schedule success check-in'); }
        churnProbability = Math.min(churnProbability, 100);
        if (recommendedActions.length === 0) recommendedActions.push('Continue regular engagement monitoring');
        return { churnProbability, riskFactors, recommendedActions };
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    },
  );

  // 16. generate_winback — template-based winback email sequence
  toolRegistry.register(
    {
      name: 'generate_winback',
      description: 'Generate a winback email sequence based on customer churn risk and factors. Returns ready-to-send email templates.',
      category: ToolCategory.EMAIL,
      riskClass: ToolRiskClass.READ_ONLY,
      requiresApproval: false,
      inputSchema: {
        type: 'object',
        properties: {
          customerName: { type: 'string', description: 'Customer name' },
          churnRisk: { type: 'number', description: 'Churn risk probability 0-100' },
          riskFactors: { type: 'array', items: { type: 'string' }, description: 'Identified risk factors' },
        },
        required: ['customerName'],
      },
      outputSchema: { type: 'object' },
      version: '1.0.0',
    },
    async (input: unknown, _context: ToolExecutionContext) => {
      try {
        const { customerName, churnRisk = 50, riskFactors = [] } = input as { customerName: string; churnRisk?: number; riskFactors?: string[] };
        const emails = [
          {
            subject: `${customerName}, we noticed you have been quiet`,
            body: `Hi ${customerName},\n\nWe noticed it has been a while since you last used our platform. We wanted to check in and see if there is anything we can help with.\n\nOur team has shipped several new features recently that might interest you. Would you like a quick walkthrough?\n\nBest regards`,
            sendAfterDays: 0,
          },
          {
            subject: `Exclusive offer for ${customerName}`,
            body: `Hi ${customerName},\n\nWe value your business and want to make sure you are getting the most from our platform.\n\nAs a valued customer, we would like to offer you a complimentary strategy session with our success team to help you achieve your goals.\n\nWould any time this week work for a quick call?\n\nBest regards`,
            sendAfterDays: 3,
          },
          {
            subject: `${customerName}, your feedback matters to us`,
            body: `Hi ${customerName},\n\nWe would really appreciate hearing your honest feedback. Understanding your experience helps us improve for everyone.\n\nIs there anything specific that has not met your expectations? We are committed to making things right.\n\nBest regards`,
            sendAfterDays: 7,
          },
        ];
        if (churnRisk > 70) {
          emails.push({
            subject: `Special retention offer for ${customerName}`,
            body: `Hi ${customerName},\n\nWe truly value your partnership and want to ensure we are delivering the value you deserve.\n\nWe have put together a special offer exclusively for you. Let us schedule a call to discuss how we can better serve your needs.\n\nBest regards`,
            sendAfterDays: 10,
          });
        }
        return { emails, churnRisk, riskFactors, customerName, sequenceLength: emails.length };
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    },
  );

  // 17. monitor_company_signals — detect funding, hiring, product launch signals
  toolRegistry.register(
    {
      name: 'monitor_company_signals',
      description: 'Monitor a company for buying signals: funding rounds, hiring surges, product launches, leadership changes. FREE — web search based.',
      category: ToolCategory.RESEARCH,
      riskClass: ToolRiskClass.READ_ONLY,
      requiresApproval: false,
      inputSchema: {
        type: 'object',
        properties: {
          company: { type: 'string', description: 'Company name to monitor' },
        },
        required: ['company'],
      },
      outputSchema: { type: 'object' },
      version: '1.0.0',
    },
    async (input: unknown, _context: ToolExecutionContext) => {
      try {
        const { company } = input as { company: string };
        const searches = [
          { query: `${company} funding round`, type: 'funding' },
          { query: `${company} hiring jobs`, type: 'hiring' },
          { query: `${company} product launch announcement`, type: 'product_launch' },
        ];
        const signals: Array<{ type: string; description: string; source: string }> = [];
        for (const search of searches) {
          try {
            const { results } = await searchDuckDuckGo(search.query, 3);
            for (const r of results) {
              signals.push({ type: search.type, description: `${r.title}: ${r.snippet}`.slice(0, 200), source: r.url });
            }
          } catch { /* skip failed searches */ }
        }
        const signalStrength = Math.min(signals.length * 15, 100);
        return { company, signals, signalStrength, signalCount: signals.length };
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    },
  );

  // 18. find_decision_makers — search for key people at a company
  toolRegistry.register(
    {
      name: 'find_decision_makers',
      description: 'Find decision makers at a company by searching for specific roles on LinkedIn and the web. FREE — web search based.',
      category: ToolCategory.CRM,
      riskClass: ToolRiskClass.READ_ONLY,
      requiresApproval: false,
      inputSchema: {
        type: 'object',
        properties: {
          company: { type: 'string', description: 'Company name' },
          roles: { type: 'array', items: { type: 'string' }, description: 'Roles to search for (e.g., CTO, VP Engineering)' },
        },
        required: ['company', 'roles'],
      },
      outputSchema: { type: 'object' },
      version: '1.0.0',
    },
    async (input: unknown, _context: ToolExecutionContext) => {
      try {
        const { company, roles } = input as { company: string; roles: string[] };
        const decisionMakers: Array<{ name: string; title: string; source: string }> = [];
        for (const role of roles.slice(0, 5)) {
          try {
            const { results } = await searchDuckDuckGo(`${company} ${role} LinkedIn`, 3);
            for (const r of results) {
              if (r.url.includes('linkedin.com') || r.title.toLowerCase().includes(role.toLowerCase())) {
                decisionMakers.push({
                  name: r.title.split(/[-|]/).map(s => s.trim())[0] ?? r.title,
                  title: role,
                  source: r.url,
                });
              }
            }
          } catch { /* skip failed searches */ }
        }
        return { company, decisionMakers, rolesSearched: roles, foundCount: decisionMakers.length };
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    },
  );

  // ─── PHORING.AI INTEGRATION TOOLS ───────────────────────────────────────────
  registerPhoringTools();
}
