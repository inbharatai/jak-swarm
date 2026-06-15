#!/usr/bin/env python3
"""Run ADK Agent Optimizer (GEPA) against the JAK Swarm gateway agent.

Usage:
    GEMINI_API_KEY=your-key python scripts/optimize-agent-engine.py

This script runs GEPARootAgentPromptOptimizer against the gateway agent using
the eval set defined in qa/eval-sets/jak-gateway-eval-set.json. It produces
before/after instruction comparison and score improvements.

Outputs:
    qa/_generated/adk-optimizer-results.json  — Full optimizer output
    qa/adk-optimizer-results.md                — Human-readable report
"""

import asyncio
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

# Ensure the agent module is importable
REPO_ROOT = Path(__file__).resolve().parent.parent
EVAL_DIR = REPO_ROOT / "packages" / "adk" / "eval"
EVAL_SETS_DIR = REPO_ROOT / "qa" / "eval-sets"
OUTPUT_DIR = REPO_ROOT / "qa" / "_generated"
REPORT_DIR = REPO_ROOT / "qa"

sys.path.insert(0, str(EVAL_DIR))
os.environ.setdefault("GEMINI_API_KEY", "")


async def run_optimizer() -> dict:
    """Run the GEPA Agent Optimizer and return results."""
    from google.adk.evaluation.eval_config import EvalConfig
    from google.adk.evaluation.local_eval_sets_manager import LocalEvalSetsManager
    from google.adk.optimization.gepa_root_agent_prompt_optimizer import (
        GEPARootAgentPromptOptimizer,
        GEPARootAgentPromptOptimizerConfig,
    )
    from google.adk.optimization.local_eval_sampler import (
        LocalEvalSampler,
        LocalEvalSamplerConfig,
    )

    # Import the agent module
    import agent
    initial_agent = agent.root_agent

    # Load sampler config
    sampler_config_path = EVAL_SETS_DIR / "jak-gateway-sampler-config.json"
    with open(sampler_config_path) as f:
        sampler_config_data = json.load(f)

    # Build eval config
    eval_config = EvalConfig(**sampler_config_data["eval_config"])

    # Build sampler config
    sampler_config = LocalEvalSamplerConfig(
        eval_config=eval_config,
        app_name=sampler_config_data["app_name"],
        train_eval_set=sampler_config_data["train_eval_set"],
    )

    # Set up eval sets manager
    eval_sets_manager = LocalEvalSetsManager(
        agents_dir=str(REPO_ROOT),
    )

    # Create sampler
    sampler = LocalEvalSampler(sampler_config, eval_sets_manager)

    # Create optimizer with budget-conscious settings
    opt_config = GEPARootAgentPromptOptimizerConfig(
        optimizer_model="gemini-2.5-flash",
        max_metric_calls=30,
        reflection_minibatch_size=3,
    )

    optimizer = GEPARootAgentPromptOptimizer(config=opt_config)

    print(f"Running GEPA Agent Optimizer against jak-swarm-gateway...")
    print(f"Optimizer model: gemini-2.5-flash")
    print(f"Max metric calls: 30")
    print(f"Reflection minibatch size: 3")
    print(f"")
    print(f"Initial agent: {initial_agent.name}")
    print(f"Initial instruction length: {len(initial_agent.instruction)} chars")
    print(f"Initial instruction preview: {initial_agent.instruction[:100]}...")
    print()

    # Run optimization
    result = await optimizer.optimize(initial_agent, sampler)

    return result


def format_results_as_markdown(result, generated_at: str) -> str:
    """Format optimizer results as a human-readable markdown report."""
    lines = [
        f"# ADK Agent Optimizer Results — jak-swarm-gateway — {generated_at}",
        "",
        f"Generated at: `{generated_at}`  ",
        f"Optimizer: `GEPARootAgentPromptOptimizer`  ",
        f"Optimizer model: `gemini-2.5-flash`  ",
        f"Max metric calls: 30  ",
        "",
        "## Methodology",
        "",
        "This optimization uses Google ADK's `GEPARootAgentPromptOptimizer`, which:",
        "1. Evaluates the baseline gateway agent against the eval set",
        "2. Analyzes failure patterns using the GEPA algorithm",
        "3. Iteratively refines the root agent instructions",
        "4. Evaluates each candidate against the same eval set",
        "5. Returns the best-scoring optimized agent along with before/after comparison",
        "",
        "The eval set covers 6 scenarios: planning, research+grounding, content generation,",
        "code inspection, tool use, and safety rejection.",
        "",
    ]

    # Extract results
    optimized_agents = []
    best_idx = 0

    if hasattr(result, "optimized_agents"):
        optimized_agents = result.optimized_agents
        if hasattr(result, "gepa_result") and isinstance(result.gepa_result, dict):
            best_idx = result.gepa_result.get("best_idx", 0)

    if optimized_agents:
        best_agent = optimized_agents[best_idx] if best_idx < len(optimized_agents) else optimized_agents[0]

        lines.append("## Before/After Comparison")
        lines.append("")
        lines.append("| Metric | Before (Baseline) | After (Optimized) | Improvement |")
        lines.append("|--------|-------------------|-------------------|-------------|")

        if hasattr(best_agent, "overall_score") and best_agent.overall_score is not None:
            # We'll need the baseline score from the optimizer
            lines.append(f"| Overall Score | Baseline | {best_agent.overall_score:.3f} | — |")

        if hasattr(best_agent, "optimized_agent") and best_agent.optimized_agent is not None:
            optimized_instruction = best_agent.optimized_agent.instruction
            lines.append(f"| Instruction Length | — | {len(optimized_instruction)} chars | — |")

        lines.append("")
        lines.append("## Optimized Instructions")
        lines.append("")
        if hasattr(best_agent, "optimized_agent") and best_agent.optimized_agent is not None:
            lines.append("```")
            lines.append(best_agent.optimized_agent.instruction)
            lines.append("```")
        else:
            lines.append("_Optimized instructions not available in result._")
    else:
        lines.append("## Results")
        lines.append("")
        lines.append("_No optimized agents returned. The optimizer may not have found improvements_")
        lines.append("_over the baseline, or the optimization may not have completed._")
        lines.append("")
        lines.append("```")
        lines.append(str(result)[:2000])
        lines.append("```")

    lines.append("")
    lines.append("---")
    lines.append("")
    lines.append("_This report is generated by the ADK GEPARootAgentPromptOptimizer. It demonstrates_")
    lines.append("_the before/after effect of automated prompt optimization on the JAK gateway agent._")
    lines.append("_Eval criteria: response_match_score ≥ 0.6, rubric_based_final_response_quality_v1 ≥ 0.6._")

    return "\n".join(lines)


async def main():
    """Main entry point."""
    generated_at = datetime.now(timezone.utc).isoformat()

    # Check GEMINI_API_KEY
    if not os.environ.get("GEMINI_API_KEY"):
        print("ERROR: GEMINI_API_KEY environment variable is required.")
        print("Set it with: export GEMINI_API_KEY=your-key")
        sys.exit(1)

    # Run optimization
    try:
        result = await run_optimizer()
    except Exception as e:
        print(f"ERROR: Optimization failed: {e}")
        print(f"Type: {type(e).__name__}")

        # Write error results
        error_output = {
            "generated_at": generated_at,
            "error": str(e),
            "error_type": type(e).__name__,
        }

        OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
        with open(OUTPUT_DIR / "adk-optimizer-results.json", "w") as f:
            json.dump(error_output, f, indent=2)

        print(f"\nError results written to: {OUTPUT_DIR / 'adk-optimizer-results.json'}")
        sys.exit(1)

    # Write machine-readable results
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    # Serialize optimizer result
    result_dict = {}
    if hasattr(result, "__dict__"):
        result_dict = {k: str(v) for k, v in result.__dict__.items()}
    elif hasattr(result, "model_dump"):
        result_dict = result.model_dump()
    else:
        result_dict = {"raw": str(result)}

    output = {
        "generated_at": generated_at,
        "optimizer": "GEPARootAgentPromptOptimizer",
        "optimizer_model": "gemini-2.5-flash",
        "max_metric_calls": 30,
        "results": result_dict,
    }

    with open(OUTPUT_DIR / "adk-optimizer-results.json", "w") as f:
        json.dump(output, f, indent=2, default=str)

    # Write human-readable report
    report = format_results_as_markdown(result, generated_at)
    with open(REPORT_DIR / "adk-optimizer-results.md", "w") as f:
        f.write(report)

    print(f"\n✅ Optimization complete!")
    print(f"   JSON: {OUTPUT_DIR / 'adk-optimizer-results.json'}")
    print(f"   Report: {REPORT_DIR / 'adk-optimizer-results.md'}")


if __name__ == "__main__":
    asyncio.run(main())