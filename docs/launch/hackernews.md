# JAK Swarm - Hacker News Post

---

## Title

Show HN: JAK Swarm -- Open-source multi-agent AI platform (39 agents, 119 tools, 6 LLM providers)

---

## Body

Hi HN,

I've been building JAK Swarm for the past 14 months and wanted to share it with you. It's an open-source (MIT) multi-agent AI platform written in Python.

GitHub: https://github.com/inbharatai/jak-swarm

**What it is:**

JAK Swarm lets you orchestrate multiple specialized AI agents that work together on complex tasks. Instead of sending one giant prompt to one model, you break work into pieces and let focused agents handle each part.

- 38 pre-built agents (research, code analysis, data processing, content generation, etc.)
- 119 tools (web scraping, file I/O, API calls, code execution, database queries, etc.)
- 6 LLM providers (OpenAI, Anthropic, Google, Mistral, Ollama, Groq)
- Shared context system for inter-agent communication
- Dynamic tool selection and agent delegation

**How it works:**

The architecture is intentionally simple. An orchestrator takes a task, decomposes it into subtasks, assigns each to a specialized agent, and manages the execution flow. Agents communicate through a shared context (essentially a growing dictionary). Each agent is a thin wrapper around a system prompt, a tool set, and an LLM provider.

There's no message queue, no distributed systems layer, no complex middleware. You can read and understand the entire codebase in a day -- it's under 15K lines of Python.

**What it's not:**

- It's not a LangChain alternative. LangChain is a general-purpose LLM framework. JAK Swarm is specifically about multi-agent orchestration.
- It's not production-ready for high-throughput use cases. It's designed for developer workflows, research tasks, and automation -- not for serving 10K concurrent users.
- It's not trying to be everything. The agent and tool ecosystem is opinionated. Not every possible integration exists yet.

**Honest limitations:**

- Context management gets messy with 10+ agents on a single task. Working on better pruning strategies.
- Ollama support works but is noticeably slower than cloud providers for complex multi-agent tasks.
- The tool library is broad but shallow in some areas. Database tools, for instance, only cover PostgreSQL and SQLite right now.
- Documentation is functional but not great. Improving it actively.
- No visual workflow builder yet. Everything is code-first.

**Why I built this:**

I was building AI-powered automation for my company (InBharat AI) and found myself writing the same orchestration boilerplate repeatedly. Every project needed a research step, an analysis step, a generation step, and a review step. The agents were always the same patterns with slightly different prompts and tools.

So I extracted the patterns into a framework. Then I added more agents. Then more tools. Then provider abstraction. 14 months later, here we are.

**Tech stack:**

- Python 3.10+
- No heavy framework dependencies -- just the LLM provider SDKs
- Async execution for parallel agent tasks
- Structured logging for observability
- Token tracking and cost management built in

I'd appreciate any feedback on the architecture, the agent design patterns, or the developer experience. I'm also very interested in what agents or tools people would want to see added.

Happy to answer any questions.
