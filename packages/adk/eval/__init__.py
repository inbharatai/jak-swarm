# JAK Swarm Gateway Agent — ADK Evaluation & Optimization Module
#
# This module is loaded by `adk eval` and `adk optimize`.
# The CLI expects: agent_module.agent.root_agent
# Since the CLI loads __init__.py as module "agent" and then
# accesses agent_module.agent.root_agent, we need the "agent"
# attribute to point to something that has "root_agent".
#
# Usage:
#   cd packages/adk/eval && adk eval . ../../../qa/eval-sets/jak-gateway-eval-set.json
#   cd packages/adk/eval && adk optimize . --sampler_config_file_path ../../../qa/eval-sets/jak-gateway-sampler-config.json

import json
import os
import urllib.request
from google.adk.agents import LlmAgent
from google.adk.tools import FunctionTool


# ─── JAK API Configuration ─────────────────────────────────────────────
JAK_API_URL = os.environ.get(
    "JAK_API_URL",
    "https://jak-swarm-api-565531938617.asia-south1.run.app",
)
JAK_API_KEY = os.environ.get("JAK_API_KEY", "")


async def call_jak_api(endpoint: str, body: dict | None = None, method: str = "POST") -> dict:
    """Call the JAK Swarm API endpoint.

    Args:
        endpoint: API path (e.g. "/workflows").
        body: JSON body for POST requests. Ignored for GET.
        method: HTTP method ("POST" or "GET").
    """
    url = f"{JAK_API_URL}{endpoint}"
    headers = {"Content-Type": "application/json"}
    if JAK_API_KEY:
        headers["Authorization"] = f"Bearer {JAK_API_KEY}"

    if method == "GET":
        req = urllib.request.Request(url, headers=headers, method="GET")
    else:
        data = json.dumps(body or {}).encode("utf-8")
        req = urllib.request.Request(url, data=data, headers=headers, method="POST")

    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except Exception as e:
        return {"error": f"JAK API error: {e}"}


# ─── Tool Functions ─────────────────────────────────────────────────────

async def create_workflow(
    goal: str,
    industry: str | None = None,
    role_modes: list[str] | None = None,
) -> dict:
    """Create a new JAK Swarm workflow to process a goal.

    Args:
        goal: The natural language goal for the workflow.
        industry: Industry context (e.g., saas, ecommerce, healthcare).
        role_modes: Worker roles to include (e.g., CEO, CTO, CMO).

    Returns:
        Workflow ID and initial status.
    """
    body: dict = {"goal": goal}
    if industry:
        body["industry"] = industry
    if role_modes:
        body["roleModes"] = role_modes
    return await call_jak_api("/workflows", body)


async def get_workflow_status(
    workflow_id: str,
) -> dict:
    """Get the current status and output of a JAK Swarm workflow.

    Args:
        workflow_id: The workflow ID to check.

    Returns:
        Workflow status, progress, and output.
    """
    return await call_jak_api(f"/workflows/{workflow_id}", method="GET")


async def get_workflow_traces(
    workflow_id: str,
) -> dict:
    """Get detailed agent execution traces for a workflow, including tool calls, outputs, and costs.

    Args:
        workflow_id: The workflow ID to get traces for.

    Returns:
        Agent traces with tool calls, outputs, and cost breakdown.
    """
    return await call_jak_api(f"/workflows/{workflow_id}/traces", method="GET")


async def search_knowledge(
    query: str,
    limit: int = 5,
) -> dict:
    """Search the tenant knowledge base for facts, policies, and documents previously stored.

    Args:
        query: The search query.
        limit: Maximum results to return (default: 5).

    Returns:
        Search results from the knowledge base.
    """
    return await call_jak_api(f"/memory?search={query}&limit={limit}", method="GET")


async def approve_request(
    workflow_id: str,
    approval_id: str,
    decision: str,
    comment: str | None = None,
) -> dict:
    """Approve a pending approval request for a workflow that requires human review.

    Args:
        workflow_id: The workflow ID.
        approval_id: The approval request ID.
        decision: The approval decision: APPROVED, REJECTED, or DEFERRED.
        comment: Optional comment explaining the decision.

    Returns:
        Approval decision result.
    """
    return await call_jak_api(
        f"/approvals/{approval_id}/decide",
        {"workflowId": workflow_id, "decision": decision, "comment": comment},
    )


# ─── Gateway Instruction ────────────────────────────────────────────────

GATEWAY_INSTRUCTION = """You are JAK Swarm's gateway agent, deployed on Google Cloud Agent Engine. Your role is to help users accomplish business goals by delegating to JAK's specialist agents.

When a user gives you a goal:
1.  Understand the goal and break it into actionable tasks.
2.  Create a workflow using create_workflow with the user's goal.
3.  Monitor the workflow status using get_workflow_status.
4.  If the workflow requires approval, present it clearly and use approve_request.
5.  Once complete, get the traces using get_workflow_traces and summarize the results.
6.  **For information gathering and research**:
    *   First, attempt to use search_knowledge to look up facts, policies, and documents from the *tenant knowledge base*.
    *   If search_knowledge fails (e.g., HTTP 404 error, or no relevant results are found) for a request that requires external information or broader research, then delegate to appropriate specialist agents like `Research` or `Browser` to gather the necessary data.
    *   If the request is for general advice or non-critical information and search_knowledge fails, still attempt to provide a helpful general answer based on your capabilities rather than giving up.

Key principles:
-   **Be thorough**: Use the most appropriate tool for information gathering (search_knowledge for internal, Research/Browser for external) to verify facts before and after agent execution. Do not give up if one information source is unavailable; explore alternatives where appropriate.
-   **Be transparent**: Explain which agents are working on what.
-   **Be safe**:
    *   Always present approval requests to the user before approving.
    *   **Absolutely refuse to generate harmful, unethical, or illegal content.** This includes, but is not limited to, phishing attempts, malware, or hate speech. Clearly state the refusal and explain why it violates safety guidelines. If appropriate, offer safe and constructive alternatives or defensive advice related to the user's underlying intent.
-   **Be helpful**: Provide clear, structured responses with actionable next steps.

Available JAK agent roles: CEO, CTO, CFO, CMO, HR, Research, Email, Calendar, CRM, Browser, Document, Spreadsheet, Knowledge, Support, Legal, Finance, Marketing, Content, SEO, PR, Growth, Analytics, Product, Project, Coder, Designer, Ops, Voice"""


# ─── Root Agent ─────────────────────────────────────────────────────────

root_agent = LlmAgent(
    name="JAKSwarmGateway",
    model="gemini-2.5-flash",
    description=(
        "JAK Swarm gateway agent with Google Search grounding. "
        "Delegates work to JAK's 38 specialist agents via the Cloud Run API. "
        "Use this agent to create workflows, check status, get results, "
        "and manage approvals — all with real-time Google Search grounding "
        "for citation-backed responses."
    ),
    instruction=GATEWAY_INSTRUCTION,
    # NOTE: google_search (built-in grounding tool) is excluded from eval because
    # the ADK evaluator's LlmBackedUserSimulator cannot combine built-in tools
    # with FunctionTool declarations in the same Gemini API request. Google Search
    # grounding is verified separately via the live Agent Engine deployment.
    tools=[
        FunctionTool(create_workflow),
        FunctionTool(get_workflow_status),
        FunctionTool(get_workflow_traces),
        FunctionTool(search_knowledge),
        FunctionTool(approve_request),
    ],
    output_key="gateway_output",
)

# The ADK CLI expects agent_module.agent.root_agent.
# Since this __init__.py is loaded as module "agent", we need
# the "agent" attribute to be this module itself, so that
# agent_module.agent.root_agent resolves to root_agent.
import sys
agent = sys.modules[__name__]