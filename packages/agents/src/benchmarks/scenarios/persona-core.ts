/**
 * First batch of benchmark scenarios — covers the four persona workflows
 * we shipped 30 commits to make reliable: trivial Q&A (Commander short-
 * circuit), CMO LinkedIn post, CEO SWOT, Research findings, Coding script.
 *
 * Phase 8 grows this to 30-50 scenarios across all 26 workers; today
 * ships the highest-value first batch so the harness can be run
 * meaningfully on day one.
 */

import type { BenchmarkScenario } from '../harness.js';

export const PERSONA_CORE_SCENARIOS: BenchmarkScenario[] = [
  {
    id: 'trivial-greeting',
    name: '"hi" → direct greeting (no orchestration)',
    role: 'COMMANDER',
    goal: 'hi',
    expect: [/hello|hi|welcome|jak swarm/i],
    timeoutMs: 30_000,
  },
  {
    id: 'trivial-arithmetic',
    name: '"what is 2+2?" → "4"',
    role: 'COMMANDER',
    goal: 'what is 2+2?',
    expect: [/\b4\b/],
    timeoutMs: 30_000,
  },
  {
    id: 'trivial-capital',
    name: '"capital of France?" → Paris',
    role: 'COMMANDER',
    goal: 'what is the capital of France?',
    expect: [/paris/i],
    timeoutMs: 30_000,
  },
  {
    id: 'cmo-linkedin-post',
    name: 'CMO writes 200-300 word LinkedIn launch post',
    role: 'WORKER_CONTENT',
    goal:
      'Write a compelling LinkedIn announcement post (200-300 words) for JAK Swarm — an AI multi-agent platform — targeting enterprise buyers. Hook with a tension, list 3 concrete capabilities, end with a CTA.',
    expect: [
      /jak swarm/i,
      /enterprise|business|company|organization/i,
      // word count check — 200-300 words is roughly 1100+ chars
    ],
    timeoutMs: 120_000,
  },
  {
    id: 'ceo-swot',
    name: 'CEO produces structured SWOT for AI agent platform',
    role: 'WORKER_STRATEGIST',
    goal:
      'I am the CEO of an early-stage AI agent platform. Do a brief SWOT analysis (Strengths/Weaknesses/Opportunities/Threats) for our company in the multi-agent orchestration space. Be specific and honest.',
    expect: [/strength/i, /weakness/i, /opportunit/i, /threat/i],
    timeoutMs: 180_000,
  },
  {
    id: 'research-frameworks',
    name: 'Research compares LangGraph / CrewAI / AutoGen',
    role: 'WORKER_RESEARCH',
    goal:
      'Research the current state of LangGraph vs CrewAI vs AutoGen as multi-agent orchestration frameworks. Compare on: developer ergonomics, production-readiness, community size. Cite sources.',
    expect: [/langgraph/i, /crewai/i, /autogen/i],
    timeoutMs: 240_000,
  },
  {
    id: 'coding-pandas-script',
    name: 'Coder writes a working Python pandas CLI',
    role: 'WORKER_CODER',
    goal:
      'Write a Python script that takes a CSV file path as a CLI arg, reads it, and prints the top 5 rows by a column called "revenue" descending. Use pandas. Include error handling for missing file.',
    expect: [/pandas|read_csv/i, /sort_values|head\(5\)/i, /argparse|sys\.argv/i],
    timeoutMs: 120_000,
  },
];
