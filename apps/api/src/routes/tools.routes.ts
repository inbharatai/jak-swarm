import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { ok, err } from '../types.js';
import { AppError, NotFoundError } from '../errors.js';

/**
 * Static registry of built-in tools available to agents.
 * In a full implementation this would be hydrated from a database or a
 * plugin registry; for now the catalogue is defined inline.
 */
const TOOL_REGISTRY = [
  {
    name: 'web_search',
    displayName: 'Web Search',
    description: 'Search the internet using a search engine',
    riskClass: 'LOW',
    category: 'research',
    permissions: ['internet'],
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string' }, maxResults: { type: 'number', default: 10 } },
      required: ['query'],
    },
    outputSchema: {
      type: 'object',
      properties: {
        results: {
          type: 'array',
          items: { type: 'object', properties: { title: { type: 'string' }, url: { type: 'string' }, snippet: { type: 'string' } } },
        },
      },
    },
    enabled: true,
  },
  {
    name: 'browser_navigate',
    displayName: 'Browser Navigate',
    description: 'Navigate to a URL and extract page content',
    riskClass: 'LOW',
    category: 'browser',
    permissions: ['internet'],
    inputSchema: {
      type: 'object',
      properties: { url: { type: 'string', format: 'uri' } },
      required: ['url'],
    },
    outputSchema: {
      type: 'object',
      properties: { title: { type: 'string' }, content: { type: 'string' }, links: { type: 'array' } },
    },
    enabled: true,
  },
  {
    name: 'browser_click',
    displayName: 'Browser Click',
    description: 'Click on a DOM element identified by selector',
    riskClass: 'MEDIUM',
    category: 'browser',
    permissions: ['internet'],
    inputSchema: {
      type: 'object',
      properties: { selector: { type: 'string' }, text: { type: 'string' } },
    },
    outputSchema: { type: 'object', properties: { success: { type: 'boolean' } } },
    enabled: true,
  },
  {
    name: 'browser_fill',
    displayName: 'Browser Fill',
    description: 'Fill an input field with a value',
    riskClass: 'HIGH',
    category: 'browser',
    permissions: ['internet'],
    inputSchema: {
      type: 'object',
      properties: { selector: { type: 'string' }, value: { type: 'string' } },
      required: ['selector', 'value'],
    },
    outputSchema: { type: 'object', properties: { success: { type: 'boolean' } } },
    enabled: true,
  },
  {
    name: 'code_execute',
    displayName: 'Code Execute',
    description: 'Execute a Python or JavaScript snippet in a sandbox',
    riskClass: 'HIGH',
    category: 'compute',
    permissions: ['sandbox'],
    inputSchema: {
      type: 'object',
      properties: {
        language: { type: 'string', enum: ['python', 'javascript'] },
        code: { type: 'string' },
        timeout: { type: 'number', default: 30 },
      },
      required: ['language', 'code'],
    },
    outputSchema: {
      type: 'object',
      properties: { stdout: { type: 'string' }, stderr: { type: 'string' }, exitCode: { type: 'number' } },
    },
    enabled: true,
  },
  {
    name: 'file_read',
    displayName: 'File Read',
    description: 'Read contents of a file from the agent workspace',
    riskClass: 'LOW',
    category: 'filesystem',
    permissions: ['workspace'],
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
    },
    outputSchema: { type: 'object', properties: { content: { type: 'string' } } },
    enabled: true,
  },
  {
    name: 'file_write',
    displayName: 'File Write',
    description: 'Write contents to a file in the agent workspace',
    riskClass: 'MEDIUM',
    category: 'filesystem',
    permissions: ['workspace'],
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string' }, content: { type: 'string' } },
      required: ['path', 'content'],
    },
    outputSchema: { type: 'object', properties: { bytesWritten: { type: 'number' } } },
    enabled: true,
  },
  {
    name: 'send_email',
    displayName: 'Send Email',
    description: 'Send an email via SMTP',
    riskClass: 'HIGH',
    category: 'communication',
    permissions: ['email'],
    inputSchema: {
      type: 'object',
      properties: {
        to: { type: 'string', format: 'email' },
        subject: { type: 'string' },
        body: { type: 'string' },
        cc: { type: 'array', items: { type: 'string', format: 'email' } },
      },
      required: ['to', 'subject', 'body'],
    },
    outputSchema: { type: 'object', properties: { messageId: { type: 'string' } } },
    enabled: true,
  },
  {
    name: 'memory_store',
    displayName: 'Memory Store',
    description: 'Store a key-value pair in the tenant memory',
    riskClass: 'LOW',
    category: 'memory',
    permissions: ['memory:write'],
    inputSchema: {
      type: 'object',
      properties: { key: { type: 'string' }, value: {}, ttlSeconds: { type: 'number' } },
      required: ['key', 'value'],
    },
    outputSchema: { type: 'object', properties: { success: { type: 'boolean' } } },
    enabled: true,
  },
  {
    name: 'memory_retrieve',
    displayName: 'Memory Retrieve',
    description: 'Retrieve a value from the tenant memory by key',
    riskClass: 'LOW',
    category: 'memory',
    permissions: ['memory:read'],
    inputSchema: {
      type: 'object',
      properties: { key: { type: 'string' } },
      required: ['key'],
    },
    outputSchema: { type: 'object', properties: { value: {}, found: { type: 'boolean' } } },
    enabled: true,
  },
] as const;

const toolsRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * GET /tools
   * List all registered tools with metadata.
   */
  fastify.get(
    '/',
    { preHandler: [fastify.authenticate] },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      return reply.status(200).send(ok(TOOL_REGISTRY));
    },
  );

  /**
   * GET /tools/:toolName
   * Get full detail for a single tool, including its risk class and schemas.
   */
  fastify.get(
    '/:toolName',
    { preHandler: [fastify.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { toolName } = request.params as { toolName: string };

      try {
        const tool = TOOL_REGISTRY.find((t) => t.name === toolName);
        if (!tool) throw new NotFoundError('Tool', toolName);
        return reply.status(200).send(ok(tool));
      } catch (e) {
        if (e instanceof AppError) return reply.status(e.statusCode).send(err(e.code, e.message));
        throw e;
      }
    },
  );
};

export default toolsRoutes;
