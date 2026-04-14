import { ToolCategory, ToolRiskClass } from '@jak-swarm/shared';
import type { ToolExecutionContext } from '@jak-swarm/shared';
import { toolRegistry } from '../registry/tool-registry.js';
import { UnconfiguredCRMAdapter } from '../adapters/unconfigured.js';
import { getMemoryAdapter } from '../adapters/memory/db-memory.adapter.js';
// Phoring integration removed — disabled
import { getEmailAdapter, getCalendarAdapter, getCRMAdapterFromEnv, hasRealAdapters } from '../adapters/adapter-factory.js';

const emailAdapter = getEmailAdapter();
const calendarAdapter = getCalendarAdapter();
const crmAdapter = getCRMAdapterFromEnv() ?? new UnconfiguredCRMAdapter();

if (hasRealAdapters()) {
  console.log('[tools] Using REAL Gmail + Calendar adapters');
} else {
  console.warn('[tools] Email + Calendar adapters NOT configured (set GMAIL_EMAIL + GMAIL_APP_PASSWORD). Tools will fail on use.');
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
          scopeType: { type: 'string', description: 'Scope type: TENANT, USER, WORKFLOW, PROJECT, or AGENT (default: TENANT)' },
          scopeId: { type: 'string', description: 'Scope identifier (defaults to tenantId for TENANT scope)' },
        },
        required: ['query'],
      },
      outputSchema: { type: 'object', properties: { results: { type: 'array' } } },
      version: '1.0.0',
    },
    async (input: unknown, context: ToolExecutionContext) => {
      const { query, maxResults = 5, scopeType, scopeId } = input as { query: string; maxResults?: number; scopeType?: string; scopeId?: string };
      const resolvedScopeType = scopeType ?? 'TENANT';
      const resolvedScopeId = scopeId ?? context.tenantId;

      // 1. Try vector semantic search first (highest quality)
      try {
        const { getVectorMemoryAdapter } = await import('../adapters/memory/vector-memory.adapter.js');
        const vectorAdapter = getVectorMemoryAdapter();
        const vectorResults = await vectorAdapter.search(context.tenantId, query, maxResults, 0.5, { scopeType: resolvedScopeType, scopeId: resolvedScopeId });
        if (vectorResults.length > 0) {
          return {
            results: vectorResults.map((r) => ({
              content: r.content,
              score: Math.round(r.score * 100) / 100,
              type: r.sourceType,
              source: r.sourceKey ?? 'vector_store',
              metadata: r.metadata,
            })),
            query,
            totalFound: vectorResults.length,
            connected: true,
            searchMethod: 'vector',
          };
        }
      } catch (vecErr) {
        console.warn('[search_knowledge] Vector search failed, falling back to keyword search:', vecErr instanceof Error ? vecErr.message : String(vecErr));
      }

      // 2. Fall back to keyword search on MemoryItem table
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const dbModule = require('@jak-swarm/db');
        const prisma = dbModule.prisma;
        if (prisma?.memoryItem) {
          const entries = await prisma.memoryItem.findMany({
            where: {
              tenantId: context.tenantId,
              scopeType: resolvedScopeType,
              scopeId: resolvedScopeId,
              deletedAt: null,
              OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
              key: { contains: query, mode: 'insensitive' },
            },
            orderBy: { updatedAt: 'desc' },
            take: maxResults,
          });
          if (entries.length > 0) {
            return {
              results: entries.map((e: { key: string; value: unknown; memoryType: string; source: string; updatedAt: Date | string }) => ({
                key: e.key,
                value: e.value,
                type: e.memoryType,
                source: e.source,
                updatedAt: e.updatedAt instanceof Date ? e.updatedAt.toISOString() : String(e.updatedAt),
              })),
              query,
              totalFound: entries.length,
              connected: true,
              searchMethod: 'keyword',
            };
          }
        }
      } catch (dbErr) {
        console.warn('[search_knowledge] DB keyword search failed, falling back to memory adapter:', dbErr instanceof Error ? dbErr.message : String(dbErr));
      }

      // 3. Final fallback: exact key lookup via memory adapter
      const adapter = getMemoryAdapter();
      const result = await adapter.get(query, context.tenantId);
      if (result) {
        return { results: [result], query, totalFound: 1, connected: true, searchMethod: 'exact' };
      }
      return {
        results: [],
        query,
        totalFound: 0,
        connected: false,
        searchMethod: 'none',
        message: `No stored knowledge found for "${query}". Use ingest_document to add documents to the knowledge base, memory_store for key-value data, or web_search for external information.`,
      };
    },
  );

  // ─── VECTOR INGESTION TOOL ──────────────────────────────────────────────

  toolRegistry.register(
    {
      name: 'ingest_document',
      description: 'Ingest a document (text or PDF) into the vector knowledge base for semantic search. Chunks the content, generates embeddings, and stores for future retrieval via search_knowledge.',
      category: ToolCategory.KNOWLEDGE,
      riskClass: ToolRiskClass.WRITE,
      requiresApproval: false,
      inputSchema: {
        type: 'object',
        properties: {
          content: { type: 'string', description: 'The text content to ingest' },
          title: { type: 'string', description: 'Document title for metadata' },
          sourceType: { type: 'string', description: 'Type: DOCUMENT, KNOWLEDGE, POLICY, UPLOAD (default: DOCUMENT)' },
          sourceKey: { type: 'string', description: 'Unique key for this source (for re-ingestion/deletion)' },
        },
        required: ['content'],
      },
      outputSchema: {
        type: 'object',
        properties: {
          chunksCreated: { type: 'number' },
          sourceKey: { type: 'string' },
          sourceType: { type: 'string' },
        },
      },
      version: '1.0.0',
    },
    async (input: unknown, context: ToolExecutionContext) => {
      const { content, title, sourceType, sourceKey } = input as {
        content: string;
        title?: string;
        sourceType?: string;
        sourceKey?: string;
      };

      if (!content || content.trim().length === 0) {
        return { error: 'Content is empty — nothing to ingest.' };
      }

      try {
        const { getDocumentIngestor } = await import('../adapters/memory/document-ingestor.js');
        const ingestor = getDocumentIngestor();
        const result = await ingestor.ingestText(context.tenantId, content, {
          title,
          sourceType,
          sourceKey,
        });
        return {
          ...result,
          message: `Ingested "${title ?? 'untitled'}" into knowledge base (${result.chunksCreated} chunks).`,
        };
      } catch (err) {
        return {
          error: `Ingestion failed: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
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

  // ─── ADVANCED BROWSER TOOLS (OpenClaw/Claude-compatible) ─────────────────

  // Tool 1: browser_wait_for
  toolRegistry.register(
    {
      name: 'browser_wait_for',
      description: 'Wait for an element to appear, disappear, or become visible on the page. Essential before interacting with dynamic content.',
      category: ToolCategory.BROWSER,
      riskClass: ToolRiskClass.READ_ONLY,
      requiresApproval: false,
      inputSchema: {
        type: 'object',
        properties: {
          selector: { type: 'string', description: 'CSS selector to wait for' },
          state: { type: 'string', description: '"visible" (default), "hidden", "attached", "detached"' },
          timeout: { type: 'number', description: 'Max wait time in ms (default 10000)' },
        },
        required: ['selector'],
      },
      outputSchema: { type: 'object' },
      version: '1.0.0',
    },
    async (input: unknown, _context: ToolExecutionContext) => {
      const { selector, state = 'visible', timeout = 10000 } = input as { selector: string; state?: string; timeout?: number };
      try {
        const { playwrightEngine } = await import('../adapters/browser/playwright-engine.js');
        const page = await playwrightEngine.getActivePage();
        await page.waitForSelector(selector, { state: state as 'visible' | 'hidden' | 'attached' | 'detached', timeout });
        return { success: true, data: { selector, state, found: true } };
      } catch (err) {
        return { success: false, error: `Wait failed: ${err instanceof Error ? err.message : String(err)}` };
      }
    },
  );

  // Tool 2: browser_select_option
  toolRegistry.register(
    {
      name: 'browser_select_option',
      description: 'Select an option from a dropdown/select element. Specify by value, label text, or index.',
      category: ToolCategory.BROWSER,
      riskClass: ToolRiskClass.WRITE,
      requiresApproval: false,
      inputSchema: {
        type: 'object',
        properties: {
          selector: { type: 'string', description: 'CSS selector of the <select> element' },
          value: { type: 'string', description: 'Option value to select' },
          label: { type: 'string', description: 'Option visible text to select (alternative to value)' },
        },
        required: ['selector'],
      },
      outputSchema: { type: 'object' },
      version: '1.0.0',
    },
    async (input: unknown, _context: ToolExecutionContext) => {
      const { selector, value, label } = input as { selector: string; value?: string; label?: string };
      try {
        const { playwrightEngine } = await import('../adapters/browser/playwright-engine.js');
        const page = await playwrightEngine.getActivePage();
        const selected = value
          ? await page.selectOption(selector, { value })
          : label ? await page.selectOption(selector, { label }) : [];
        return { success: true, data: { selector, selected } };
      } catch (err) {
        return { success: false, error: `Select failed: ${err instanceof Error ? err.message : String(err)}` };
      }
    },
  );

  // Tool 3: browser_upload_file
  toolRegistry.register(
    {
      name: 'browser_upload_file',
      description: 'Upload a file to a file input element. Provide the CSS selector of the input[type=file] and the file path.',
      category: ToolCategory.BROWSER,
      riskClass: ToolRiskClass.WRITE,
      requiresApproval: true,
      inputSchema: {
        type: 'object',
        properties: {
          selector: { type: 'string', description: 'CSS selector of the file input' },
          filePath: { type: 'string', description: 'Path to the file to upload (relative to workspace)' },
        },
        required: ['selector', 'filePath'],
      },
      outputSchema: { type: 'object' },
      version: '1.0.0',
    },
    async (input: unknown, _context: ToolExecutionContext) => {
      const { selector, filePath } = input as { selector: string; filePath: string };
      try {
        const nodePath = await import('node:path');
        const workspaceDir = process.env['JAK_WORKSPACE_DIR'] ?? process.cwd();
        const fullPath = nodePath.resolve(workspaceDir, filePath);
        const { playwrightEngine } = await import('../adapters/browser/playwright-engine.js');
        const page = await playwrightEngine.getActivePage();
        await page.setInputFiles(selector, fullPath);
        return { success: true, data: { selector, filePath: fullPath } };
      } catch (err) {
        return { success: false, error: `Upload failed: ${err instanceof Error ? err.message : String(err)}` };
      }
    },
  );

  // Tool 4: browser_evaluate_js
  toolRegistry.register(
    {
      name: 'browser_evaluate_js',
      description: 'Execute JavaScript code in the browser page context. Returns the result. Use to read DOM values, modify page state, or extract data. REQUIRES approval due to arbitrary code execution.',
      category: ToolCategory.BROWSER,
      riskClass: ToolRiskClass.WRITE,
      requiresApproval: true,
      inputSchema: {
        type: 'object',
        properties: {
          code: { type: 'string', description: 'JavaScript code to execute in page context' },
        },
        required: ['code'],
      },
      outputSchema: { type: 'object' },
      version: '1.0.0',
    },
    async (input: unknown, _context: ToolExecutionContext) => {
      const { code } = input as { code: string };
      try {
        const { playwrightEngine } = await import('../adapters/browser/playwright-engine.js');
        const page = await playwrightEngine.getActivePage();
        const result = await page.evaluate(code);
        return { success: true, data: { result: typeof result === 'object' ? JSON.stringify(result) : String(result) } };
      } catch (err) {
        return { success: false, error: `Evaluate failed: ${err instanceof Error ? err.message : String(err)}` };
      }
    },
  );

  // Tool 5: browser_hover
  toolRegistry.register(
    {
      name: 'browser_hover',
      description: 'Hover over an element to trigger hover menus, tooltips, or dropdown reveals.',
      category: ToolCategory.BROWSER,
      riskClass: ToolRiskClass.READ_ONLY,
      requiresApproval: false,
      inputSchema: {
        type: 'object',
        properties: {
          selector: { type: 'string', description: 'CSS selector of element to hover over' },
        },
        required: ['selector'],
      },
      outputSchema: { type: 'object' },
      version: '1.0.0',
    },
    async (input: unknown, _context: ToolExecutionContext) => {
      const { selector } = input as { selector: string };
      try {
        const { playwrightEngine } = await import('../adapters/browser/playwright-engine.js');
        const page = await playwrightEngine.getActivePage();
        await page.locator(selector).hover({ timeout: 5000 });
        return { success: true, data: { selector, hovered: true } };
      } catch (err) {
        return { success: false, error: `Hover failed: ${err instanceof Error ? err.message : String(err)}` };
      }
    },
  );

  // Tool 6: browser_get_cookies
  toolRegistry.register(
    {
      name: 'browser_get_cookies',
      description: 'Get all cookies from the browser context. Useful for inspecting auth state, session tokens, or login status.',
      category: ToolCategory.BROWSER,
      riskClass: ToolRiskClass.READ_ONLY,
      requiresApproval: false,
      inputSchema: {
        type: 'object',
        properties: {
          urls: { type: 'array', items: { type: 'string' }, description: 'Optional: filter cookies by URLs' },
        },
      },
      outputSchema: { type: 'object' },
      version: '1.0.0',
    },
    async (input: unknown, _context: ToolExecutionContext) => {
      const { urls } = input as { urls?: string[] };
      try {
        const { playwrightEngine } = await import('../adapters/browser/playwright-engine.js');
        const ctx = await playwrightEngine.getContext();
        const cookies = await ctx.cookies(urls ?? []);
        return {
          success: true,
          data: {
            cookies: cookies.map((c) => ({
              name: c.name,
              domain: c.domain,
              path: c.path,
              secure: c.secure,
              httpOnly: c.httpOnly,
              expires: c.expires,
            })),
            count: cookies.length,
          },
        };
      } catch (err) {
        return { success: false, error: `Get cookies failed: ${err instanceof Error ? err.message : String(err)}` };
      }
    },
  );

  // Tool 7: browser_set_cookies
  toolRegistry.register(
    {
      name: 'browser_set_cookies',
      description: 'Set cookies in the browser context. Useful for restoring login sessions or auth state.',
      category: ToolCategory.BROWSER,
      riskClass: ToolRiskClass.WRITE,
      requiresApproval: true,
      inputSchema: {
        type: 'object',
        properties: {
          cookies: { type: 'array', items: { type: 'object' }, description: 'Array of cookie objects with name, value, domain, path' },
        },
        required: ['cookies'],
      },
      outputSchema: { type: 'object' },
      version: '1.0.0',
    },
    async (input: unknown, _context: ToolExecutionContext) => {
      const { cookies } = input as { cookies: Array<{ name: string; value: string; domain: string; path: string; [key: string]: unknown }> };
      try {
        const { playwrightEngine } = await import('../adapters/browser/playwright-engine.js');
        const ctx = await playwrightEngine.getContext();
        await ctx.addCookies(cookies as Parameters<typeof ctx.addCookies>[0]);
        return { success: true, data: { cookiesSet: cookies.length } };
      } catch (err) {
        return { success: false, error: `Set cookies failed: ${err instanceof Error ? err.message : String(err)}` };
      }
    },
  );

  // Tool 8: browser_save_as_pdf
  toolRegistry.register(
    {
      name: 'browser_save_as_pdf',
      description: 'Export the current page as a PDF file. Saves to the workspace directory. Only works when browser is running in headless mode.',
      category: ToolCategory.BROWSER,
      riskClass: ToolRiskClass.WRITE,
      requiresApproval: false,
      inputSchema: {
        type: 'object',
        properties: {
          filename: { type: 'string', description: 'Output filename (default: page-export.pdf)' },
          format: { type: 'string', description: 'Paper format: A4 (default), Letter, Legal' },
        },
      },
      outputSchema: { type: 'object' },
      version: '1.0.0',
    },
    async (input: unknown, _context: ToolExecutionContext) => {
      const { filename = 'page-export.pdf', format = 'A4' } = input as { filename?: string; format?: string };
      try {
        const nodePath = await import('node:path');
        const workspaceDir = process.env['JAK_WORKSPACE_DIR'] ?? process.cwd();
        const outPath = nodePath.resolve(workspaceDir, filename);
        const { playwrightEngine } = await import('../adapters/browser/playwright-engine.js');
        const page = await playwrightEngine.getActivePage();
        await page.pdf({ path: outPath, format: format as 'A4' | 'Letter' | 'Legal', printBackground: true });
        return { success: true, data: { path: outPath, format } };
      } catch (err) {
        return { success: false, error: `PDF export failed: ${err instanceof Error ? err.message : String(err)}` };
      }
    },
  );

  // Tool 9: browser_manage_tabs
  toolRegistry.register(
    {
      name: 'browser_manage_tabs',
      description: 'List all open browser tabs, switch to a tab, or close a tab. Use for multi-tab workflows.',
      category: ToolCategory.BROWSER,
      riskClass: ToolRiskClass.WRITE,
      requiresApproval: false,
      inputSchema: {
        type: 'object',
        properties: {
          action: { type: 'string', description: '"list" (default), "switch", "close", "new"' },
          tabIndex: { type: 'number', description: 'Tab index for switch/close (0-based)' },
          url: { type: 'string', description: 'URL for new tab' },
        },
      },
      outputSchema: { type: 'object' },
      version: '1.0.0',
    },
    async (input: unknown, _context: ToolExecutionContext) => {
      const { action = 'list', tabIndex, url } = input as { action?: string; tabIndex?: number; url?: string };
      try {
        const { playwrightEngine } = await import('../adapters/browser/playwright-engine.js');
        const ctx = await playwrightEngine.getContext();
        const pages = ctx.pages();
        if (action === 'list') {
          const tabs = await Promise.all(
            pages.map(async (p, i) => ({
              index: i,
              url: p.url(),
              title: await p.title().catch(() => ''),
            })),
          );
          return { success: true, data: { tabs, count: tabs.length } };
        }
        if (action === 'switch' && tabIndex != null && pages[tabIndex]) {
          await pages[tabIndex].bringToFront();
          return { success: true, data: { switchedTo: tabIndex, url: pages[tabIndex].url() } };
        }
        if (action === 'close' && tabIndex != null && pages[tabIndex]) {
          await pages[tabIndex].close();
          return { success: true, data: { closed: tabIndex } };
        }
        if (action === 'new') {
          const newPage = await ctx.newPage();
          if (url) await newPage.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
          return { success: true, data: { newTabIndex: ctx.pages().length - 1, url: url ?? 'about:blank' } };
        }
        return { success: false, error: `Unknown action: ${action}` };
      } catch (err) {
        return { success: false, error: `Tab management failed: ${err instanceof Error ? err.message : String(err)}` };
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
        const parser: any = new PDFParse(new Uint8Array(buffer));
        if (typeof parser.load === 'function') await parser.load();
        const text = await parser.getText();
        let info: unknown = null;
        try { info = await parser.getInfo(); } catch { /* optional */ }
        await parser.destroy();
        const data = { text: text?.text ?? '', numpages: text?.total ?? 0, info, metadata: null };

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
        const parser: any = new PDFParse(new Uint8Array(buffer));
        if (typeof parser.load === 'function') await parser.load();
        const text = await parser.getText();
        let info: unknown = null;
        try { info = await parser.getInfo(); } catch { /* optional */ }
        await parser.destroy();
        const data = { text: text?.text ?? '', numpages: text?.total ?? 0, info, metadata: null };

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
          scopeType: { type: 'string', description: 'Scope type (TENANT, USER, WORKFLOW, PROJECT, AGENT)' },
          scopeId: { type: 'string', description: 'Scope identifier (defaults to tenantId for TENANT scope)' },
          idempotencyKey: { type: 'string', description: 'Idempotency key for safe retries' },
          confidence: { type: 'number', description: 'Confidence score 0-1 (optional)' },
          expiresAt: { type: 'string', description: 'ISO-8601 expiry datetime (optional)' },
        },
        required: ['key', 'value'],
      },
      outputSchema: { type: 'object', properties: { stored: { type: 'boolean' } } },
      version: '1.0.0',
    },
    async (input: unknown, context: ToolExecutionContext) => {
      const {
        key,
        value,
        type = 'KNOWLEDGE',
        source = 'agent',
        scopeType,
        scopeId,
        idempotencyKey,
        confidence,
        expiresAt,
      } = input as {
        key: string;
        value: unknown;
        type?: string;
        source?: string;
        scopeType?: string;
        scopeId?: string;
        idempotencyKey?: string;
        confidence?: number;
        expiresAt?: string;
      };
      const resolvedScopeType = scopeType ?? 'TENANT';
      const resolvedScopeId = scopeId ?? context.tenantId;
      const resolvedIdempotencyKey = idempotencyKey ?? buildIdempotencyKey(context, key, resolvedScopeType, resolvedScopeId, value);
      const adapter = getMemoryAdapter();
      await adapter.set(key, value, context.tenantId, {
        type,
        source,
        scopeType: resolvedScopeType,
        scopeId: resolvedScopeId,
        idempotencyKey: resolvedIdempotencyKey,
        confidence,
        expiresAt,
        sourceRunId: context.runId,
      });
      return { stored: true, key, type, scopeType: resolvedScopeType, scopeId: resolvedScopeId };
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
          scopeType: { type: 'string', description: 'Scope type (TENANT, USER, WORKFLOW, PROJECT, AGENT)' },
          scopeId: { type: 'string', description: 'Scope identifier (defaults to tenantId for TENANT scope)' },
          includeDeleted: { type: 'boolean', description: 'Include soft-deleted items (admin only)' },
        },
        required: ['key'],
      },
      outputSchema: { type: 'object', properties: { value: {} } },
      version: '1.0.0',
    },
    async (input: unknown, context: ToolExecutionContext) => {
      const { key, scopeType, scopeId, includeDeleted } = input as {
        key: string; scopeType?: string; scopeId?: string; includeDeleted?: boolean;
      };
      const resolvedScopeType = scopeType ?? 'TENANT';
      const resolvedScopeId = scopeId ?? context.tenantId;
      const adapter = getMemoryAdapter();
      const result = await adapter.get(key, context.tenantId, {
        scopeType: resolvedScopeType,
        scopeId: resolvedScopeId,
        includeDeleted,
      });
      if (!result) {
        return { found: false, key, value: null };
      }
      return { found: true, key, scopeType: resolvedScopeType, scopeId: resolvedScopeId, ...(result as Record<string, unknown>) };
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
          setTimeout(() => { try { proc.kill('SIGKILL'); } catch (killErr) { console.warn('[code_execute] Failed to kill process:', killErr instanceof Error ? killErr.message : String(killErr)); } }, timeoutMs + 1000);
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
    async (input: unknown, context: ToolExecutionContext) => {
      const { query } = input as { query: string };
      // Search tenant memory for knowledge entries
      const adapter = getMemoryAdapter();
      const result = await adapter.get(query, context.tenantId);
      if (result) {
        return { query, results: [result], connected: true, totalFound: 1 };
      }
      return { query, results: [], message: 'No knowledge base entries found. Use memory_store to add entries, or use web_search for external information.', connected: true, totalFound: 0 };
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

  // ─── DALL-E Image Generation ────────────────────────────────────────────
  toolRegistry.register(
    {
      name: 'generate_image',
      description: 'Generate an image using DALL-E 3. Returns a URL to the generated image. Use for social media posts, blog headers, presentations.',
      category: 'DOCUMENT' as any,
      riskClass: 'WRITE' as any,
      requiresApproval: false,
      inputSchema: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: 'Detailed description of the image to generate' },
          size: { type: 'string', description: '1024x1024 (default), 1792x1024 (landscape), 1024x1792 (portrait)' },
          style: { type: 'string', description: 'vivid (default) or natural' },
        },
        required: ['prompt'],
      },
      outputSchema: { type: 'object' },
      version: '1.0.0',
    },
    async (input: unknown) => {
      const { prompt, size = '1024x1024', style = 'vivid' } = input as { prompt: string; size?: string; style?: string };
      const apiKey = process.env['OPENAI_API_KEY'];
      if (!apiKey) {
        return { success: false, error: 'OPENAI_API_KEY not set. Required for DALL-E image generation.' };
      }
      try {
        const OpenAI = (await import('openai')).default;
        const openai = new OpenAI({ apiKey });
        const response = await openai.images.generate({
          model: 'dall-e-3',
          prompt,
          n: 1,
          size: size as '1024x1024' | '1792x1024' | '1024x1792',
          style: style as 'vivid' | 'natural',
        });
        const imageData = response.data?.[0];
        const imageUrl = imageData?.url;
        if (!imageUrl) throw new Error('No image URL returned');

        // Download and save to workspace
        const fs = await import('node:fs/promises');
        const path = await import('node:path');
        const workspaceDir = process.env['JAK_WORKSPACE_DIR'] ?? process.cwd();
        const filename = `dalle-${Date.now()}.png`;
        const filepath = path.join(workspaceDir, filename);

        const imgResponse = await fetch(imageUrl);
        const buffer = Buffer.from(await imgResponse.arrayBuffer());
        await fs.writeFile(filepath, buffer);

        return {
          success: true,
          data: {
            url: imageUrl,
            localPath: filepath,
            filename,
            prompt: imageData?.revised_prompt ?? prompt,
            size,
            style,
          },
        };
      } catch (err) {
        return { success: false, error: `DALL-E generation failed: ${err instanceof Error ? err.message : String(err)}` };
      }
    },
  );

  // ─── Social Media Auto-Posting ────────────────────────────────────────────
  toolRegistry.register(
    {
      name: 'post_to_twitter',
      description: 'Post a tweet to Twitter/X using browser automation. Requires being logged into Twitter in the browser profile. Can include text and optionally attach an image.',
      category: 'BROWSER' as any,
      riskClass: 'EXTERNAL_SIDE_EFFECT' as any,
      requiresApproval: true,
      inputSchema: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'Tweet text (max 280 characters)' },
          imagePath: { type: 'string', description: 'Optional: path to image file to attach' },
        },
        required: ['text'],
      },
      outputSchema: { type: 'object' },
      version: '1.0.0',
    },
    async (input: unknown) => {
      const { text, imagePath } = input as { text: string; imagePath?: string };
      try {
        const { playwrightEngine } = await import('../adapters/browser/playwright-engine.js');
        const page = await playwrightEngine.getActivePage();

        // Navigate to Twitter compose
        await page.goto('https://x.com/compose/post', { waitUntil: 'networkidle', timeout: 15000 });
        await page.waitForTimeout(2000);

        // Type the tweet
        const tweetBox = page.locator('[data-testid="tweetTextarea_0"]').or(page.locator('[role="textbox"]')).first();
        await tweetBox.click();
        await tweetBox.fill(text);

        // Attach image if provided
        if (imagePath) {
          const fs = await import('node:fs');
          if (fs.existsSync(imagePath)) {
            const fileInput = page.locator('input[type="file"]').first();
            await fileInput.setInputFiles(imagePath);
            await page.waitForTimeout(2000); // Wait for upload
          }
        }

        // Click post button
        const postBtn = page.locator('[data-testid="tweetButton"]').or(page.locator('button:has-text("Post")')).first();
        await postBtn.click();
        await page.waitForTimeout(3000);

        return { success: true, data: { platform: 'twitter', text: text.slice(0, 50) + '...', posted: true } };
      } catch (err) {
        return { success: false, error: `Twitter post failed: ${err instanceof Error ? err.message : String(err)}. Make sure you're logged into Twitter in the browser profile.` };
      }
    },
  );

  toolRegistry.register(
    {
      name: 'post_to_linkedin',
      description: 'Post content to LinkedIn using browser automation. Requires being logged into LinkedIn in the browser profile.',
      category: 'BROWSER' as any,
      riskClass: 'EXTERNAL_SIDE_EFFECT' as any,
      requiresApproval: true,
      inputSchema: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'Post content text' },
          imagePath: { type: 'string', description: 'Optional: path to image file to attach' },
        },
        required: ['text'],
      },
      outputSchema: { type: 'object' },
      version: '1.0.0',
    },
    async (input: unknown) => {
      const { text, imagePath } = input as { text: string; imagePath?: string };
      try {
        const { playwrightEngine } = await import('../adapters/browser/playwright-engine.js');
        const page = await playwrightEngine.getActivePage();

        await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'networkidle', timeout: 15000 });
        await page.waitForTimeout(2000);

        // Click "Start a post" button
        const startPost = page.locator('button:has-text("Start a post")').or(page.locator('.share-box-feed-entry__trigger')).first();
        await startPost.click();
        await page.waitForTimeout(1500);

        // Type in the post editor
        const editor = page.locator('[role="textbox"]').or(page.locator('.ql-editor')).first();
        await editor.click();
        await editor.fill(text);

        // Attach image if provided
        if (imagePath) {
          const fs = await import('node:fs');
          if (fs.existsSync(imagePath)) {
            const imgBtn = page.locator('button[aria-label="Add a photo"]').or(page.locator('button:has-text("Photo")')).first();
            await imgBtn.click();
            await page.waitForTimeout(1000);
            const fileInput = page.locator('input[type="file"]').first();
            await fileInput.setInputFiles(imagePath);
            await page.waitForTimeout(3000);
          }
        }

        // Click Post button
        const postBtn = page.locator('button:has-text("Post")').last();
        await postBtn.click();
        await page.waitForTimeout(3000);

        return { success: true, data: { platform: 'linkedin', text: text.slice(0, 50) + '...', posted: true } };
      } catch (err) {
        return { success: false, error: `LinkedIn post failed: ${err instanceof Error ? err.message : String(err)}. Make sure you're logged into LinkedIn in the browser profile.` };
      }
    },
  );

  toolRegistry.register(
    {
      name: 'post_to_reddit',
      description: 'Create a Reddit post in a specified subreddit using browser automation. Requires being logged into Reddit in the browser profile.',
      category: 'BROWSER' as any,
      riskClass: 'EXTERNAL_SIDE_EFFECT' as any,
      requiresApproval: true,
      inputSchema: {
        type: 'object',
        properties: {
          subreddit: { type: 'string', description: 'Subreddit name without r/ prefix (e.g. "artificial")' },
          title: { type: 'string', description: 'Post title' },
          body: { type: 'string', description: 'Post body text' },
          imagePath: { type: 'string', description: 'Optional: path to image file' },
        },
        required: ['subreddit', 'title', 'body'],
      },
      outputSchema: { type: 'object' },
      version: '1.0.0',
    },
    async (input: unknown) => {
      const { subreddit, title, body, imagePath } = input as { subreddit: string; title: string; body: string; imagePath?: string };
      try {
        const { playwrightEngine } = await import('../adapters/browser/playwright-engine.js');
        const page = await playwrightEngine.getActivePage();

        // Navigate to subreddit submit page
        await page.goto(`https://www.reddit.com/r/${subreddit}/submit`, { waitUntil: 'networkidle', timeout: 15000 });
        await page.waitForTimeout(2000);

        // Fill title
        const titleInput = page.locator('input[name="title"]').or(page.locator('[placeholder*="Title"]')).first();
        await titleInput.fill(title);

        // Fill body
        const bodyInput = page.locator('textarea').or(page.locator('[data-testid="post-composer"]')).first();
        await bodyInput.click();
        await bodyInput.fill(body);

        // Attach image if provided
        if (imagePath) {
          const fs = await import('node:fs');
          if (fs.existsSync(imagePath)) {
            const fileInput = page.locator('input[type="file"]').first();
            await fileInput.setInputFiles(imagePath);
            await page.waitForTimeout(3000);
          }
        }

        // Submit
        const submitBtn = page.locator('button:has-text("Post")').or(page.locator('button[type="submit"]')).first();
        await submitBtn.click();
        await page.waitForTimeout(3000);

        return { success: true, data: { platform: 'reddit', subreddit, title, posted: true } };
      } catch (err) {
        return { success: false, error: `Reddit post failed: ${err instanceof Error ? err.message : String(err)}. Make sure you're logged into Reddit in the browser profile.` };
      }
    },
  );

  // ─── Platform Discovery ────────────────────────────────────────────────────
  toolRegistry.register(
    {
      name: 'discover_posting_platforms',
      description: 'Search the web for new platforms, forums, and communities where JAK Swarm content should be posted to grow the community.',
      category: 'RESEARCH' as any,
      riskClass: 'READ_ONLY' as any,
      requiresApproval: false,
      inputSchema: {
        type: 'object',
        properties: {
          topic: { type: 'string', description: 'Topic to find communities for (e.g. "AI agents", "automation tools")' },
        },
        required: ['topic'],
      },
      outputSchema: { type: 'object' },
      version: '1.0.0',
    },
    async (input: unknown) => {
      const { topic } = input as { topic: string };
      // Use the existing web_search tool internally
      try {
        const searchResult = await toolRegistry.execute('web_search', {
          query: `best communities forums to share ${topic} tools 2024 2025`,
        }, { tenantId: '', userId: '', workflowId: '', runId: '' });

        return {
          success: true,
          data: {
            query: topic,
            suggestions: [
              'Reddit: r/artificial, r/MachineLearning, r/SideProject, r/startups',
              'Hacker News: Show HN post',
              'Product Hunt: Launch page',
              'Dev.to: Technical blog post',
              'Hashnode: Blog post',
              'IndieHackers: Product showcase',
              'Twitter/X: Thread with #AIAgents #Automation tags',
              'LinkedIn: Article + post',
              'Discord: AI/ML servers',
              'Slack: AI communities',
            ],
            searchResults: searchResult.data,
          },
        };
      } catch (err) {
        return { success: false, error: `Discovery failed: ${err instanceof Error ? err.message : String(err)}` };
      }
    },
  );

  // ─── CMO / MARKETING EXECUTION TOOLS ───────────────────────────────────────

  // 1. monitor_brand_mentions
  toolRegistry.register(
    {
      name: 'monitor_brand_mentions',
      description: 'Search the web for brand mentions across Reddit, Twitter/X, Hacker News, and news sites. Returns structured results with sentiment.',
      category: ToolCategory.RESEARCH,
      riskClass: ToolRiskClass.READ_ONLY,
      requiresApproval: false,
      inputSchema: {
        type: 'object',
        properties: {
          brand: { type: 'string', description: 'Brand or product name to monitor' },
          platforms: { type: 'array', items: { type: 'string' }, description: 'Platforms to search (default: reddit, twitter, hackernews, news)' },
        },
        required: ['brand'],
      },
      outputSchema: { type: 'object', properties: { mentions: { type: 'array' }, totalMentions: { type: 'number' } } },
      version: '1.0.0',
    },
    async (input: unknown, _context: ToolExecutionContext) => {
      try {
        const { brand, platforms = ['reddit', 'twitter', 'hackernews', 'news'] } = input as { brand: string; platforms?: string[] };
        const siteMap: Record<string, string> = {
          reddit: 'site:reddit.com',
          twitter: 'site:twitter.com',
          hackernews: 'site:news.ycombinator.com',
          news: '',
        };
        const mentions: Array<{ platform: string; url: string; snippet: string; sentiment: string }> = [];
        for (const platform of platforms) {
          const siteFilter = siteMap[platform] ?? '';
          const query = `${brand} ${siteFilter}`.trim();
          const { results } = await searchDuckDuckGo(query, 5);
          for (const r of results) {
            const lowerSnippet = r.snippet.toLowerCase();
            let sentiment: string = 'neutral';
            if (/love|great|awesome|amazing|best|excellent|fantastic/.test(lowerSnippet)) sentiment = 'positive';
            else if (/hate|bad|worst|terrible|awful|broken|sucks/.test(lowerSnippet)) sentiment = 'negative';
            mentions.push({ platform, url: r.url, snippet: r.snippet, sentiment });
          }
        }
        return { success: true, data: { mentions, totalMentions: mentions.length } };
      } catch (err) {
        return { success: false, error: `Brand monitoring failed: ${err instanceof Error ? err.message : String(err)}` };
      }
    },
  );

  // 2. auto_reply_reddit
  toolRegistry.register(
    {
      name: 'auto_reply_reddit',
      description: 'Find relevant Reddit threads for a topic and draft contextual, helpful, non-spammy replies.',
      category: ToolCategory.RESEARCH,
      riskClass: ToolRiskClass.READ_ONLY,
      requiresApproval: false,
      inputSchema: {
        type: 'object',
        properties: {
          topic: { type: 'string', description: 'Topic to find threads about' },
          product: { type: 'string', description: 'Product or service to subtly mention' },
          tone: { type: 'string', description: 'Tone of reply: helpful, casual, expert (default: helpful)' },
        },
        required: ['topic'],
      },
      outputSchema: { type: 'object', properties: { threads: { type: 'array' } } },
      version: '1.0.0',
    },
    async (input: unknown, _context: ToolExecutionContext) => {
      try {
        const { topic, product, tone = 'helpful' } = input as { topic: string; product?: string; tone?: string };
        const { results } = await searchDuckDuckGo(`site:reddit.com ${topic}`, 5);
        const threads = results.map(r => {
          const context = r.snippet.slice(0, 200);
          let suggestedReply = `Great question about ${topic}. `;
          if (tone === 'expert') suggestedReply += `Based on my experience, `;
          else if (tone === 'casual') suggestedReply += `Hey! `;
          suggestedReply += `Here's what I'd recommend: [provide value based on "${context.slice(0, 80)}..."]. `;
          if (product) suggestedReply += `I've also found ${product} helpful for this.`;
          return { url: r.url, title: r.title, snippet: r.snippet, suggestedReply };
        });
        return { success: true, data: { threads } };
      } catch (err) {
        return { success: false, error: `Reddit reply generation failed: ${err instanceof Error ? err.message : String(err)}` };
      }
    },
  );

  // 3. auto_reply_twitter
  toolRegistry.register(
    {
      name: 'auto_reply_twitter',
      description: 'Find niche Twitter/X discussions about a topic and draft engagement replies.',
      category: ToolCategory.RESEARCH,
      riskClass: ToolRiskClass.READ_ONLY,
      requiresApproval: false,
      inputSchema: {
        type: 'object',
        properties: {
          topic: { type: 'string', description: 'Topic to find discussions about' },
          product: { type: 'string', description: 'Product or service to subtly mention' },
          hashtags: { type: 'array', items: { type: 'string' }, description: 'Hashtags to include in search' },
        },
        required: ['topic'],
      },
      outputSchema: { type: 'object', properties: { discussions: { type: 'array' } } },
      version: '1.0.0',
    },
    async (input: unknown, _context: ToolExecutionContext) => {
      try {
        const { topic, product, hashtags = [] } = input as { topic: string; product?: string; hashtags?: string[] };
        const hashtagStr = hashtags.map(h => h.startsWith('#') ? h : `#${h}`).join(' ');
        const { results } = await searchDuckDuckGo(`site:twitter.com ${topic} ${hashtagStr}`.trim(), 5);
        const discussions = results.map(r => {
          let suggestedReply = `Interesting thread on ${topic}! `;
          suggestedReply += `[Add insight based on "${r.snippet.slice(0, 60)}..."]. `;
          if (product) suggestedReply += `Worth checking out ${product} for this. `;
          if (hashtags.length > 0) suggestedReply += hashtags.slice(0, 2).map(h => h.startsWith('#') ? h : `#${h}`).join(' ');
          return { url: r.url, snippet: r.snippet, suggestedReply };
        });
        return { success: true, data: { discussions } };
      } catch (err) {
        return { success: false, error: `Twitter reply generation failed: ${err instanceof Error ? err.message : String(err)}` };
      }
    },
  );

  // 4. generate_seo_report
  toolRegistry.register(
    {
      name: 'generate_seo_report',
      description: 'Generate a comprehensive SEO report by combining audit_seo, research_keywords, and analyze_serp results.',
      category: ToolCategory.RESEARCH,
      riskClass: ToolRiskClass.READ_ONLY,
      requiresApproval: false,
      inputSchema: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'Website URL to audit' },
          keywords: { type: 'array', items: { type: 'string' }, description: 'Target keywords to research' },
        },
        required: ['url'],
      },
      outputSchema: { type: 'object', properties: { audit: { type: 'object' }, keywords: { type: 'object' }, serp: { type: 'object' }, recommendations: { type: 'array' }, score: { type: 'number' } } },
      version: '1.0.0',
    },
    async (input: unknown, context: ToolExecutionContext) => {
      try {
        const { url, keywords = [] } = input as { url: string; keywords?: string[] };
        const auditResult = await toolRegistry.execute('audit_seo', { url }, context);
        let keywordsResult = null;
        if (keywords.length > 0) {
          keywordsResult = await toolRegistry.execute('research_keywords', { seed: keywords[0] }, context);
        }
        const serpResult = await toolRegistry.execute('analyze_serp', { query: keywords[0] ?? new URL(url).hostname }, context);
        const recommendations: string[] = [];
        if (auditResult && typeof auditResult === 'object') {
          const audit = auditResult as unknown as Record<string, unknown>;
          if (!audit['hasTitle']) recommendations.push('Add a descriptive title tag');
          if (!audit['hasMetaDescription']) recommendations.push('Add a meta description');
          if (!audit['hasH1']) recommendations.push('Add an H1 heading');
        }
        if (keywords.length === 0) recommendations.push('Define target keywords for better SEO tracking');
        const score = Math.max(0, 100 - recommendations.length * 15);
        return { success: true, data: { audit: auditResult, keywords: keywordsResult, serp: serpResult, recommendations, score } };
      } catch (err) {
        return { success: false, error: `SEO report generation failed: ${err instanceof Error ? err.message : String(err)}` };
      }
    },
  );

  // 5. track_content_performance
  toolRegistry.register(
    {
      name: 'track_content_performance',
      description: 'Store content URLs with publish date in persistent memory. Track and report on content performance over time.',
      category: ToolCategory.KNOWLEDGE,
      riskClass: ToolRiskClass.WRITE,
      requiresApproval: false,
      inputSchema: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'Content URL to track' },
          title: { type: 'string', description: 'Content title' },
          platform: { type: 'string', description: 'Publishing platform (e.g. blog, twitter, linkedin)' },
          action: { type: 'string', description: "'track' to add new content, 'report' to get all tracked content" },
        },
        required: ['action'],
      },
      outputSchema: { type: 'object', properties: { tracked: { type: 'array' } } },
      version: '1.0.0',
    },
    async (input: unknown, context: ToolExecutionContext) => {
      try {
        const { url, title, platform, action } = input as { url?: string; title?: string; platform?: string; action: 'track' | 'report' };
        const adapter = getMemoryAdapter();
        const storageKey = 'CONTENT_PERFORMANCE:tracked_content';
        const existing = await adapter.get(storageKey, context.tenantId);
        const tracked: Array<{ url: string; title: string; platform: string; trackedSince: string }> = (existing as Array<{ url: string; title: string; platform: string; trackedSince: string }>) ?? [];
        if (action === 'track' && url && title && platform) {
          tracked.push({ url, title, platform, trackedSince: new Date().toISOString() });
          await adapter.set(storageKey, tracked, context.tenantId, { type: 'KNOWLEDGE', source: 'track_content_performance' });
          return { success: true, data: { message: `Now tracking "${title}"`, tracked } };
        }
        return { success: true, data: { tracked } };
      } catch (err) {
        return { success: false, error: `Content tracking failed: ${err instanceof Error ? err.message : String(err)}` };
      }
    },
  );

  // ─── CEO / STRATEGIST EXECUTION TOOLS ──────────────────────────────────────

  // 6. track_okrs
  toolRegistry.register(
    {
      name: 'track_okrs',
      description: 'Store and track OKR (Objectives & Key Results) progress in persistent memory.',
      category: ToolCategory.KNOWLEDGE,
      riskClass: ToolRiskClass.WRITE,
      requiresApproval: false,
      inputSchema: {
        type: 'object',
        properties: {
          action: { type: 'string', description: "'set' to create OKR, 'update' to update progress, 'report' to get all OKRs" },
          objective: { type: 'string', description: 'Objective description' },
          keyResults: { type: 'array', items: { type: 'object', properties: { metric: { type: 'string' }, target: { type: 'number' }, current: { type: 'number' } } }, description: 'Key results with metric, target, and current values' },
        },
        required: ['action'],
      },
      outputSchema: { type: 'object', properties: { okrs: { type: 'array' } } },
      version: '1.0.0',
    },
    async (input: unknown, context: ToolExecutionContext) => {
      try {
        const { action, objective, keyResults } = input as { action: 'set' | 'update' | 'report'; objective?: string; keyResults?: Array<{ metric: string; target: number; current: number }> };
        const adapter = getMemoryAdapter();
        const storageKey = 'OKR_TRACKER:okrs';
        const existing = await adapter.get(storageKey, context.tenantId);
        const okrs: Array<{ objective: string; keyResults: Array<{ metric: string; target: number; current: number }>; progress: number; createdAt: string }> = (existing as typeof okrs) ?? [];
        if (action === 'set' && objective && keyResults) {
          const progress = keyResults.length > 0 ? Math.round(keyResults.reduce((sum, kr) => sum + Math.min(100, (kr.current / kr.target) * 100), 0) / keyResults.length) : 0;
          okrs.push({ objective, keyResults, progress, createdAt: new Date().toISOString() });
          await adapter.set(storageKey, okrs, context.tenantId, { type: 'POLICY', source: 'track_okrs' });
          return { success: true, data: { message: `OKR set: "${objective}"`, okrs } };
        }
        if (action === 'update' && objective && keyResults) {
          const idx = okrs.findIndex(o => o.objective === objective);
          if (idx >= 0) {
            okrs[idx]!.keyResults = keyResults;
            okrs[idx]!.progress = keyResults.length > 0 ? Math.round(keyResults.reduce((sum, kr) => sum + Math.min(100, (kr.current / kr.target) * 100), 0) / keyResults.length) : 0;
            await adapter.set(storageKey, okrs, context.tenantId, { type: 'POLICY', source: 'track_okrs' });
            return { success: true, data: { message: `OKR updated: "${objective}"`, okrs } };
          }
          return { success: false, error: `OKR not found: "${objective}"` };
        }
        return { success: true, data: { okrs } };
      } catch (err) {
        return { success: false, error: `OKR tracking failed: ${err instanceof Error ? err.message : String(err)}` };
      }
    },
  );

  // 7. monitor_competitors
  toolRegistry.register(
    {
      name: 'monitor_competitors',
      description: 'Search for recent competitor news, launches, funding, and updates.',
      category: ToolCategory.RESEARCH,
      riskClass: ToolRiskClass.READ_ONLY,
      requiresApproval: false,
      inputSchema: {
        type: 'object',
        properties: {
          competitors: { type: 'array', items: { type: 'string' }, description: 'List of competitor names to monitor' },
          timeframe: { type: 'string', description: 'Timeframe for news (e.g. "this week", "this month")' },
        },
        required: ['competitors'],
      },
      outputSchema: { type: 'object', properties: { competitors: { type: 'array' } } },
      version: '1.0.0',
    },
    async (input: unknown, _context: ToolExecutionContext) => {
      try {
        const { competitors, timeframe = 'recent' } = input as { competitors: string[]; timeframe?: string };
        const competitorData: Array<{ name: string; recentNews: Array<{ title: string; url: string; snippet: string }> }> = [];
        for (const name of competitors) {
          const { results } = await searchDuckDuckGo(`${name} news OR launch OR funding OR update ${timeframe}`, 5);
          competitorData.push({
            name,
            recentNews: results.map(r => ({ title: r.title, url: r.url, snippet: r.snippet })),
          });
        }
        return { success: true, data: { competitors: competitorData } };
      } catch (err) {
        return { success: false, error: `Competitor monitoring failed: ${err instanceof Error ? err.message : String(err)}` };
      }
    },
  );

  // 8. generate_board_report
  toolRegistry.register(
    {
      name: 'generate_board_report',
      description: 'Compile a board-level summary report from provided company data, metrics, and highlights.',
      category: ToolCategory.DOCUMENT,
      riskClass: ToolRiskClass.WRITE,
      requiresApproval: false,
      inputSchema: {
        type: 'object',
        properties: {
          companyName: { type: 'string', description: 'Company name' },
          period: { type: 'string', description: 'Reporting period (e.g. "Q1 2026")' },
          metrics: { type: 'object', description: 'Key metrics as key-value pairs' },
          highlights: { type: 'array', items: { type: 'string' }, description: 'Key highlights and achievements' },
        },
        required: ['companyName', 'period'],
      },
      outputSchema: { type: 'object', properties: { report: { type: 'string' } } },
      version: '1.0.0',
    },
    async (input: unknown, context: ToolExecutionContext) => {
      try {
        const { companyName, period, metrics = {}, highlights = [] } = input as { companyName: string; period: string; metrics?: Record<string, unknown>; highlights?: string[] };
        const reportResult = await toolRegistry.execute('generate_report', {
          reportType: 'custom',
          title: `${companyName} Board Report - ${period}`,
          data: { companyName, period, metrics, highlights },
        }, context);
        return { success: true, data: { report: (reportResult as unknown as Record<string, unknown>)?.['content'] ?? JSON.stringify(reportResult) } };
      } catch (err) {
        return { success: false, error: `Board report generation failed: ${err instanceof Error ? err.message : String(err)}` };
      }
    },
  );

  // ─── CTO / TECHNICAL EXECUTION TOOLS ───────────────────────────────────────

  // 9. analyze_github_repo
  toolRegistry.register(
    {
      name: 'analyze_github_repo',
      description: 'Analyze a public GitHub repository using the GitHub API. Returns stars, forks, issues, language, and more.',
      category: ToolCategory.RESEARCH,
      riskClass: ToolRiskClass.READ_ONLY,
      requiresApproval: false,
      inputSchema: {
        type: 'object',
        properties: {
          owner: { type: 'string', description: 'GitHub repository owner/org' },
          repo: { type: 'string', description: 'Repository name' },
        },
        required: ['owner', 'repo'],
      },
      outputSchema: { type: 'object', properties: { stars: { type: 'number' }, forks: { type: 'number' }, openIssues: { type: 'number' }, language: { type: 'string' }, lastPush: { type: 'string' }, description: { type: 'string' }, license: { type: 'string' } } },
      version: '1.0.0',
    },
    async (input: unknown, _context: ToolExecutionContext) => {
      try {
        const { owner, repo } = input as { owner: string; repo: string };
        const response = await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`, {
          headers: { 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'JAK-Swarm/1.0' },
        });
        if (!response.ok) throw new Error(`GitHub API returned ${response.status}`);
        const data = await response.json() as Record<string, unknown>;
        return {
          success: true,
          data: {
            stars: data['stargazers_count'],
            forks: data['forks_count'],
            openIssues: data['open_issues_count'],
            language: data['language'],
            lastPush: data['pushed_at'],
            description: data['description'],
            license: (data['license'] as Record<string, unknown>)?.['spdx_id'] ?? null,
            fullName: data['full_name'],
            defaultBranch: data['default_branch'],
          },
        };
      } catch (err) {
        return { success: false, error: `GitHub analysis failed: ${err instanceof Error ? err.message : String(err)}` };
      }
    },
  );

  // 10. check_dependencies
  toolRegistry.register(
    {
      name: 'check_dependencies',
      description: 'Parse package.json content and check for known vulnerability issues in top dependencies.',
      category: ToolCategory.RESEARCH,
      riskClass: ToolRiskClass.READ_ONLY,
      requiresApproval: false,
      inputSchema: {
        type: 'object',
        properties: {
          packageJson: { type: 'string', description: 'The content of package.json as a string (not a file path)' },
        },
        required: ['packageJson'],
      },
      outputSchema: { type: 'object', properties: { dependencies: { type: 'array' }, totalDeps: { type: 'number' } } },
      version: '1.0.0',
    },
    async (input: unknown, _context: ToolExecutionContext) => {
      try {
        const { packageJson } = input as { packageJson: string };
        const parsed = JSON.parse(packageJson) as Record<string, unknown>;
        const deps = { ...(parsed['dependencies'] as Record<string, string> ?? {}), ...(parsed['devDependencies'] as Record<string, string> ?? {}) };
        const depEntries = Object.entries(deps);
        const topDeps = depEntries.slice(0, 10);
        const results: Array<{ name: string; version: string; hasKnownIssues: boolean; note: string }> = [];
        for (const [name, version] of topDeps) {
          try {
            const { results: searchResults } = await searchDuckDuckGo(`${name} npm vulnerability security issue`, 2);
            const hasIssues = searchResults.some(r => /vulnerability|CVE|security|exploit/i.test(r.snippet));
            results.push({ name, version, hasKnownIssues: hasIssues, note: hasIssues ? 'Potential security concerns found in search results' : 'No obvious issues found' });
          } catch {
            results.push({ name, version, hasKnownIssues: false, note: 'Could not check (search failed)' });
          }
        }
        return { success: true, data: { dependencies: results, totalDeps: depEntries.length, checkedDeps: results.length } };
      } catch (err) {
        return { success: false, error: `Dependency check failed: ${err instanceof Error ? err.message : String(err)}` };
      }
    },
  );

  // 11. estimate_tech_debt
  toolRegistry.register(
    {
      name: 'estimate_tech_debt',
      description: 'Analyze code files for tech debt indicators like TODO, FIXME, HACK, @deprecated, and any/unknown usage.',
      category: ToolCategory.RESEARCH,
      riskClass: ToolRiskClass.READ_ONLY,
      requiresApproval: false,
      inputSchema: {
        type: 'object',
        properties: {
          files: { type: 'array', items: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] }, description: 'Array of files with path and content' },
        },
        required: ['files'],
      },
      outputSchema: { type: 'object', properties: { score: { type: 'number' }, indicators: { type: 'array' }, recommendations: { type: 'array' } } },
      version: '1.0.0',
    },
    async (input: unknown, _context: ToolExecutionContext) => {
      try {
        const { files } = input as { files: Array<{ path: string; content: string }> };
        const patterns: Array<{ type: string; regex: RegExp; weight: number }> = [
          { type: 'TODO', regex: /\/\/\s*TODO/gi, weight: 1 },
          { type: 'FIXME', regex: /\/\/\s*FIXME/gi, weight: 2 },
          { type: 'HACK', regex: /\/\/\s*HACK/gi, weight: 3 },
          { type: '@deprecated', regex: /@deprecated/gi, weight: 2 },
          { type: 'any_type', regex: /:\s*any\b/g, weight: 1 },
          { type: 'ts_ignore', regex: /@ts-ignore|@ts-nocheck/g, weight: 2 },
          { type: 'console_log', regex: /console\.log\(/g, weight: 0.5 },
          { type: 'empty_catch', regex: /catch\s*\([^)]*\)\s*\{\s*\}/g, weight: 3 },
        ];
        const indicators: Array<{ type: string; count: number; locations: string[] }> = [];
        let totalScore = 0;
        for (const pattern of patterns) {
          const locations: string[] = [];
          let totalCount = 0;
          for (const file of files) {
            const matches = file.content.match(pattern.regex);
            if (matches) {
              totalCount += matches.length;
              locations.push(`${file.path} (${matches.length})`);
            }
          }
          if (totalCount > 0) {
            indicators.push({ type: pattern.type, count: totalCount, locations });
            totalScore += totalCount * pattern.weight;
          }
        }
        const maxScore = files.length * 10;
        const normalizedScore = Math.min(100, Math.round((totalScore / Math.max(maxScore, 1)) * 100));
        const recommendations: string[] = [];
        if (indicators.find(i => i.type === 'FIXME')) recommendations.push('Address FIXME comments as they indicate known bugs');
        if (indicators.find(i => i.type === 'HACK')) recommendations.push('Refactor HACK workarounds into proper solutions');
        if (indicators.find(i => i.type === 'any_type')) recommendations.push('Replace `any` types with proper TypeScript types');
        if (indicators.find(i => i.type === 'empty_catch')) recommendations.push('Add proper error handling in empty catch blocks');
        if (indicators.find(i => i.type === 'ts_ignore')) recommendations.push('Remove @ts-ignore comments and fix underlying type errors');
        return { success: true, data: { score: normalizedScore, indicators, recommendations, totalFiles: files.length } };
      } catch (err) {
        return { success: false, error: `Tech debt estimation failed: ${err instanceof Error ? err.message : String(err)}` };
      }
    },
  );

  // ─── CFO / FINANCE EXECUTION TOOLS ─────────────────────────────────────────

  // 12. parse_financial_csv
  toolRegistry.register(
    {
      name: 'parse_financial_csv',
      description: 'Parse CSV financial data into structured format with computed totals and summary statistics.',
      category: ToolCategory.SPREADSHEET,
      riskClass: ToolRiskClass.READ_ONLY,
      requiresApproval: false,
      inputSchema: {
        type: 'object',
        properties: {
          csvContent: { type: 'string', description: 'Raw CSV content string' },
          type: { type: 'string', description: "Financial document type: 'p&l', 'balance_sheet', or 'bank_statement'" },
        },
        required: ['csvContent'],
      },
      outputSchema: { type: 'object', properties: { rows: { type: 'array' }, totals: { type: 'object' }, summary: { type: 'string' } } },
      version: '1.0.0',
    },
    async (input: unknown, _context: ToolExecutionContext) => {
      try {
        const { csvContent, type = 'general' } = input as { csvContent: string; type?: string };
        const lines = csvContent.trim().split('\n');
        if (lines.length < 2) return { success: false, error: 'CSV must have at least a header row and one data row' };
        const headers = lines[0]!.split(',').map(h => h.trim().replace(/^"|"$/g, ''));
        const rows: Array<Record<string, string | number>> = [];
        const numericColumns: Record<string, number[]> = {};
        for (let i = 1; i < lines.length; i++) {
          const values = lines[i]!.split(',').map(v => v.trim().replace(/^"|"$/g, ''));
          const row: Record<string, string | number> = {};
          headers.forEach((header, idx) => {
            const val = values[idx] ?? '';
            const num = parseFloat(val.replace(/[$,]/g, ''));
            if (!isNaN(num) && val !== '') {
              row[header] = num;
              if (!numericColumns[header]) numericColumns[header] = [];
              numericColumns[header]!.push(num);
            } else {
              row[header] = val;
            }
          });
          rows.push(row);
        }
        const totals: Record<string, { sum: number; mean: number; min: number; max: number }> = {};
        for (const [col, vals] of Object.entries(numericColumns)) {
          const sum = vals.reduce((a, b) => a + b, 0);
          totals[col] = { sum: Math.round(sum * 100) / 100, mean: Math.round((sum / vals.length) * 100) / 100, min: Math.min(...vals), max: Math.max(...vals) };
        }
        return { success: true, data: { rows, totals, rowCount: rows.length, headers, documentType: type, summary: `Parsed ${rows.length} rows with ${headers.length} columns. ${Object.keys(numericColumns).length} numeric columns detected.` } };
      } catch (err) {
        return { success: false, error: `CSV parsing failed: ${err instanceof Error ? err.message : String(err)}` };
      }
    },
  );

  // 13. track_budget
  toolRegistry.register(
    {
      name: 'track_budget',
      description: 'Store and track budget vs actual spending in persistent memory. Supports setting budgets, recording actuals, and generating variance reports.',
      category: ToolCategory.KNOWLEDGE,
      riskClass: ToolRiskClass.WRITE,
      requiresApproval: false,
      inputSchema: {
        type: 'object',
        properties: {
          action: { type: 'string', description: "'set_budget' to define budget, 'add_actual' to record spending, 'report' to get variance report" },
          category: { type: 'string', description: 'Budget category (e.g. "Marketing", "Engineering")' },
          amount: { type: 'number', description: 'Budget or actual amount' },
          period: { type: 'string', description: 'Budget period (e.g. "2026-Q1")' },
        },
        required: ['action'],
      },
      outputSchema: { type: 'object', properties: { budget: { type: 'array' } } },
      version: '1.0.0',
    },
    async (input: unknown, context: ToolExecutionContext) => {
      try {
        const { action, category, amount, period = 'current' } = input as { action: 'set_budget' | 'add_actual' | 'report'; category?: string; amount?: number; period?: string };
        const adapter = getMemoryAdapter();
        const storageKey = `BUDGET_TRACKER:${period}`;
        const existing = await adapter.get(storageKey, context.tenantId);
        const budget: Record<string, { budgeted: number; actual: number }> = (existing as typeof budget) ?? {};
        if (action === 'set_budget' && category && amount !== undefined) {
          if (!budget[category]) budget[category] = { budgeted: 0, actual: 0 };
          budget[category]!.budgeted = amount;
          await adapter.set(storageKey, budget, context.tenantId, { type: 'KNOWLEDGE', source: 'track_budget' });
          return { success: true, data: { message: `Budget set: ${category} = $${amount}`, budget: Object.entries(budget).map(([cat, v]) => ({ category: cat, ...v, variance: v.budgeted - v.actual })) } };
        }
        if (action === 'add_actual' && category && amount !== undefined) {
          if (!budget[category]) budget[category] = { budgeted: 0, actual: 0 };
          budget[category]!.actual += amount;
          await adapter.set(storageKey, budget, context.tenantId, { type: 'KNOWLEDGE', source: 'track_budget' });
          return { success: true, data: { message: `Actual recorded: ${category} += $${amount}`, budget: Object.entries(budget).map(([cat, v]) => ({ category: cat, ...v, variance: v.budgeted - v.actual })) } };
        }
        return { success: true, data: { budget: Object.entries(budget).map(([cat, v]) => ({ category: cat, ...v, variance: v.budgeted - v.actual })), period } };
      } catch (err) {
        return { success: false, error: `Budget tracking failed: ${err instanceof Error ? err.message : String(err)}` };
      }
    },
  );

  // 14. forecast_cashflow
  toolRegistry.register(
    {
      name: 'forecast_cashflow',
      description: 'Time-series forecasting based on historical data using linear regression or moving average.',
      category: ToolCategory.SPREADSHEET,
      riskClass: ToolRiskClass.READ_ONLY,
      requiresApproval: false,
      inputSchema: {
        type: 'object',
        properties: {
          historicalData: { type: 'array', items: { type: 'number' }, description: 'Array of historical numeric values (ordered by time period)' },
          periods: { type: 'number', description: 'Number of future periods to forecast' },
          method: { type: 'string', description: "'linear' for linear regression, 'average' for moving average (default: linear)" },
        },
        required: ['historicalData', 'periods'],
      },
      outputSchema: { type: 'object', properties: { forecast: { type: 'array' }, trend: { type: 'string' }, confidence: { type: 'string' } } },
      version: '1.0.0',
    },
    async (input: unknown, _context: ToolExecutionContext) => {
      try {
        const { historicalData, periods, method = 'linear' } = input as { historicalData: number[]; periods: number; method?: 'linear' | 'average' };
        if (historicalData.length < 2) return { success: false, error: 'Need at least 2 historical data points' };
        const forecast: number[] = [];
        if (method === 'linear') {
          const n = historicalData.length;
          const xs = historicalData.map((_, i) => i);
          const sumX = xs.reduce((a, b) => a + b, 0);
          const sumY = historicalData.reduce((a, b) => a + b, 0);
          const sumXY = xs.reduce((acc, x, i) => acc + x * historicalData[i]!, 0);
          const sumXX = xs.reduce((acc, x) => acc + x * x, 0);
          const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
          const intercept = (sumY - slope * sumX) / n;
          for (let i = 0; i < periods; i++) {
            forecast.push(Math.round((slope * (n + i) + intercept) * 100) / 100);
          }
        } else {
          const windowSize = Math.min(3, historicalData.length);
          const lastWindow = historicalData.slice(-windowSize);
          const avg = lastWindow.reduce((a, b) => a + b, 0) / windowSize;
          for (let i = 0; i < periods; i++) {
            forecast.push(Math.round(avg * 100) / 100);
          }
        }
        const firstVal = historicalData[0]!;
        const lastVal = historicalData[historicalData.length - 1]!;
        const trend = lastVal > firstVal * 1.05 ? 'increasing' : lastVal < firstVal * 0.95 ? 'decreasing' : 'stable';
        const dataPoints = historicalData.length;
        const confidence = dataPoints >= 12 ? 'high' : dataPoints >= 6 ? 'medium' : 'low';
        return { success: true, data: { forecast, trend, confidence, method, historicalPoints: dataPoints } };
      } catch (err) {
        return { success: false, error: `Cashflow forecast failed: ${err instanceof Error ? err.message : String(err)}` };
      }
    },
  );

  // ─── HR EXECUTION TOOLS ────────────────────────────────────────────────────

  // 15. screen_resume
  toolRegistry.register(
    {
      name: 'screen_resume',
      description: 'Score a resume against job requirements using pattern matching and skill extraction. Returns match score, matched/missing skills, and recommendation.',
      category: ToolCategory.DOCUMENT,
      riskClass: ToolRiskClass.READ_ONLY,
      requiresApproval: false,
      inputSchema: {
        type: 'object',
        properties: {
          resumeText: { type: 'string', description: 'Full text content of the resume' },
          jobDescription: { type: 'string', description: 'Job description text' },
          requiredSkills: { type: 'array', items: { type: 'string' }, description: 'List of required skills to match against' },
        },
        required: ['resumeText', 'jobDescription'],
      },
      outputSchema: { type: 'object', properties: { score: { type: 'number' }, matchedSkills: { type: 'array' }, missingSkills: { type: 'array' }, recommendation: { type: 'string' }, flags: { type: 'array' } } },
      version: '1.0.0',
    },
    async (input: unknown, _context: ToolExecutionContext) => {
      try {
        const { resumeText, jobDescription, requiredSkills = [] } = input as { resumeText: string; jobDescription: string; requiredSkills?: string[] };
        const resumeLower = resumeText.toLowerCase();
        const jobLower = jobDescription.toLowerCase();
        const skills = requiredSkills.length > 0 ? requiredSkills : jobLower.match(/\b(?:javascript|typescript|python|react|node|aws|docker|kubernetes|sql|java|go|rust|c\+\+|graphql|rest|api|git|ci\/cd|agile|scrum)\b/gi) ?? [];
        const uniqueSkills = [...new Set(skills.map(s => s.toLowerCase()))];
        const matched = uniqueSkills.filter(skill => resumeLower.includes(skill.toLowerCase()));
        const missing = uniqueSkills.filter(skill => !resumeLower.includes(skill.toLowerCase()));
        const score = uniqueSkills.length > 0 ? Math.round((matched.length / uniqueSkills.length) * 100) : 50;
        const flags: string[] = [];
        if (resumeText.length < 200) flags.push('Resume appears very short');
        if (!/\d{4}/.test(resumeText)) flags.push('No dates/years detected — work history may be missing');
        if (!/education|university|degree|bachelor|master|phd/i.test(resumeText)) flags.push('No education section detected');
        const yearsMatch = resumeText.match(/(\d+)\+?\s*years?\s*(?:of\s*)?experience/i);
        if (yearsMatch) flags.push(`Candidate claims ${yearsMatch[1]}+ years experience`);
        let recommendation: string;
        if (score >= 75) recommendation = 'Strong match — recommend for interview';
        else if (score >= 50) recommendation = 'Moderate match — consider for phone screen';
        else recommendation = 'Weak match — may not meet minimum requirements';
        return { success: true, data: { score, matchedSkills: matched, missingSkills: missing, recommendation, flags } };
      } catch (err) {
        return { success: false, error: `Resume screening failed: ${err instanceof Error ? err.message : String(err)}` };
      }
    },
  );

  // 16. post_job_listing
  toolRegistry.register(
    {
      name: 'post_job_listing',
      description: 'Generate formatted job postings for multiple platforms (LinkedIn, Indeed, generic) and save to memory.',
      category: ToolCategory.DOCUMENT,
      riskClass: ToolRiskClass.WRITE,
      requiresApproval: false,
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Job title' },
          description: { type: 'string', description: 'Job description' },
          requirements: { type: 'array', items: { type: 'string' }, description: 'List of requirements' },
          location: { type: 'string', description: 'Job location (e.g. "Remote", "New York, NY")' },
          salary: { type: 'string', description: 'Salary range (e.g. "$120k-$160k")' },
        },
        required: ['title', 'description', 'requirements', 'location'],
      },
      outputSchema: { type: 'object', properties: { listings: { type: 'object' } } },
      version: '1.0.0',
    },
    async (input: unknown, context: ToolExecutionContext) => {
      try {
        const { title, description, requirements, location, salary } = input as { title: string; description: string; requirements: string[]; location: string; salary?: string };
        const reqList = requirements.map(r => `- ${r}`).join('\n');
        const salaryLine = salary ? `\nCompensation: ${salary}` : '';
        const linkedin = `**${title}**\n${location}${salaryLine}\n\n${description}\n\n**Requirements:**\n${reqList}\n\n#hiring #${title.replace(/\s+/g, '')}`;
        const indeed = `${title}\nLocation: ${location}${salaryLine}\n\nJob Description:\n${description}\n\nRequirements:\n${reqList}`;
        const generic = `# ${title}\n\n**Location:** ${location}${salaryLine}\n\n## About the Role\n${description}\n\n## Requirements\n${reqList}`;
        const adapter = getMemoryAdapter();
        await adapter.set(`JOB_LISTINGS:${title.replace(/\s+/g, '_').toLowerCase()}`, { title, location, salary, createdAt: new Date().toISOString() }, context.tenantId, { type: 'KNOWLEDGE', source: 'post_job_listing' });
        return { success: true, data: { listings: { linkedin, indeed, generic }, title, location } };
      } catch (err) {
        return { success: false, error: `Job listing generation failed: ${err instanceof Error ? err.message : String(err)}` };
      }
    },
  );

  // 17. generate_offer_letter
  toolRegistry.register(
    {
      name: 'generate_offer_letter',
      description: 'Generate a formal offer letter from template data with candidate name, position, salary, start date, and benefits.',
      category: ToolCategory.DOCUMENT,
      riskClass: ToolRiskClass.WRITE,
      requiresApproval: false,
      inputSchema: {
        type: 'object',
        properties: {
          candidateName: { type: 'string', description: 'Full name of the candidate' },
          position: { type: 'string', description: 'Job title/position offered' },
          salary: { type: 'number', description: 'Annual salary (numeric)' },
          startDate: { type: 'string', description: 'Proposed start date' },
          benefits: { type: 'array', items: { type: 'string' }, description: 'List of benefits' },
        },
        required: ['candidateName', 'position', 'salary', 'startDate'],
      },
      outputSchema: { type: 'object', properties: { letter: { type: 'string' }, filename: { type: 'string' } } },
      version: '1.0.0',
    },
    async (input: unknown, _context: ToolExecutionContext) => {
      try {
        const { candidateName, position, salary, startDate, benefits = [] } = input as { candidateName: string; position: string; salary: number; startDate: string; benefits?: string[] };
        const benefitsList = benefits.length > 0 ? `\n\nBenefits Package:\n${benefits.map(b => `  - ${b}`).join('\n')}` : '';
        const formattedSalary = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(salary);
        const letter = `OFFER OF EMPLOYMENT

Date: ${new Date().toISOString().split('T')[0]}

Dear ${candidateName},

We are pleased to offer you the position of ${position} at our company.

Position: ${position}
Annual Salary: ${formattedSalary}
Start Date: ${startDate}
Employment Type: Full-Time${benefitsList}

This offer is contingent upon successful completion of background verification and any other pre-employment requirements.

Please confirm your acceptance of this offer by signing below and returning this letter by ${new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0]}.

We look forward to having you join our team.

Sincerely,
Human Resources Department

____________________________
Accepted by: ${candidateName}
Date: _______________`;
        const filename = `offer_letter_${candidateName.replace(/\s+/g, '_').toLowerCase()}_${Date.now()}.txt`;
        return { success: true, data: { letter, filename } };
      } catch (err) {
        return { success: false, error: `Offer letter generation failed: ${err instanceof Error ? err.message : String(err)}` };
      }
    },
  );

  // ─── LEGAL EXECUTION TOOLS ─────────────────────────────────────────────────

  // 18. compare_contracts
  toolRegistry.register(
    {
      name: 'compare_contracts',
      description: 'Compare two contract texts and highlight key differences with risk assessment.',
      category: ToolCategory.DOCUMENT,
      riskClass: ToolRiskClass.READ_ONLY,
      requiresApproval: false,
      inputSchema: {
        type: 'object',
        properties: {
          contractA: { type: 'string', description: 'First contract text' },
          contractB: { type: 'string', description: 'Second contract text' },
          focus: { type: 'array', items: { type: 'string' }, description: 'Specific sections to focus on (e.g. ["indemnification", "termination"])' },
        },
        required: ['contractA', 'contractB'],
      },
      outputSchema: { type: 'object', properties: { differences: { type: 'array' }, summary: { type: 'string' } } },
      version: '1.0.0',
    },
    async (input: unknown, _context: ToolExecutionContext) => {
      try {
        const { contractA, contractB, focus = [] } = input as { contractA: string; contractB: string; focus?: string[] };
        const sectionsA = contractA.split(/\n{2,}/);
        const sectionsB = contractB.split(/\n{2,}/);
        const differences: Array<{ section: string; changeType: string; textA: string; textB: string; risk: string }> = [];
        const maxSections = Math.max(sectionsA.length, sectionsB.length);
        for (let i = 0; i < maxSections; i++) {
          const a = (sectionsA[i] ?? '').trim();
          const b = (sectionsB[i] ?? '').trim();
          if (a !== b) {
            const sectionLabel = `Section ${i + 1}`;
            let risk = 'low';
            const combined = (a + b).toLowerCase();
            if (/indemnif|liability|penalty|damages|warrant/i.test(combined)) risk = 'high';
            else if (/terminat|renewal|payment|confidential/i.test(combined)) risk = 'medium';
            if (focus.length === 0 || focus.some(f => combined.includes(f.toLowerCase()))) {
              differences.push({
                section: sectionLabel,
                changeType: !a ? 'added' : !b ? 'removed' : 'modified',
                textA: a.slice(0, 300),
                textB: b.slice(0, 300),
                risk,
              });
            }
          }
        }
        const highRisk = differences.filter(d => d.risk === 'high').length;
        const summary = `Found ${differences.length} differences. ${highRisk} high-risk changes detected. Review carefully before signing.`;
        return { success: true, data: { differences, summary, totalDifferences: differences.length, highRiskCount: highRisk } };
      } catch (err) {
        return { success: false, error: `Contract comparison failed: ${err instanceof Error ? err.message : String(err)}` };
      }
    },
  );

  // 19. extract_obligations
  toolRegistry.register(
    {
      name: 'extract_obligations',
      description: 'Extract key dates, obligations, terms, renewal dates, and termination clauses from contract text.',
      category: ToolCategory.DOCUMENT,
      riskClass: ToolRiskClass.READ_ONLY,
      requiresApproval: false,
      inputSchema: {
        type: 'object',
        properties: {
          contractText: { type: 'string', description: 'Full contract text to analyze' },
        },
        required: ['contractText'],
      },
      outputSchema: { type: 'object', properties: { obligations: { type: 'array' }, renewalDate: { type: 'string' }, terminationClause: { type: 'string' } } },
      version: '1.0.0',
    },
    async (input: unknown, _context: ToolExecutionContext) => {
      try {
        const { contractText } = input as { contractText: string };
        const text = contractText;
        const obligations: Array<{ type: string; description: string; deadline: string | null; party: string }> = [];
        const datePattern = /(\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}|\w+ \d{1,2},?\s*\d{4})/g;
        const dates = text.match(datePattern) ?? [];
        const paymentMatches = text.match(/(?:payment|pay|fee|invoice|billing)[^.]*\./gi) ?? [];
        for (const match of paymentMatches) {
          const dateInMatch = match.match(datePattern);
          obligations.push({ type: 'payment', description: match.trim().slice(0, 200), deadline: dateInMatch?.[0] ?? null, party: 'unspecified' });
        }
        const deliveryMatches = text.match(/(?:deliver|provide|submit|complete|perform)[^.]*\./gi) ?? [];
        for (const match of deliveryMatches.slice(0, 10)) {
          const dateInMatch = match.match(datePattern);
          obligations.push({ type: 'delivery', description: match.trim().slice(0, 200), deadline: dateInMatch?.[0] ?? null, party: 'unspecified' });
        }
        const renewalMatch = text.match(/(?:renewal|renew)[^.]*\./i);
        const terminationMatch = text.match(/(?:termination|terminate)[^.]*(?:\.[^.]*){0,2}\./i);
        return {
          success: true,
          data: {
            obligations,
            dates: dates.slice(0, 20),
            renewalDate: renewalMatch?.[0]?.trim().slice(0, 300) ?? null,
            terminationClause: terminationMatch?.[0]?.trim().slice(0, 500) ?? null,
            totalObligations: obligations.length,
          },
        };
      } catch (err) {
        return { success: false, error: `Obligation extraction failed: ${err instanceof Error ? err.message : String(err)}` };
      }
    },
  );

  // 20. monitor_regulations
  toolRegistry.register(
    {
      name: 'monitor_regulations',
      description: 'Search for recent regulatory changes and compliance updates in a specific industry and jurisdiction.',
      category: ToolCategory.RESEARCH,
      riskClass: ToolRiskClass.READ_ONLY,
      requiresApproval: false,
      inputSchema: {
        type: 'object',
        properties: {
          industry: { type: 'string', description: 'Industry to monitor (e.g. "fintech", "healthcare", "AI")' },
          jurisdiction: { type: 'string', description: 'Jurisdiction (e.g. "US", "EU", "California")' },
          topics: { type: 'array', items: { type: 'string' }, description: 'Specific regulatory topics to search' },
        },
        required: ['industry'],
      },
      outputSchema: { type: 'object', properties: { updates: { type: 'array' } } },
      version: '1.0.0',
    },
    async (input: unknown, _context: ToolExecutionContext) => {
      try {
        const { industry, jurisdiction, topics = [] } = input as { industry: string; jurisdiction?: string; topics?: string[] };
        const queries: string[] = [];
        queries.push(`${industry} regulation change 2026`);
        if (jurisdiction) queries.push(`${jurisdiction} ${industry} compliance update`);
        for (const topic of topics.slice(0, 3)) {
          queries.push(`${industry} ${topic} regulation`);
        }
        const updates: Array<{ title: string; url: string; summary: string; impact: string }> = [];
        for (const query of queries) {
          const { results } = await searchDuckDuckGo(query, 3);
          for (const r of results) {
            const lowerSnippet = r.snippet.toLowerCase();
            let impact = 'informational';
            if (/mandatory|required|must comply|penalty|fine|enforcement/i.test(lowerSnippet)) impact = 'high';
            else if (/proposed|draft|comment period|recommended/i.test(lowerSnippet)) impact = 'medium';
            updates.push({ title: r.title, url: r.url, summary: r.snippet, impact });
          }
        }
        return { success: true, data: { updates, industry, jurisdiction: jurisdiction ?? 'global', totalUpdates: updates.length } };
      } catch (err) {
        return { success: false, error: `Regulation monitoring failed: ${err instanceof Error ? err.message : String(err)}` };
      }
    },
  );

  // ─── GROWTH EXECUTION TOOLS ────────────────────────────────────────────────

  // 21. auto_engage_reddit
  toolRegistry.register(
    {
      name: 'auto_engage_reddit',
      description: 'Find Reddit threads mentioning specific keywords and draft helpful replies for community engagement.',
      category: ToolCategory.RESEARCH,
      riskClass: ToolRiskClass.READ_ONLY,
      requiresApproval: false,
      inputSchema: {
        type: 'object',
        properties: {
          keywords: { type: 'array', items: { type: 'string' }, description: 'Keywords to search for on Reddit' },
          productName: { type: 'string', description: 'Product name to subtly reference in replies' },
          maxThreads: { type: 'number', description: 'Maximum threads to return (default: 5)' },
        },
        required: ['keywords'],
      },
      outputSchema: { type: 'object', properties: { threads: { type: 'array' } } },
      version: '1.0.0',
    },
    async (input: unknown, _context: ToolExecutionContext) => {
      try {
        const { keywords, productName, maxThreads = 5 } = input as { keywords: string[]; productName?: string; maxThreads?: number };
        const threads: Array<{ subreddit: string; title: string; url: string; suggestedReply: string }> = [];
        for (const keyword of keywords) {
          if (threads.length >= maxThreads) break;
          const { results } = await searchDuckDuckGo(`site:reddit.com ${keyword}`, 3);
          for (const r of results) {
            if (threads.length >= maxThreads) break;
            const subredditMatch = r.url.match(/reddit\.com\/r\/([^/]+)/);
            const subreddit = subredditMatch?.[1] ?? 'unknown';
            let reply = `Here's what I've found works well for ${keyword}: [share genuine insight]. `;
            if (productName) reply += `${productName} also addresses this — might be worth looking into.`;
            threads.push({ subreddit, title: r.title, url: r.url, suggestedReply: reply });
          }
        }
        return { success: true, data: { threads } };
      } catch (err) {
        return { success: false, error: `Reddit engagement failed: ${err instanceof Error ? err.message : String(err)}` };
      }
    },
  );

  // 22. auto_engage_twitter
  toolRegistry.register(
    {
      name: 'auto_engage_twitter',
      description: 'Find Twitter/X discussions about specific topics and draft engagement replies.',
      category: ToolCategory.RESEARCH,
      riskClass: ToolRiskClass.READ_ONLY,
      requiresApproval: false,
      inputSchema: {
        type: 'object',
        properties: {
          keywords: { type: 'array', items: { type: 'string' }, description: 'Keywords to search for on Twitter/X' },
          productName: { type: 'string', description: 'Product name to reference in replies' },
        },
        required: ['keywords'],
      },
      outputSchema: { type: 'object', properties: { tweets: { type: 'array' } } },
      version: '1.0.0',
    },
    async (input: unknown, _context: ToolExecutionContext) => {
      try {
        const { keywords, productName } = input as { keywords: string[]; productName?: string };
        const tweets: Array<{ url: string; author: string; snippet: string; suggestedReply: string }> = [];
        for (const keyword of keywords) {
          const { results } = await searchDuckDuckGo(`site:twitter.com ${keyword}`, 3);
          for (const r of results) {
            const authorMatch = r.url.match(/twitter\.com\/([^/]+)/);
            const author = authorMatch?.[1] ?? 'unknown';
            let reply = `Great point about ${keyword}! `;
            reply += `[Add valuable insight here]. `;
            if (productName) reply += `We built ${productName} to tackle exactly this.`;
            tweets.push({ url: r.url, author, snippet: r.snippet, suggestedReply: reply });
          }
        }
        return { success: true, data: { tweets } };
      } catch (err) {
        return { success: false, error: `Twitter engagement failed: ${err instanceof Error ? err.message : String(err)}` };
      }
    },
  );

  // 22b. auto_engage_linkedin
  toolRegistry.register(
    {
      name: 'auto_engage_linkedin',
      description: 'Find LinkedIn discussions and posts about specific topics and draft professional engagement comments. Searches for relevant LinkedIn content and suggests thoughtful, value-adding replies.',
      category: ToolCategory.RESEARCH,
      riskClass: ToolRiskClass.READ_ONLY,
      requiresApproval: false,
      inputSchema: {
        type: 'object',
        properties: {
          keywords: { type: 'array', items: { type: 'string' }, description: 'Keywords to search for on LinkedIn' },
          productName: { type: 'string', description: 'Product name to reference in comments' },
          tone: { type: 'string', description: 'Tone: professional (default), thought-leadership, casual-professional' },
        },
        required: ['keywords'],
      },
      outputSchema: { type: 'object', properties: { posts: { type: 'array' } } },
      version: '1.0.0',
    },
    async (input: unknown, _context: ToolExecutionContext) => {
      try {
        const { keywords, productName, tone = 'professional' } = input as { keywords: string[]; productName?: string; tone?: string };
        const posts: Array<{ url: string; author: string; snippet: string; suggestedComment: string }> = [];
        for (const keyword of keywords) {
          const { results } = await searchDuckDuckGo(`site:linkedin.com/posts ${keyword}`, 3);
          for (const r of results) {
            const authorMatch = r.url.match(/linkedin\.com\/(?:in|posts)\/([^/]+)/);
            const author = authorMatch?.[1]?.replace(/-/g, ' ') ?? 'unknown';
            let comment = '';
            if (tone === 'thought-leadership') {
              comment = `This resonates deeply. ${keyword} is reshaping how we think about automation. `;
              comment += `I have been exploring this space and found that the key differentiator is execution, not just strategy. `;
            } else {
              comment = `Great insights on ${keyword}! `;
              comment += `This aligns with what we are seeing in the market. `;
            }
            if (productName) comment += `At ${productName}, we have been building tools to address exactly this challenge.`;
            posts.push({ url: r.url, author, snippet: r.snippet, suggestedComment: comment });
          }
        }
        return { success: true, data: { posts, tone } };
      } catch (err) {
        return { success: false, error: `LinkedIn engagement failed: ${err instanceof Error ? err.message : String(err)}` };
      }
    },
  );

  // 23. track_lead_pipeline
  toolRegistry.register(
    {
      name: 'track_lead_pipeline',
      description: 'Store and manage leads with stage tracking in persistent memory. Add leads, update stages, and generate pipeline reports.',
      category: ToolCategory.CRM,
      riskClass: ToolRiskClass.WRITE,
      requiresApproval: false,
      inputSchema: {
        type: 'object',
        properties: {
          action: { type: 'string', description: "'add' to add a lead, 'update_stage' to change stage, 'report' to get pipeline" },
          lead: { type: 'object', properties: { name: { type: 'string' }, company: { type: 'string' }, email: { type: 'string' }, stage: { type: 'string' } }, description: 'Lead data (for add action)' },
          leadId: { type: 'string', description: 'Lead identifier for update_stage (use email)' },
        },
        required: ['action'],
      },
      outputSchema: { type: 'object', properties: { pipeline: { type: 'array' }, stageBreakdown: { type: 'object' } } },
      version: '1.0.0',
    },
    async (input: unknown, context: ToolExecutionContext) => {
      try {
        const { action, lead, leadId } = input as { action: 'add' | 'update_stage' | 'report'; lead?: { name: string; company: string; email: string; stage: string }; leadId?: string };
        const adapter = getMemoryAdapter();
        const storageKey = 'LEAD_PIPELINE:leads';
        const existing = await adapter.get(storageKey, context.tenantId);
        const pipeline: Array<{ name: string; company: string; email: string; stage: string; addedAt: string }> = (existing as typeof pipeline) ?? [];
        if (action === 'add' && lead) {
          pipeline.push({ ...lead, addedAt: new Date().toISOString() });
          await adapter.set(storageKey, pipeline, context.tenantId, { type: 'WORKFLOW', source: 'track_lead_pipeline' });
          return { success: true, data: { message: `Lead added: ${lead.name}`, pipeline } };
        }
        if (action === 'update_stage' && leadId && lead?.stage) {
          const idx = pipeline.findIndex(l => l.email === leadId);
          if (idx >= 0) {
            pipeline[idx]!.stage = lead.stage;
            await adapter.set(storageKey, pipeline, context.tenantId, { type: 'WORKFLOW', source: 'track_lead_pipeline' });
            return { success: true, data: { message: `Lead stage updated: ${pipeline[idx]!.name} -> ${lead.stage}`, pipeline } };
          }
          return { success: false, error: `Lead not found: ${leadId}` };
        }
        const stageBreakdown: Record<string, number> = {};
        for (const l of pipeline) {
          stageBreakdown[l.stage] = (stageBreakdown[l.stage] ?? 0) + 1;
        }
        return { success: true, data: { pipeline, stageBreakdown, totalLeads: pipeline.length } };
      } catch (err) {
        return { success: false, error: `Lead pipeline tracking failed: ${err instanceof Error ? err.message : String(err)}` };
      }
    },
  );

  // ─── CUSTOMER SUCCESS EXECUTION TOOLS ──────────────────────────────────────

  // 24. track_customer_health
  toolRegistry.register(
    {
      name: 'track_customer_health',
      description: 'Store customer health scores over time, detect trends, and generate risk alerts.',
      category: ToolCategory.CRM,
      riskClass: ToolRiskClass.WRITE,
      requiresApproval: false,
      inputSchema: {
        type: 'object',
        properties: {
          action: { type: 'string', description: "'score' to record a health score, 'history' to get score history, 'alerts' to get risk alerts" },
          customerId: { type: 'string', description: 'Unique customer identifier' },
          healthScore: { type: 'number', description: 'Health score (0-100) to record' },
          factors: { type: 'object', description: 'Contributing factors as key-value pairs (e.g. { "usage": 80, "satisfaction": 90 })' },
        },
        required: ['action', 'customerId'],
      },
      outputSchema: { type: 'object', properties: { current: { type: 'object' }, history: { type: 'array' } } },
      version: '1.0.0',
    },
    async (input: unknown, context: ToolExecutionContext) => {
      try {
        const { action, customerId, healthScore, factors } = input as { action: 'score' | 'history' | 'alerts'; customerId: string; healthScore?: number; factors?: Record<string, unknown> };
        const adapter = getMemoryAdapter();
        const storageKey = `CUSTOMER_HEALTH:${customerId}`;
        const existing = await adapter.get(storageKey, context.tenantId);
        const history: Array<{ date: string; score: number; factors?: Record<string, unknown> }> = (existing as typeof history) ?? [];
        if (action === 'score' && healthScore !== undefined) {
          history.push({ date: new Date().toISOString(), score: healthScore, factors });
          await adapter.set(storageKey, history, context.tenantId, { type: 'KNOWLEDGE', source: 'track_customer_health' });
          const trend = history.length >= 2 ? (healthScore > history[history.length - 2]!.score ? 'improving' : healthScore < history[history.length - 2]!.score ? 'declining' : 'stable') : 'new';
          const riskLevel = healthScore >= 70 ? 'healthy' : healthScore >= 40 ? 'at_risk' : 'critical';
          return { success: true, data: { current: { score: healthScore, trend, riskLevel, customerId }, history } };
        }
        if (action === 'alerts') {
          const latestScore = history.length > 0 ? history[history.length - 1]!.score : null;
          const alerts: string[] = [];
          if (latestScore !== null && latestScore < 40) alerts.push(`CRITICAL: Customer ${customerId} health score is ${latestScore}`);
          if (history.length >= 3) {
            const recent = history.slice(-3);
            if (recent.every((h, i) => i === 0 || h.score < recent[i - 1]!.score)) {
              alerts.push(`WARNING: ${customerId} shows declining trend over last ${recent.length} measurements`);
            }
          }
          return { success: true, data: { alerts, customerId, latestScore } };
        }
        return { success: true, data: { history, customerId, dataPoints: history.length } };
      } catch (err) {
        return { success: false, error: `Customer health tracking failed: ${err instanceof Error ? err.message : String(err)}` };
      }
    },
  );

  // 25. generate_qbr_deck
  toolRegistry.register(
    {
      name: 'generate_qbr_deck',
      description: 'Compile customer data into a Quarterly Business Review (QBR) format with metrics, wins, and challenges.',
      category: ToolCategory.DOCUMENT,
      riskClass: ToolRiskClass.WRITE,
      requiresApproval: false,
      inputSchema: {
        type: 'object',
        properties: {
          customerName: { type: 'string', description: 'Customer/account name' },
          period: { type: 'string', description: 'Review period (e.g. "Q1 2026")' },
          metrics: { type: 'object', description: 'Key performance metrics as key-value pairs' },
          wins: { type: 'array', items: { type: 'string' }, description: 'Key wins and achievements during the period' },
          challenges: { type: 'array', items: { type: 'string' }, description: 'Challenges and areas for improvement' },
        },
        required: ['customerName', 'period'],
      },
      outputSchema: { type: 'object', properties: { qbr: { type: 'string' } } },
      version: '1.0.0',
    },
    async (input: unknown, context: ToolExecutionContext) => {
      try {
        const { customerName, period, metrics = {}, wins = [], challenges = [] } = input as { customerName: string; period: string; metrics?: Record<string, unknown>; wins?: string[]; challenges?: string[] };
        const reportResult = await toolRegistry.execute('generate_report', {
          reportType: 'custom',
          title: `Quarterly Business Review: ${customerName} - ${period}`,
          data: { customerName, period, metrics, wins, challenges },
        }, context);
        const metricsSection = Object.entries(metrics).map(([k, v]) => `  - ${k}: ${v}`).join('\n');
        const winsSection = wins.map(w => `  - ${w}`).join('\n');
        const challengesSection = challenges.map(c => `  - ${c}`).join('\n');
        const qbr = `# Quarterly Business Review\n## ${customerName} | ${period}\n\n### Key Metrics\n${metricsSection || '  (No metrics provided)'}\n\n### Wins & Achievements\n${winsSection || '  (No wins recorded)'}\n\n### Challenges & Action Items\n${challengesSection || '  (No challenges noted)'}\n\n### Next Steps\n  - Review action items from previous QBR\n  - Set goals for next quarter\n  - Schedule follow-up meeting\n\nGenerated: ${new Date().toISOString()}`;
        return { success: true, data: { qbr, reportMeta: reportResult } };
      } catch (err) {
        return { success: false, error: `QBR generation failed: ${err instanceof Error ? err.message : String(err)}` };
      }
    },
  );

  // ─── PHORING.AI INTEGRATION TOOLS ───────────────────────────────────────────
  // Phoring tools disabled

  // ─── SANDBOX / VIBE CODING TOOLS ─────────────────────────────────────────

  toolRegistry.register(
    {
      name: 'sandbox_create',
      description: 'Create an isolated sandbox environment for code execution. Returns sandbox ID and info.',
      category: ToolCategory.BROWSER,
      riskClass: ToolRiskClass.WRITE,
      requiresApproval: false,
      inputSchema: {
        type: 'object',
        properties: {
          template: { type: 'string', description: 'Sandbox template: node, nextjs, python' },
          timeoutMs: { type: 'number', description: 'Max lifetime in milliseconds (default 30 min)' },
        },
      },
      outputSchema: { type: 'object', properties: { id: { type: 'string' }, status: { type: 'string' } } },
      version: '1.0.0',
    },
    async (input: unknown) => {
      const { getSandboxAdapter } = await import('../adapters/sandbox/index.js');
      const adapter = await getSandboxAdapter();
      const opts = input as { template?: string; timeoutMs?: number } | undefined;
      return adapter.create({ template: opts?.template, timeoutMs: opts?.timeoutMs });
    },
  );

  toolRegistry.register(
    {
      name: 'sandbox_write_file',
      description: 'Write a file to the sandbox filesystem.',
      category: ToolCategory.BROWSER,
      riskClass: ToolRiskClass.WRITE,
      requiresApproval: false,
      inputSchema: {
        type: 'object',
        properties: {
          sandboxId: { type: 'string', description: 'Sandbox ID' },
          path: { type: 'string', description: 'File path within sandbox' },
          content: { type: 'string', description: 'File content' },
        },
        required: ['sandboxId', 'path', 'content'],
      },
      outputSchema: { type: 'object', properties: { success: { type: 'boolean' } } },
      version: '1.0.0',
    },
    async (input: unknown) => {
      const { getSandboxAdapter } = await import('../adapters/sandbox/index.js');
      const adapter = await getSandboxAdapter();
      const { sandboxId, path, content } = input as { sandboxId: string; path: string; content: string };
      await adapter.writeFile(sandboxId, path, content);
      return { success: true };
    },
  );

  toolRegistry.register(
    {
      name: 'sandbox_exec',
      description: 'Execute a shell command in the sandbox. Returns stdout, stderr, and exit code.',
      category: ToolCategory.BROWSER,
      riskClass: ToolRiskClass.EXTERNAL_SIDE_EFFECT,
      // FIX #8: Require approval for arbitrary command execution
      requiresApproval: true,
      inputSchema: {
        type: 'object',
        properties: {
          sandboxId: { type: 'string', description: 'Sandbox ID' },
          command: { type: 'string', description: 'Shell command to execute' },
          cwd: { type: 'string', description: 'Working directory (default: /home/user/project)' },
          timeoutMs: { type: 'number', description: 'Command timeout in ms (default 120s)' },
        },
        required: ['sandboxId', 'command'],
      },
      outputSchema: {
        type: 'object',
        properties: {
          stdout: { type: 'string' },
          stderr: { type: 'string' },
          exitCode: { type: 'number' },
          durationMs: { type: 'number' },
        },
      },
      version: '1.0.0',
    },
    async (input: unknown) => {
      const { getSandboxAdapter } = await import('../adapters/sandbox/index.js');
      const adapter = await getSandboxAdapter();
      const { sandboxId, command, cwd, timeoutMs } = input as { sandboxId: string; command: string; cwd?: string; timeoutMs?: number };
      return adapter.exec(sandboxId, command, { cwd, timeoutMs });
    },
  );

  toolRegistry.register(
    {
      name: 'sandbox_install_deps',
      description: 'Install npm dependencies in the sandbox.',
      category: ToolCategory.BROWSER,
      riskClass: ToolRiskClass.WRITE,
      requiresApproval: false,
      inputSchema: {
        type: 'object',
        properties: {
          sandboxId: { type: 'string', description: 'Sandbox ID' },
          cwd: { type: 'string', description: 'Working directory' },
        },
        required: ['sandboxId'],
      },
      outputSchema: {
        type: 'object',
        properties: { stdout: { type: 'string' }, stderr: { type: 'string' }, exitCode: { type: 'number' } },
      },
      version: '1.0.0',
    },
    async (input: unknown) => {
      const { getSandboxAdapter } = await import('../adapters/sandbox/index.js');
      const adapter = await getSandboxAdapter();
      const { sandboxId, cwd } = input as { sandboxId: string; cwd?: string };
      return adapter.installDeps(sandboxId, cwd);
    },
  );

  toolRegistry.register(
    {
      name: 'sandbox_start_dev_server',
      description: 'Start a development server in the sandbox and return the preview URL.',
      category: ToolCategory.BROWSER,
      riskClass: ToolRiskClass.EXTERNAL_SIDE_EFFECT,
      requiresApproval: false,
      inputSchema: {
        type: 'object',
        properties: {
          sandboxId: { type: 'string', description: 'Sandbox ID' },
          command: { type: 'string', description: 'Dev server command (default: npm run dev)' },
          port: { type: 'number', description: 'Port to expose (default: 3000)' },
        },
        required: ['sandboxId'],
      },
      outputSchema: { type: 'object', properties: { previewUrl: { type: 'string' } } },
      version: '1.0.0',
    },
    async (input: unknown) => {
      const { getSandboxAdapter } = await import('../adapters/sandbox/index.js');
      const adapter = await getSandboxAdapter();
      const { sandboxId, command, port } = input as { sandboxId: string; command?: string; port?: number };
      const previewUrl = await adapter.startDevServer(sandboxId, { command, port });
      return { previewUrl };
    },
  );

  toolRegistry.register(
    {
      name: 'sandbox_get_preview_url',
      description: 'Get the preview URL for a running sandbox dev server.',
      category: ToolCategory.BROWSER,
      riskClass: ToolRiskClass.READ_ONLY,
      requiresApproval: false,
      inputSchema: {
        type: 'object',
        properties: {
          sandboxId: { type: 'string', description: 'Sandbox ID' },
          port: { type: 'number', description: 'Port (default: 3000)' },
        },
        required: ['sandboxId'],
      },
      outputSchema: { type: 'object', properties: { previewUrl: { type: 'string' } } },
      version: '1.0.0',
    },
    async (input: unknown) => {
      const { getSandboxAdapter } = await import('../adapters/sandbox/index.js');
      const adapter = await getSandboxAdapter();
      const { sandboxId, port } = input as { sandboxId: string; port?: number };
      const previewUrl = await adapter.getPreviewUrl(sandboxId, port);
      return { previewUrl };
    },
  );

  toolRegistry.register(
    {
      name: 'sandbox_destroy',
      description: 'Destroy a sandbox environment and release all resources.',
      category: ToolCategory.BROWSER,
      riskClass: ToolRiskClass.DESTRUCTIVE,
      requiresApproval: true,
      inputSchema: {
        type: 'object',
        properties: { sandboxId: { type: 'string', description: 'Sandbox ID to destroy' } },
        required: ['sandboxId'],
      },
      outputSchema: { type: 'object', properties: { success: { type: 'boolean' } } },
      version: '1.0.0',
    },
    async (input: unknown) => {
      const { getSandboxAdapter } = await import('../adapters/sandbox/index.js');
      const adapter = await getSandboxAdapter();
      const { sandboxId } = input as { sandboxId: string };
      await adapter.destroy(sandboxId);
      return { success: true };
    },
  );

  // ─── VERIFICATION & RISK INTELLIGENCE TOOLS ───────────────────────────────

  toolRegistry.register(
    {
      name: 'verify_email',
      description: 'Analyze an email for phishing, spoofing, spam, and social engineering threats. Returns risk score, findings, and recommended actions.',
      category: ToolCategory.RESEARCH,
      riskClass: ToolRiskClass.READ_ONLY,
      requiresApproval: false,
      inputSchema: {
        type: 'object',
        properties: {
          content: { type: 'string', description: 'Email body text' },
          metadata: {
            type: 'object',
            properties: {
              from: { type: 'string', description: 'Sender email address' },
              fromName: { type: 'string', description: 'Sender display name' },
              subject: { type: 'string', description: 'Email subject line' },
              headers: { type: 'string', description: 'Raw email headers (for SPF/DKIM)' },
            },
          },
        },
        required: ['content'],
      },
      outputSchema: { type: 'object', description: 'VerificationResult with risk score, findings, actions, audit' },
      version: '1.0.0',
    },
    async (input: unknown, context: ToolExecutionContext) => {
      const { verify } = await import('@jak-swarm/verification');
      const { content, metadata } = input as { content: string; metadata?: Record<string, unknown> };
      return verify({ type: 'EMAIL', content, contentType: 'message/rfc822', metadata, tenantId: context.tenantId, userId: context.userId, workflowId: context.workflowId });
    },
  );

  toolRegistry.register(
    {
      name: 'verify_document',
      description: 'Check a document for tampering, forgery indicators, and metadata anomalies. Works with PDFs, certificates, contracts.',
      category: ToolCategory.RESEARCH,
      riskClass: ToolRiskClass.READ_ONLY,
      requiresApproval: false,
      inputSchema: {
        type: 'object',
        properties: {
          content: { type: 'string', description: 'Document text content or base64' },
          metadata: {
            type: 'object',
            properties: {
              createdDate: { type: 'string', description: 'Document creation date (ISO)' },
              modifiedDate: { type: 'string', description: 'Last modification date (ISO)' },
              author: { type: 'string', description: 'Metadata author field' },
              signer: { type: 'string', description: 'Who signed the document' },
              fontCount: { type: 'number', description: 'Number of distinct fonts used' },
            },
          },
        },
        required: ['content'],
      },
      outputSchema: { type: 'object', description: 'VerificationResult with risk score, findings, actions, audit' },
      version: '1.0.0',
    },
    async (input: unknown, context: ToolExecutionContext) => {
      const { verify } = await import('@jak-swarm/verification');
      const { content, metadata } = input as { content: string; metadata?: Record<string, unknown> };
      return verify({ type: 'DOCUMENT', content, contentType: 'application/pdf', metadata, tenantId: context.tenantId, userId: context.userId, workflowId: context.workflowId });
    },
  );

  toolRegistry.register(
    {
      name: 'verify_transaction',
      description: 'Analyze invoices, payments, and financial transactions for anomalies, fraud indicators, and suspicious patterns.',
      category: ToolCategory.RESEARCH,
      riskClass: ToolRiskClass.READ_ONLY,
      requiresApproval: false,
      inputSchema: {
        type: 'object',
        properties: {
          content: { type: 'string', description: 'Invoice/transaction text content' },
          metadata: {
            type: 'object',
            properties: {
              vendor: { type: 'string', description: 'Vendor/supplier name' },
              amount: { type: 'number', description: 'Transaction amount' },
              currency: { type: 'string', description: 'Currency code' },
              previousVendorBank: { type: 'string', description: 'Previously known bank details for this vendor' },
            },
          },
        },
        required: ['content'],
      },
      outputSchema: { type: 'object', description: 'VerificationResult with risk score, findings, actions, audit' },
      version: '1.0.0',
    },
    async (input: unknown, context: ToolExecutionContext) => {
      const { verify } = await import('@jak-swarm/verification');
      const { content, metadata } = input as { content: string; metadata?: Record<string, unknown> };
      return verify({ type: 'TRANSACTION', content, contentType: 'text/plain', metadata, tenantId: context.tenantId, userId: context.userId, workflowId: context.workflowId });
    },
  );

  toolRegistry.register(
    {
      name: 'verify_identity',
      description: 'Verify resumes, credentials, and identity documents for accuracy, timeline consistency, and credential validity.',
      category: ToolCategory.RESEARCH,
      riskClass: ToolRiskClass.READ_ONLY,
      requiresApproval: false,
      inputSchema: {
        type: 'object',
        properties: {
          content: { type: 'string', description: 'Resume/credential text content' },
          metadata: {
            type: 'object',
            properties: {
              candidateName: { type: 'string', description: 'Name of the person' },
              linkedinUrl: { type: 'string', description: 'LinkedIn profile URL for cross-reference' },
            },
          },
        },
        required: ['content'],
      },
      outputSchema: { type: 'object', description: 'VerificationResult with risk score, findings, actions, audit' },
      version: '1.0.0',
    },
    async (input: unknown, context: ToolExecutionContext) => {
      const { verify } = await import('@jak-swarm/verification');
      const { content, metadata } = input as { content: string; metadata?: Record<string, unknown> };
      return verify({ type: 'IDENTITY', content, contentType: 'text/plain', metadata, tenantId: context.tenantId, userId: context.userId, workflowId: context.workflowId });
    },
  );

  toolRegistry.register(
    {
      name: 'cross_verify',
      description: 'Cross-reference multiple items (emails, documents, transactions, identities) to detect coordinated fraud patterns that single-type analysis would miss.',
      category: ToolCategory.RESEARCH,
      riskClass: ToolRiskClass.READ_ONLY,
      requiresApproval: false,
      inputSchema: {
        type: 'object',
        properties: {
          content: { type: 'string', description: 'Primary item content' },
          contentType: { type: 'string', description: 'Primary item type' },
          type: { type: 'string', enum: ['EMAIL', 'DOCUMENT', 'TRANSACTION', 'IDENTITY'], description: 'Primary item verification type' },
          relatedItems: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                type: { type: 'string', enum: ['EMAIL', 'DOCUMENT', 'TRANSACTION', 'IDENTITY'] },
                content: { type: 'string' },
                contentType: { type: 'string' },
              },
              required: ['type', 'content', 'contentType'],
            },
            description: 'Related items to cross-reference',
          },
        },
        required: ['content', 'type', 'relatedItems'],
      },
      outputSchema: { type: 'object', description: 'VerificationResult with cross-evidence findings' },
      version: '1.0.0',
    },
    async (input: unknown, context: ToolExecutionContext) => {
      const { verify } = await import('@jak-swarm/verification');
      const data = input as { content: string; type: string; contentType?: string; relatedItems: Array<{ type: string; content: string; contentType: string }> };
      return verify({
        type: 'CROSS_VERIFY',
        content: data.content,
        contentType: data.contentType ?? 'text/plain',
        relatedItems: data.relatedItems.map(item => ({ ...item, type: item.type as 'EMAIL' | 'DOCUMENT' | 'TRANSACTION' | 'IDENTITY' })),
        tenantId: context.tenantId,
        userId: context.userId,
        workflowId: context.workflowId,
      });
    },
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // DEPLOYMENT TOOLS (Vercel + GitHub)
  // ═══════════════════════════════════════════════════════════════════════════

  toolRegistry.register(
    {
      name: 'deploy_to_vercel',
      description: 'Deploy a project to Vercel. Requires VERCEL_TOKEN env var.',
      category: ToolCategory.WEBHOOK,
      riskClass: ToolRiskClass.EXTERNAL_SIDE_EFFECT,
      requiresApproval: true,
      inputSchema: {
        type: 'object',
        properties: {
          projectName: { type: 'string', description: 'Vercel project name' },
          gitRepo: { type: 'string', description: 'GitHub repo (owner/name) to deploy from' },
          framework: { type: 'string', description: 'Framework (nextjs, vite, etc.)' },
          environmentVariables: { type: 'object', description: 'Env vars as key-value pairs' },
        },
        required: ['projectName'],
      },
      outputSchema: { type: 'object' },
      version: '1.0.0',
    },
    async (input: unknown) => {
      const token = process.env['VERCEL_TOKEN'];
      if (!token) return { success: false, error: 'VERCEL_TOKEN not configured. Set it in environment variables.' };

      const { projectName, gitRepo, framework } = input as {
        projectName: string; gitRepo?: string; framework?: string;
        environmentVariables?: Record<string, string>;
      };

      const body: Record<string, unknown> = {
        name: projectName,
        ...(gitRepo ? { gitSource: { type: 'github', repo: gitRepo, ref: 'main' } } : {}),
        ...(framework ? { framework } : {}),
      };

      const res = await fetch('https://api.vercel.com/v13/deployments', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.text().catch(() => '');
        return { success: false, error: `Vercel API ${res.status}: ${err}` };
      }

      const data = await res.json() as { id: string; url: string; readyState: string };
      return { success: true, deploymentId: data.id, url: `https://${data.url}`, status: data.readyState };
    },
  );

  toolRegistry.register(
    {
      name: 'github_create_repo',
      description: 'Create a new GitHub repository. Requires GITHUB_PAT env var.',
      category: ToolCategory.RESEARCH,
      riskClass: ToolRiskClass.EXTERNAL_SIDE_EFFECT,
      requiresApproval: true,
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Repository name' },
          description: { type: 'string', description: 'Repository description' },
          private: { type: 'boolean', description: 'Make repo private (default: false)' },
          autoInit: { type: 'boolean', description: 'Initialize with README (default: true)' },
        },
        required: ['name'],
      },
      outputSchema: { type: 'object' },
      version: '1.0.0',
    },
    async (input: unknown) => {
      const token = process.env['GITHUB_PAT'];
      if (!token) return { success: false, error: 'GITHUB_PAT not configured.' };

      const { name, description, private: isPrivate, autoInit } = input as {
        name: string; description?: string; private?: boolean; autoInit?: boolean;
      };

      const res = await fetch('https://api.github.com/user/repos', {
        method: 'POST',
        headers: { Authorization: `token ${token}`, 'Content-Type': 'application/json', 'User-Agent': 'JAK-Swarm' },
        body: JSON.stringify({ name, description, private: isPrivate ?? false, auto_init: autoInit ?? true }),
      });

      if (!res.ok) {
        const err = await res.text().catch(() => '');
        return { success: false, error: `GitHub API ${res.status}: ${err}` };
      }

      const data = await res.json() as { full_name: string; html_url: string; clone_url: string };
      return { success: true, fullName: data.full_name, url: data.html_url, cloneUrl: data.clone_url };
    },
  );

  toolRegistry.register(
    {
      name: 'github_push_files',
      description: 'Push multiple files to a GitHub repo in a single commit. Uses the Git Trees API. Requires GITHUB_PAT.',
      category: ToolCategory.RESEARCH,
      riskClass: ToolRiskClass.EXTERNAL_SIDE_EFFECT,
      requiresApproval: true,
      inputSchema: {
        type: 'object',
        properties: {
          owner: { type: 'string', description: 'Repository owner' },
          repo: { type: 'string', description: 'Repository name' },
          branch: { type: 'string', description: 'Branch name (default: main)' },
          files: { type: 'array', items: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] } },
          commitMessage: { type: 'string', description: 'Commit message' },
        },
        required: ['owner', 'repo', 'files', 'commitMessage'],
      },
      outputSchema: { type: 'object' },
      version: '1.0.0',
    },
    async (input: unknown) => {
      const token = process.env['GITHUB_PAT'];
      if (!token) return { success: false, error: 'GITHUB_PAT not configured.' };

      const { owner, repo, branch = 'main', files, commitMessage } = input as {
        owner: string; repo: string; branch?: string;
        files: Array<{ path: string; content: string }>; commitMessage: string;
      };

      const headers = { Authorization: `token ${token}`, 'Content-Type': 'application/json', 'User-Agent': 'JAK-Swarm' };
      const apiBase = `https://api.github.com/repos/${owner}/${repo}`;

      try {
        // 1. Get current commit SHA for the branch
        const refRes = await fetch(`${apiBase}/git/ref/heads/${branch}`, { headers });
        if (!refRes.ok) return { success: false, error: `Branch '${branch}' not found.` };
        const refData = await refRes.json() as { object: { sha: string } };
        const baseSha = refData.object.sha;

        // 2. Create blobs for each file
        const treeItems: Array<{ path: string; mode: string; type: string; sha: string }> = [];
        for (const file of files) {
          const blobRes = await fetch(`${apiBase}/git/blobs`, {
            method: 'POST', headers,
            body: JSON.stringify({ content: file.content, encoding: 'utf-8' }),
          });
          const blobData = await blobRes.json() as { sha: string };
          treeItems.push({ path: file.path, mode: '100644', type: 'blob', sha: blobData.sha });
        }

        // 3. Create tree
        const treeRes = await fetch(`${apiBase}/git/trees`, {
          method: 'POST', headers,
          body: JSON.stringify({ base_tree: baseSha, tree: treeItems }),
        });
        const treeData = await treeRes.json() as { sha: string };

        // 4. Create commit
        const commitRes = await fetch(`${apiBase}/git/commits`, {
          method: 'POST', headers,
          body: JSON.stringify({ message: commitMessage, tree: treeData.sha, parents: [baseSha] }),
        });
        const commitData = await commitRes.json() as { sha: string; html_url: string };

        // 5. Update branch ref
        await fetch(`${apiBase}/git/refs/heads/${branch}`, {
          method: 'PATCH', headers,
          body: JSON.stringify({ sha: commitData.sha }),
        });

        return { success: true, commitSha: commitData.sha, url: commitData.html_url, filesPushed: files.length };
      } catch (err) {
        return { success: false, error: `GitHub push failed: ${err instanceof Error ? err.message : String(err)}` };
      }
    },
  );

  toolRegistry.register(
    {
      name: 'github_review_pr',
      description: 'Fetch a GitHub pull request with diff for code review. Requires GITHUB_PAT.',
      category: ToolCategory.RESEARCH,
      riskClass: ToolRiskClass.READ_ONLY,
      requiresApproval: false,
      inputSchema: {
        type: 'object',
        properties: {
          owner: { type: 'string' },
          repo: { type: 'string' },
          pullNumber: { type: 'number' },
        },
        required: ['owner', 'repo', 'pullNumber'],
      },
      outputSchema: { type: 'object' },
      version: '1.0.0',
    },
    async (input: unknown) => {
      const token = process.env['GITHUB_PAT'];
      const { owner, repo, pullNumber } = input as { owner: string; repo: string; pullNumber: number };
      const headers: Record<string, string> = { 'User-Agent': 'JAK-Swarm', 'Accept': 'application/json' };
      if (token) headers['Authorization'] = `token ${token}`;

      const [prRes, diffRes] = await Promise.all([
        fetch(`https://api.github.com/repos/${owner}/${repo}/pulls/${pullNumber}`, { headers }),
        fetch(`https://api.github.com/repos/${owner}/${repo}/pulls/${pullNumber}`, {
          headers: { ...headers, Accept: 'application/vnd.github.v3.diff' },
        }),
      ]);

      if (!prRes.ok) return { success: false, error: `PR not found: ${prRes.status}` };

      const pr = await prRes.json() as {
        title: string; body: string; user: { login: string }; state: string;
        mergeable: boolean | null; changed_files: number; additions: number; deletions: number;
      };
      const diff = await diffRes.text();

      return {
        success: true,
        title: pr.title,
        description: pr.body,
        author: pr.user.login,
        state: pr.state,
        mergeable: pr.mergeable,
        changedFiles: pr.changed_files,
        additions: pr.additions,
        deletions: pr.deletions,
        diff: diff.slice(0, 15000), // Truncate large diffs
      };
    },
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // CEO EXECUTIVE SUMMARY TOOL
  // ═══════════════════════════════════════════════════════════════════════════

  toolRegistry.register(
    {
      name: 'compile_executive_summary',
      description: 'Compile an executive dashboard summary from recent workflows, memory, and traces. Used by the Strategist/CEO agent.',
      category: ToolCategory.KNOWLEDGE,
      riskClass: ToolRiskClass.READ_ONLY,
      requiresApproval: false,
      inputSchema: {
        type: 'object',
        properties: {
          timeRangeDays: { type: 'number', description: 'Number of days to look back (default: 7)' },
        },
      },
      outputSchema: { type: 'object' },
      version: '1.0.0',
    },
    async (input: unknown, context: ToolExecutionContext) => {
      const { timeRangeDays = 7 } = input as { timeRangeDays?: number };
      const since = new Date(Date.now() - timeRangeDays * 24 * 60 * 60 * 1000);

      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const dbModule = require('@jak-swarm/db');
        const prisma = dbModule.prisma;
        if (!prisma) return { error: 'Database not available.' };

        const [workflows, recentMemory, recentTraces] = await Promise.all([
          prisma.workflow.findMany({
            where: { tenantId: context.tenantId, createdAt: { gte: since } },
            select: { id: true, goal: true, status: true, totalCostUsd: true, createdAt: true },
            orderBy: { createdAt: 'desc' },
            take: 50,
          }),
          prisma.memoryItem.findMany({
            where: {
              tenantId: context.tenantId,
              scopeType: 'TENANT',
              scopeId: context.tenantId,
              memoryType: { in: ['KNOWLEDGE', 'POLICY'] },
              deletedAt: null,
            },
            orderBy: { updatedAt: 'desc' },
            take: 20,
          }),
          prisma.agentTrace.findMany({
            where: {
              workflow: { tenantId: context.tenantId },
              startedAt: { gte: since },
            },
            select: { agentRole: true, durationMs: true, error: true },
            take: 200,
          }),
        ]);

        // Aggregate
        const statusCounts: Record<string, number> = {};
        let totalCost = 0;
        for (const w of workflows) {
          statusCounts[w.status] = (statusCounts[w.status] ?? 0) + 1;
          totalCost += w.totalCostUsd ?? 0;
        }

        const agentUsage: Record<string, { calls: number; errors: number; avgDurationMs: number }> = {};
        for (const t of recentTraces) {
          const role = t.agentRole;
          if (!agentUsage[role]) agentUsage[role] = { calls: 0, errors: 0, avgDurationMs: 0 };
          agentUsage[role]!.calls++;
          if (t.error) agentUsage[role]!.errors++;
          agentUsage[role]!.avgDurationMs += (t.durationMs ?? 0);
        }
        for (const role of Object.keys(agentUsage)) {
          agentUsage[role]!.avgDurationMs = Math.round(agentUsage[role]!.avgDurationMs / agentUsage[role]!.calls);
        }

        return {
          period: { days: timeRangeDays, since: since.toISOString() },
          workflows: {
            total: workflows.length,
            statusBreakdown: statusCounts,
            totalCostUsd: Math.round(totalCost * 100) / 100,
            recentGoals: workflows.slice(0, 10).map((w: { goal: string; status: string }) => ({ goal: w.goal, status: w.status })),
          },
          agentUsage,
          knowledgeEntries: recentMemory.length,
          connected: true,
        };
      } catch {
        return { error: 'Failed to compile executive summary — database unavailable.', connected: false };
      }
    },
  );
}

// ---------------------------------------------------------------------------
// Module-level helpers
// ---------------------------------------------------------------------------

function buildIdempotencyKey(
  context: ToolExecutionContext,
  key: string,
  scopeType: string,
  scopeId: string,
  value: unknown,
): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createHash } = require('crypto') as typeof import('crypto');
  const content = `${context.tenantId}:${scopeType}:${scopeId}:${key}:${context.runId ?? ''}:${JSON.stringify(value ?? null)}`;
  return createHash('sha256').update(content).digest('hex').slice(0, 48);
}
