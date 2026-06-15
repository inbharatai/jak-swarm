/**
 * Agent Engine Deployment Entry Point — Google Agents Challenge Layer 3.
 *
 * This module creates a standalone ADK agent that can be deployed to
 * Google Cloud's Agent Engine (Vertex AI). It acts as a gateway:
 *   1. Receives user goals via Agent Engine's managed endpoint
 *   2. Uses GOOGLE_SEARCH for real-time grounding
 *   3. Calls back to JAK's Cloud Run API for tool execution
 *   4. Returns grounded, verified results
 *
 * Deploy with:
 *   gcloud ai agent-engines create \
 *     --display-name=jak-swarm-gateway \
 *     --region=asia-south1 \
 *     --module-path=packages/adk/src/deploy/agent-engine-entry
 *
 * Environment variables (set in Agent Engine deployment):
 *   JAK_API_URL       - Cloud Run API base URL (e.g. https://jak-swarm-api-565531938617.asia-south1.run.app)
 *   JAK_API_KEY       - API key for authentication
 *   GEMINI_API_KEY    - Gemini API key (auto-provisioned in Agent Engine)
 */

import { LlmAgent } from '@google/adk';
import { GOOGLE_SEARCH } from '@google/adk';
import { FunctionTool } from '@google/adk';
import { z } from 'zod';

// ─── JAK Cloud Run API Tool Bridge ─────────────────────────────────────────────
// Each JAK tool is exposed as a FunctionTool that calls the Cloud Run API.
// This lets Agent Engine delegate real work to JAK's infrastructure while
// using Google Search Grounding for citation-backed responses.

const JAK_API_URL = process.env['JAK_API_URL'] ?? 'https://jak-swarm-api-565531938617.asia-south1.run.app';
const JAK_API_KEY = process.env['JAK_API_KEY'] ?? '';

async function callJakApi(endpoint: string, body?: Record<string, unknown>, method: 'POST' | 'GET' = 'POST'): Promise<unknown> {
  const init: RequestInit = {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${JAK_API_KEY}`,
    },
  };

  if (method === 'POST') {
    init.body = JSON.stringify(body ?? {});
  }

  const response = await fetch(`${JAK_API_URL}${endpoint}`, init);

  if (!response.ok) {
    const text = await response.text();
    return { error: `JAK API error: ${response.status} ${text.slice(0, 200)}` };
  }

  return response.json();
}

// ─── Agent Engine Tools ─────────────────────────────────────────────────────

const createWorkflowTool = new FunctionTool({
  name: 'create_workflow',
  description: 'Create a new JAK Swarm workflow to process a goal. Returns the workflow ID and initial status.',
  parameters: z.object({
    goal: z.string().describe('The natural language goal for the workflow'),
    industry: z.string().optional().describe('Industry context (e.g., "saas", "ecommerce", "healthcare")'),
    roleModes: z.array(z.string()).optional().describe('Worker roles to include (e.g., ["CEO", "CTO", "CMO"])'),
  }),
  execute: async (input: Record<string, unknown>) => {
    return callJakApi('/workflows', {
      goal: input.goal,
      industry: input.industry,
      roleModes: input.roleModes,
    });
  },
});

const getWorkflowStatusTool = new FunctionTool({
  name: 'get_workflow_status',
  description: 'Get the current status and output of a JAK Swarm workflow.',
  parameters: z.object({
    workflowId: z.string().describe('The workflow ID to check'),
  }),
  execute: async (input: Record<string, unknown>) => {
    return callJakApi(`/workflows/${input.workflowId}`, undefined, 'GET');
  },
});

const getWorkflowTracesTool = new FunctionTool({
  name: 'get_workflow_traces',
  description: 'Get detailed agent execution traces for a workflow, including tool calls, outputs, and costs.',
  parameters: z.object({
    workflowId: z.string().describe('The workflow ID to get traces for'),
  }),
  execute: async (input: Record<string, unknown>) => {
    return callJakApi(`/workflows/${input.workflowId}/traces`, undefined, 'GET');
  },
});

const searchKnowledgeTool = new FunctionTool({
  name: 'search_knowledge',
  description: 'Search the tenant knowledge base for facts, policies, and documents previously stored.',
  parameters: z.object({
    query: z.string().describe('The search query'),
    limit: z.number().optional().describe('Maximum results to return (default: 5)'),
  }),
  execute: async (input: Record<string, unknown>) => {
    const q = encodeURIComponent(String(input.query));
    const lim = input.limit ?? 5;
    return callJakApi(`/memory?search=${q}&limit=${lim}`, undefined, 'GET');
  },
});

const approveRequestTool = new FunctionTool({
  name: 'approve_request',
  description: 'Approve a pending approval request for a workflow that requires human review.',
  parameters: z.object({
    workflowId: z.string().describe('The workflow ID'),
    approvalId: z.string().describe('The approval request ID'),
    decision: z.enum(['APPROVED', 'REJECTED', 'DEFERRED']).describe('The approval decision'),
    comment: z.string().optional().describe('Optional comment explaining the decision'),
  }),
  execute: async (input: Record<string, unknown>) => {
    return callJakApi(`/approvals/${input.approvalId}/decide`, {
      workflowId: input.workflowId,
      decision: input.decision,
      comment: input.comment,
    });
  },
});

// ─── GEPA-Optimized Gateway Instruction (Candidate 1) ──────────────────────────
// This instruction was validated by the GEPA optimizer (20 iterations, 102 metric
// calls). Candidate 1 matched baseline quality (1.0 on 6/6 scenarios) while adding
// explicit safety refusal and search_knowledge fallback guidance.

const GATEWAY_INSTRUCTION = `You are JAK Swarm's gateway agent, deployed on Google Cloud Agent Engine. Your role is to help users accomplish business goals by delegating to JAK's specialist agents.

When a user gives you a goal:
1.  Understand the goal and break it into actionable tasks.
2.  Create a workflow using create_workflow with the user's goal.
3.  Monitor the workflow status using get_workflow_status.
4.  If the workflow requires approval, present it clearly and use approve_request.
5.  Once complete, get the traces using get_workflow_traces and summarize the results.
6.  **For information gathering and research**:
    *   First, attempt to use search_knowledge to look up facts, policies, and documents from the *tenant knowledge base*.
    *   If search_knowledge fails (e.g., HTTP 404 error, or no relevant results are found) for a request that requires external information or broader research, then use Google Search for real-time, citation-backed information, or delegate to appropriate specialist agents like \`Research\` or \`Browser\` to gather the necessary data.
    *   If the request is for general advice or non-critical information and search_knowledge fails, still attempt to provide a helpful general answer based on your capabilities rather than giving up.

Key principles:
-   **Be thorough**: Use the most appropriate tool for information gathering (search_knowledge for internal, Google Search for external, Research/Browser for specialist research) to verify facts before and after agent execution. Do not give up if one information source is unavailable; explore alternatives where appropriate.
-   **Be transparent**: Explain which agents are working on what.
-   **Be safe**:
    *   Always present approval requests to the user before approving.
    *   **Absolutely refuse to generate harmful, unethical, or illegal content.** This includes, but is not limited to, phishing attempts, malware, or hate speech. Clearly state the refusal and explain why it violates safety guidelines. If appropriate, offer safe and constructive alternatives or defensive advice related to the user's underlying intent.
-   **Be helpful**: Provide clear, structured responses with actionable next steps.
-   **Be grounded**: Cite sources from Google Search results when using external information.

Available JAK agent roles: CEO, CTO, CFO, CMO, HR, Research, Email, Calendar, CRM, Browser, Document, Spreadsheet, Knowledge, Support, Legal, Finance, Marketing, Content, SEO, PR, Growth, Analytics, Product, Project, Coder, Designer, Ops, Voice`;

// ─── Agent Engine Gateway Agent ───────────────────────────────────────────────

/**
 * Create the JAK Swarm gateway agent for Google Cloud Agent Engine.
 *
 * This agent:
 *   1. Uses GOOGLE_SEARCH for real-time grounding (free, citation-backed)
 *   2. Delegates workflow creation/management to JAK's Cloud Run API
 *   3. Provides a natural language interface to JAK's specialist agents
 *   4. Returns grounded, verified results with source citations
 *
 * Deploy this agent to Agent Engine using the deploy-agent-engine-python.py script.
 */
export function createJakGatewayAgent(): LlmAgent {
  return new LlmAgent({
    name: 'JAKSwarmGateway',
    model: 'gemini-2.5-flash',
    description: `JAK Swarm gateway agent with Google Search grounding. Delegates work to JAK's specialist agents via the Cloud Run API. Use this agent to create workflows, check status, get results, and manage approvals — all with real-time Google Search grounding for citation-backed responses.`,
    instruction: GATEWAY_INSTRUCTION,
    tools: [
      GOOGLE_SEARCH,
      createWorkflowTool,
      getWorkflowStatusTool,
      getWorkflowTracesTool,
      searchKnowledgeTool,
      approveRequestTool,
    ],
    outputKey: 'gateway_output',
  });
}

/**
 * Create a simpler single-turn agent for Agent Engine that processes
 * goals directly without workflow management. Uses GOOGLE_SEARCH for
 * grounding and the JAK API for tool execution.
 */
export function createJakDirectAgent(): LlmAgent {
  return new LlmAgent({
    name: 'JAKSwarmDirect',
    model: 'gemini-2.5-flash',
    description: 'JAK Swarm direct execution agent with Google Search grounding. Processes goals in a single turn with real-time search.',
    instruction: `You are a JAK Swarm agent with Google Search grounding. Answer the user's question or accomplish their goal using:
1. Google Search for real-time, citation-backed information
2. JAK's workflow API for complex multi-agent tasks
3. Knowledge base search (search_knowledge) for company-specific information

Always cite your sources. Be thorough and accurate. Refuse harmful or unethical requests.`,
    tools: [
      GOOGLE_SEARCH,
      createWorkflowTool,
      getWorkflowStatusTool,
      searchKnowledgeTool,
    ],
    outputKey: 'direct_output',
  });
}