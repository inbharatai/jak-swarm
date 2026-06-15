#!/usr/bin/env python3
"""
Deploy JAK Swarm Gateway Agent to Google Cloud Agent Engine (Vertex AI).

This script uses the Python vertexai SDK to create a ReasoningEngine resource
that hosts the JAK Gateway Agent. The agent code is packaged as a Python
module that imports and runs the TypeScript-compiled gateway agent.

Prerequisites:
  - gcloud CLI installed and authenticated
  - GCP project with Vertex AI API enabled
  - pip install google-cloud-aiplatform[agent_engines,adk]

Environment variables:
  GCP_PROJECT_ID   - Google Cloud project ID (default: crafty-haiku-498807-v8)
  GCP_REGION       - GCP region for Agent Engine (default: us-central1)
  JAK_API_URL      - JAK Swarm API base URL
  JAK_API_KEY      - JAK API authentication key
  GEMINI_API_KEY   - Gemini API key

Usage:
  python scripts/deploy-agent-engine-python.py
"""

import os
import sys
import subprocess
import json
from datetime import datetime

# ─── Configuration ────────────────────────────────────────────────────────────

GCP_PROJECT_ID = os.environ.get('GCP_PROJECT_ID', 'crafty-haiku-498807-v8')
GCP_REGION = os.environ.get('GCP_REGION', 'asia-south1')
JAK_API_URL = os.environ.get('JAK_API_URL', '')
JAK_API_KEY = os.environ.get('JAK_API_KEY', '')
GEMINI_API_KEY = os.environ.get('GEMINI_API_KEY', '')
DISPLAY_NAME = os.environ.get('AGENT_DISPLAY_NAME', 'jak-swarm-gateway')

# ─── Agent Module ─────────────────────────────────────────────────────────────
# This Python module wraps the JAK Gateway Agent for Agent Engine deployment.
# Agent Engine expects a Python entry point with a `root_agent` export.

AGENT_MODULE_CODE = '''
"""JAK Swarm Gateway Agent — Agent Engine entry point.

This module creates a Gemini-powered agent with Google Search grounding
and 5 JAK Cloud Run API function tools. It is deployed to Vertex AI Agent Engine.
"""

import os
import json
import urllib.request
import urllib.parse

JAK_API_URL = os.environ.get('JAK_API_URL', 'https://jak-swarm-api-565531938617.asia-south1.run.app')
JAK_API_KEY = os.environ.get('JAK_API_KEY', '')


def call_jak_api(endpoint: str, body: dict | None = None, method: str = 'POST') -> dict:
    """Call JAK Cloud Run API for tool execution."""
    url = f"{JAK_API_URL}{endpoint}"
    headers = {
        'Content-Type': 'application/json',
    }
    if JAK_API_KEY:
        headers['Authorization'] = f'Bearer {JAK_API_KEY}'

    if method == 'GET':
        req = urllib.request.Request(url, headers=headers, method='GET')
    else:
        req = urllib.request.Request(url, data=json.dumps(body or {}).encode(), headers=headers, method='POST')

    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        return {'error': f'JAK API error: {e.code} {e.read().decode()[:200]}'}
    except Exception as e:
        return {'error': f'Request failed: {str(e)}'}


# ─── Tool Functions ─────────────────────────────────────────────────────────

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
    return call_jak_api("/workflows", body)


async def get_workflow_status(workflow_id: str) -> dict:
    """Get the current status and output of a JAK Swarm workflow.

    Args:
        workflow_id: The workflow ID to check.

    Returns:
        Workflow status, progress, and output.
    """
    return call_jak_api(f"/workflows/{workflow_id}", method="GET")


async def get_workflow_traces(workflow_id: str) -> dict:
    """Get detailed agent execution traces for a workflow.

    Args:
        workflow_id: The workflow ID to get traces for.

    Returns:
        Agent traces with tool calls, outputs, and cost breakdown.
    """
    return call_jak_api(f"/workflows/{workflow_id}/traces", method="GET")


async def search_knowledge(query: str, limit: int = 5) -> dict:
    """Search the tenant knowledge base for facts, policies, and documents.

    Args:
        query: The search query.
        limit: Maximum results to return (default: 5).

    Returns:
        Search results from the knowledge base.
    """
    q = urllib.parse.quote(query)
    return call_jak_api(f"/memory?search={q}&limit={limit}", method="GET")


async def approve_request(
    workflow_id: str,
    approval_id: str,
    decision: str,
    comment: str | None = None,
) -> dict:
    """Approve a pending approval request for a workflow.

    Args:
        workflow_id: The workflow ID.
        approval_id: The approval request ID.
        decision: The approval decision: APPROVED, REJECTED, or DEFERRED.
        comment: Optional comment explaining the decision.

    Returns:
        Approval decision result.
    """
    return call_jak_api(
        f"/approvals/{approval_id}/decide",
        {"workflowId": workflow_id, "decision": decision, "comment": comment},
    )


# ─── GEPA-Optimized Gateway Instruction (Candidate 1) ────────────────────────
# Validated by GEPA optimizer (20 iterations, 102 metric calls).
# Candidate 1 matched baseline quality (1.0 on 6/6 training scenarios) while
# adding explicit safety refusal and search_knowledge fallback guidance.

GATEWAY_INSTRUCTION = """You are JAK Swarm's gateway agent, deployed on Google Cloud Agent Engine. Your role is to help users accomplish business goals by delegating to JAK's specialist agents.

When a user gives you a goal:
1.  Understand the goal and break it into actionable tasks.
2.  Create a workflow using create_workflow with the user's goal.
3.  Monitor the workflow status using get_workflow_status.
4.  If the workflow requires approval, present it clearly and use approve_request.
5.  Once complete, get the traces using get_workflow_traces and summarize the results.
6.  **For information gathering and research**:
    *   First, attempt to use search_knowledge to look up facts, policies, and documents from the *tenant knowledge base*.
    *   If search_knowledge fails (e.g., HTTP 404 error, or no relevant results are found) for a request that requires external information or broader research, then use Google Search for real-time, citation-backed information, or delegate to appropriate specialist agents like `Research` or `Browser` to gather the necessary data.
    *   If the request is for general advice or non-critical information and search_knowledge fails, still attempt to provide a helpful general answer based on your capabilities rather than giving up.

Key principles:
-   **Be thorough**: Use the most appropriate tool for information gathering (search_knowledge for internal, Google Search for external, Research/Browser for specialist research) to verify facts before and after agent execution. Do not give up if one information source is unavailable; explore alternatives where appropriate.
-   **Be transparent**: Explain which agents are working on what.
-   **Be safe**:
    *   Always present approval requests to the user before approving.
    *   **Absolutely refuse to generate harmful, unethical, or illegal content.** This includes, but is not limited to, phishing attempts, malware, or hate speech. Clearly state the refusal and explain why it violates safety guidelines. If appropriate, offer safe and constructive alternatives or defensive advice related to the user's underlying intent.
-   **Be helpful**: Provide clear, structured responses with actionable next steps.
-   **Be grounded**: Cite sources from Google Search results when using external information.

Available JAK agent roles: CEO, CTO, CFO, CMO, HR, Research, Email, Calendar, CRM, Browser, Document, Spreadsheet, Knowledge, Support, Legal, Finance, Marketing, Content, SEO, PR, Growth, Analytics, Product, Project, Coder, Designer, Ops, Voice"""


# ─── Agent Definition ─────────────────────────────────────────────────────────

try:
    from google.adk import Agent
    from google.adk.tools import google_search, FunctionTool

    # Create the JAK Swarm Gateway Agent with Google Search grounding
    # and 5 function tools that call the JAK Cloud Run API
    root_agent = Agent(
        name='JAKSwarmGateway',
        model='gemini-2.5-flash',
        description=(
            "JAK Swarm gateway agent with Google Search grounding. "
            "Delegates work to JAK's specialist agents via the Cloud Run API. "
            "Use this agent to create workflows, check status, get results, "
            "and manage approvals — all with real-time Google Search grounding "
            "for citation-backed responses."
        ),
        instruction=GATEWAY_INSTRUCTION,
        tools=[
            google_search,
            FunctionTool(create_workflow),
            FunctionTool(get_workflow_status),
            FunctionTool(get_workflow_traces),
            FunctionTool(search_knowledge),
            FunctionTool(approve_request),
        ],
    )

except ImportError:
    # Fallback: if google.adk is not available in the deployment environment,
    # define a minimal agent structure that Agent Engine can use
    print("Warning: google.adk not available, using fallback agent definition")

    root_agent = {
        'name': 'JAKSwarmGateway',
        'model': 'gemini-2.5-flash',
        'description': "JAK Swarm gateway agent with Google Search grounding.",
        'instruction': "You are JAK Swarm's gateway agent. Help users accomplish business goals.",
    }
'''


def install_dependencies():
    """Install required Python packages."""
    print("📦 Installing dependencies...")
    subprocess.check_call([
        sys.executable, '-m', 'pip', 'install', '--quiet',
        'google-cloud-aiplatform[agent_engines,adk]',
    ])
    print("✅ Dependencies installed")


def deploy_agent_engine():
    """Deploy the JAK Swarm Gateway Agent to Agent Engine."""
    try:
        import vertexai
        from vertexai import agent_engines
    except ImportError:
        print("❌ vertexai not available. Install with: pip install google-cloud-aiplatform[agent_engines,adk]")
        sys.exit(1)

    print(f"\n🚀 Deploying to Agent Engine...")
    print(f"  Project:  {GCP_PROJECT_ID}")
    print(f"  Region:   {GCP_REGION}")
    print(f"  JAK API:  {JAK_API_URL}")
    print(f"  Agent:    {DISPLAY_NAME}")
    print("")

    # Initialize vertexai
    GCP_STAGING_BUCKET = os.environ.get('GCP_STAGING_BUCKET', 'jak-swarm-agent-engine-staging')
    vertexai.init(project=GCP_PROJECT_ID, location=GCP_REGION, staging_bucket=f'gs://{GCP_STAGING_BUCKET}')

    # Build the agent object directly using ADK
    try:
        from google.adk import Agent
        from google.adk.tools import google_search, FunctionTool
    except ImportError:
        print("❌ google.adk not available. Install with: pip install google-adk>=2.0")
        sys.exit(1)

    # Define async tool functions that call the JAK Cloud Run API
    import urllib.parse

    def make_call_jak_api():
        """Create a call_jak_api closure with the configured URL and key."""
        def call_jak_api(endpoint: str, body: dict | None = None, method: str = 'POST') -> dict:
            url = f"{JAK_API_URL}{endpoint}"
            headers = {'Content-Type': 'application/json'}
            if JAK_API_KEY:
                headers['Authorization'] = f'Bearer {JAK_API_KEY}'
            if method == 'GET':
                req = urllib.request.Request(url, headers=headers, method='GET')
            else:
                req = urllib.request.Request(url, data=json.dumps(body or {}).encode(), headers=headers, method='POST')
            try:
                with urllib.request.urlopen(req, timeout=30) as resp:
                    return json.loads(resp.read().decode())
            except urllib.error.HTTPError as e:
                return {'error': f'JAK API error: {e.code} {e.read().decode()[:200]}'}
            except Exception as e:
                return {'error': f'Request failed: {str(e)}'}
        return call_jak_api

    call_jak_api = make_call_jak_api()

    async def create_workflow(goal: str, industry: str | None = None, role_modes: list[str] | None = None) -> dict:
        body: dict = {"goal": goal}
        if industry: body["industry"] = industry
        if role_modes: body["roleModes"] = role_modes
        return call_jak_api("/workflows", body)

    async def get_workflow_status(workflow_id: str) -> dict:
        return call_jak_api(f"/workflows/{workflow_id}", method="GET")

    async def get_workflow_traces(workflow_id: str) -> dict:
        return call_jak_api(f"/workflows/{workflow_id}/traces", method="GET")

    async def search_knowledge(query: str, limit: int = 5) -> dict:
        q = urllib.parse.quote(query)
        return call_jak_api(f"/memory?search={q}&limit={limit}", method="GET")

    async def approve_request(workflow_id: str, approval_id: str, decision: str, comment: str | None = None) -> dict:
        return call_jak_api(f"/approvals/{approval_id}/decide", {"workflowId": workflow_id, "decision": decision, "comment": comment})

    GATEWAY_INSTRUCTION = """You are JAK Swarm's gateway agent, deployed on Google Cloud Agent Engine. Your role is to help users accomplish business goals by delegating to JAK's specialist agents.

When a user gives you a goal:
1.  Understand the goal and break it into actionable tasks.
2.  Create a workflow using create_workflow with the user's goal.
3.  Monitor the workflow status using get_workflow_status.
4.  If the workflow requires approval, present it clearly and use approve_request.
5.  Once complete, get the traces using get_workflow_traces and summarize the results.
6.  **For information gathering and research**:
    *   First, attempt to use search_knowledge to look up facts, policies, and documents from the *tenant knowledge base*.
    *   If search_knowledge fails (e.g., HTTP 404 error, or no relevant results are found) for a request that requires external information or broader research, then use Google Search for real-time, citation-backed information, or delegate to appropriate specialist agents like `Research` or `Browser` to gather the necessary data.
    *   If the request is for general advice or non-critical information and search_knowledge fails, still attempt to provide a helpful general answer based on your capabilities rather than giving up.

Key principles:
-   **Be thorough**: Use the most appropriate tool for information gathering (search_knowledge for internal, Google Search for external, Research/Browser for specialist research) to verify facts before and after agent execution. Do not give up if one information source is unavailable; explore alternatives where appropriate.
-   **Be transparent**: Explain which agents are working on what.
-   **Be safe**:
    *   Always present approval requests to the user before approving.
    *   **Absolutely refuse to generate harmful, unethical, or illegal content.** This includes, but is not limited to, phishing attempts, malware, or hate speech. Clearly state the refusal and explain why it violates safety guidelines. If appropriate, offer safe and constructive alternatives or defensive advice related to the user's underlying intent.
-   **Be helpful**: Provide clear, structured responses with actionable next steps.
-   **Be grounded**: Cite sources from Google Search results when using external information.

Available JAK agent roles: CEO, CTO, CFO, CMO, HR, Research, Email, Calendar, CRM, Browser, Document, Spreadsheet, Knowledge, Support, Legal, Finance, Marketing, Content, SEO, PR, Growth, Analytics, Product, Project, Coder, Designer, Ops, Voice"""

    agent = Agent(
        name='JAKSwarmGateway',
        model='gemini-2.5-flash',
        description=(
            "JAK Swarm gateway agent with Google Search grounding. "
            "Delegates work to JAK's specialist agents via the Cloud Run API. "
            "Use this agent to create workflows, check status, get results, "
            "and manage approvals — all with real-time Google Search grounding "
            "for citation-backed responses."
        ),
        instruction=GATEWAY_INSTRUCTION,
        tools=[
            google_search,
            FunctionTool(create_workflow),
            FunctionTool(get_workflow_status),
            FunctionTool(get_workflow_traces),
            FunctionTool(search_knowledge),
            FunctionTool(approve_request),
        ],
    )

    print(f"  Agent: {agent.name}")
    print(f"  Tools: google_search + 5 function tools")
    print("")

    # Deploy using the agent object directly
    env_vars = {
        'JAK_API_URL': JAK_API_URL,
        'JAK_API_KEY': JAK_API_KEY,
    }
    if GEMINI_API_KEY:
        env_vars['GEMINI_API_KEY'] = GEMINI_API_KEY

    try:
        remote_agent = agent_engines.create(
            agent,
            display_name=DISPLAY_NAME,
            requirements=['google-cloud-aiplatform[agent_engines,adk]', 'google-adk>=2.2.0'],
            env_vars=env_vars,
        )

        # Extract resource ID
        resource_name = remote_agent.name if hasattr(remote_agent, 'name') else str(remote_agent)
        print(f"\n✅ Agent Engine created successfully!")
        print(f"  Resource: {resource_name}")
        print(f"  Display name: {DISPLAY_NAME}")
        print(f"  Region: {GCP_REGION}")
        print(f"  Project: {GCP_PROJECT_ID}")
        print(f"  Deployed at: {datetime.utcnow().isoformat()}Z")

        # Write resource file
        write_resource_file(resource_name, GCP_REGION, DISPLAY_NAME)
        return resource_name

    except Exception as e:
        error_msg = str(e)
        print(f"\n❌ Agent Engine deployment failed: {error_msg}")

        # Check if it's a Python runtime requirement
        if 'python' in error_msg.lower() or 'runtime' in error_msg.lower():
            print("\n💡 Agent Engine requires Python runtime.")
            print("   Alternative: Deploy to Cloud Run using npx @google/adk deploy cloud_run")
            print("   Or: Deploy via container_spec with Dockerfile")

        return None


def deploy_via_container():
    """Alternative: Deploy as a container on Agent Engine."""
    print("\n🔄 Attempting container-based Agent Engine deployment...")

    try:
        import vertexai
        from vertexai import agent_engines
    except ImportError:
        print("❌ vertexai not available")
        return None

    vertexai.init(project=GCP_PROJECT_ID, location=GCP_REGION)

    # Use container_spec approach
    # This requires a pre-built Docker image in Artifact Registry
    print("  Container deployment requires:")
    print("  1. A Docker image pushed to Artifact Registry")
    print("  2. The image must include google-cloud-aiplatform>=1.144")
    print("  3. class_methods must be specified explicitly")
    print("")
    print("  For now, use the Cloud Run deployment alternative:")
    print(f"    npx @google/adk deploy cloud_run packages/adk/src/deploy \\")
    print(f"      --project={GCP_PROJECT_ID} --region={GCP_REGION} \\")
    print(f"      --service_name=jak-swarm-gateway")
    return None


def write_resource_file(resource_id: str, region: str, display_name: str):
    """Write the resource ID to a TypeScript file for programmatic access."""
    repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    resource_file = os.path.join(
        repo_root, 'packages', 'adk', 'src', 'deploy', 'agent-engine-resource.ts'
    )

    timestamp = datetime.now(datetime.timezone.utc).isoformat()
    # Ensure full resource path
    if not resource_id.startswith('projects/'):
        resource_id = f'projects/{GCP_PROJECT_ID}/locations/{region}/reasoningEngines/{resource_id}'
    is_agent_engine = 'reasoningEngines' in resource_id

    content = f'''/**
 * Agent Engine deployment resource — produced by deploy-agent-engine.
 *
 * ⚠️ This file is auto-generated. Do not edit manually.
 * Re-run: python scripts/deploy-agent-engine-python.py
 *
 * {"Live reasoningEngines resource — this file is the single source of truth" if is_agent_engine else "Cloud Run deployment"} for the Agent Engine deployment status.
 */

export const AGENT_ENGINE_RESOURCE_ID = '{resource_id}';
export const AGENT_ENGINE_DISPLAY_NAME = '{display_name}';
export const AGENT_ENGINE_REGION = '{region}';
export const AGENT_ENGINE_DEPLOYED_AT = '{timestamp}';
export const AGENT_ENGINE_TYPE = '{'agent-engine' if is_agent_engine else 'cloud-run'}' as const;
'''

    with open(resource_file, 'w', encoding='utf-8') as f:
        f.write(content)

    print(f"\n📝 Resource file written to: {resource_file}")


def main():
    print("=" * 64)
    print("  JAK Swarm -> Google Agent Engine Deployment")
    print("=" * 64)

    # Validate required env vars
    if not JAK_API_URL:
        print("\n❌ JAK_API_URL is required. Set it in your environment.")
        sys.exit(1)
    if not JAK_API_KEY:
        print("\n❌ JAK_API_KEY is required. Set it in your environment.")
        sys.exit(1)

    # Install dependencies
    install_dependencies()

    # Deploy
    resource_id = deploy_agent_engine()

    # Fallback to container if needed
    if not resource_id:
        deploy_via_container()

    if not resource_id:
        print("\n❌ Deployment failed. See errors above.")
        sys.exit(1)

    print("\n✨ Deployment complete!")


if __name__ == '__main__':
    main()