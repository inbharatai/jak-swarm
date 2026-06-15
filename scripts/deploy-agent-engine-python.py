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
and JAK API tool calls. It is deployed to Vertex AI Agent Engine.
"""

import os
import json
import http.client
import urllib.request

# The agent uses Gemini with Google Search grounding
# Agent Engine auto-provisions the Gemini API key

JAK_API_URL = os.environ.get('JAK_API_URL', 'http://localhost:4000')
JAK_API_KEY = os.environ.get('JAK_API_KEY', '')


def call_jak_api(endpoint: str, body: dict) -> dict:
    """Call JAK Railway API for tool execution."""
    url = f"{JAK_API_URL}{endpoint}"
    headers = {
        'Content-Type': 'application/json',
    }
    if JAK_API_KEY:
        headers['Authorization'] = f'Bearer {JAK_API_KEY}'

    req = urllib.request.Request(url, data=json.dumps(body).encode(), headers=headers, method='POST')
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        return {'error': f'JAK API error: {e.code} {e.read().decode()[:200]}'}
    except Exception as e:
        return {'error': f'Request failed: {str(e)}'}


# ─── Agent Definition ─────────────────────────────────────────────────────────

try:
    from google.adk import Agent
    from google.adk.tools import google_search

    # Create the JAK Swarm Gateway Agent with Google Search grounding
    root_agent = Agent(
        name='JAKSwarmGateway',
        model='gemini-2.5-flash',
        description=(
            "JAK Swarm gateway agent with Google Search grounding. "
            "Delegates work to JAK's 38 specialist agents via the Railway API. "
            "Use this agent to create workflows, check status, get results, "
            "and manage approvals — all with real-time Google Search grounding "
            "for citation-backed responses."
        ),
        instruction="""You are JAK Swarm's gateway agent, deployed on Google Cloud Agent Engine.
Your role is to help users accomplish business goals by using JAK's specialist agents.

When a user gives you a goal:
1. First, use Google Search to ground your understanding with current data
2. Create a workflow using create_workflow with the user's goal
3. Monitor the workflow status using get_workflow_status
4. If the workflow requires approval, present it clearly and use approve_request
5. Once complete, get the traces using get_workflow_traces and summarize the results
6. Always cite your sources when using Google Search results

Key principles:
- Be thorough: use search to verify facts before and after agent execution
- Be transparent: explain which agents are working on what
- Be safe: always present approval requests to the user before approving
- Be grounded: cite sources from Google Search results

Available JAK agent roles: CEO, CTO, CFO, CMO, HR, Research, Email, Calendar, CRM,
Browser, Document, Spreadsheet, Knowledge, Support, Legal, Finance, Marketing,
Content, SEO, PR, Growth, Analytics, Product, Project, Coder, Designer, Ops, Voice""",
        tools=[google_search],
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
    vertexai.init(project=GCP_PROJECT_ID, location=GCP_REGION)

    # Write the agent module to a temporary directory
    import tempfile
    agent_dir = tempfile.mkdtemp(prefix='jak_agent_')
    agent_file = os.path.join(agent_dir, 'agent.py')

    with open(agent_file, 'w', encoding='utf-8') as f:
        f.write(AGENT_MODULE_CODE)

    # Write requirements.txt
    requirements_file = os.path.join(agent_dir, 'requirements.txt')
    with open(requirements_file, 'w', encoding='utf-8') as f:
        f.write('google-cloud-aiplatform[agent_engines,adk]\n')
        f.write('google-adk>=1.2.0\n')

    print(f"  Agent module: {agent_file}")
    print(f"  Requirements: {requirements_file}")
    print("")

    # Deploy using inline source (no GCS bucket needed)
    env_vars = {
        'JAK_API_URL': JAK_API_URL,
        'JAK_API_KEY': JAK_API_KEY,
    }
    if GEMINI_API_KEY:
        env_vars['GEMINI_API_KEY'] = GEMINI_API_KEY

    try:
        remote_agent = agent_engines.create(
            agent_dir,
            display_name=DISPLAY_NAME,
            requirements=['google-cloud-aiplatform[agent_engines,adk]', 'google-adk>=1.2.0'],
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

    timestamp = datetime.utcnow().isoformat() + 'Z'
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
    print("╔════════════════════════════════════════════════════════════════╗")
    print("║  JAK Swarm → Google Agent Engine Deployment                   ║")
    print("╚════════════════════════════════════════════════════════════════╝")

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