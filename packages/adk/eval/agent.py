# JAK Swarm Gateway Agent — standalone module for direct import
#
# This file re-exports root_agent from __init__.py for compatibility
# with direct imports like: `from agent import root_agent`
#
# For ADK CLI usage (`adk eval`, `adk optimize`), __init__.py is the
# entry point. The CLI expects: agent_module.agent.root_agent

from __init__ import root_agent  # noqa: F401

__all__ = ["root_agent"]