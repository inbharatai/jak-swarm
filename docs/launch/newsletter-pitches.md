# JAK Swarm - Newsletter Pitches

---

## 1. The Rundown AI

**Subject:** Open-source multi-agent AI platform: 39 agents, 119 tools, 6 providers (MIT licensed)

Hi Rundown team,

I just open-sourced JAK Swarm, a multi-agent AI platform that lets developers orchestrate 33 specialized AI agents working together on complex tasks. It supports 119 tools and 6 LLM providers (OpenAI, Anthropic, Google, Mistral, Ollama, Groq), and runs fully locally with Ollama for developers who need data privacy.

The core idea: instead of sending one giant prompt to one model, you create a team of focused agents -- a researcher, an analyst, a coder, a writer -- that collaborate and hand off work to each other. Each agent picks its own tools, manages its own context, and delegates to other agents when needed. The architecture is deliberately simple (under 15K lines of Python) so any developer can read and extend it.

JAK Swarm is MIT licensed, free, and designed for developers building AI-powered automation, research pipelines, and content workflows. The project is live on GitHub at github.com/inbharatai/jak-swarm and we're actively building the community.

Best,
Reeturaj Goswami
InBharat AI

---

## 2. Ben's Bites

**Subject:** JAK Swarm: 38 AI agents working as a team (open-source, MIT)

Hi Ben,

Quick pitch for your readers: I built JAK Swarm, an open-source multi-agent AI platform where 39 specialized agents collaborate on tasks using 119 tools and any of 6 LLM providers. Think of it as building an AI team instead of making one AI do everything.

What makes it interesting for your audience: developers can mix and match LLM providers per agent (Claude for writing, GPT-4 for code, Ollama for privacy-sensitive work), the entire thing runs locally with zero cloud dependency if needed, and the codebase is intentionally simple -- under 15K lines of Python, readable in a day. Agents dynamically delegate work to each other, select their own tools, and handle failures with built-in retry logic.

It's MIT licensed, built by a solo developer (me) in India over 14 months, and I'm positioning it as the accessible alternative for developers who want multi-agent AI without the complexity of enterprise frameworks. GitHub: github.com/inbharatai/jak-swarm

Reeturaj Goswami
InBharat AI

---

## 3. TLDR AI

**Subject:** Show TLDR: Multi-agent AI platform with 39 agents, works with Ollama locally

Hi TLDR team,

I'd love to share JAK Swarm with your readers. It's an open-source (MIT) multi-agent AI platform built in Python with 38 pre-built agents, 119 tools, and support for 6 LLM providers including full Ollama support for local execution.

The technical angle that your developer-focused audience will appreciate: JAK Swarm uses a shared context architecture for agent communication (no message queues or complex middleware), dynamic tool resolution so agents discover capabilities at runtime, and a normalized LLM provider interface that lets you swap between OpenAI, Anthropic, Google, Mistral, Ollama, and Groq with a config change. The orchestrator handles task decomposition, agent assignment, and failure recovery automatically.

This is a solo project from India (InBharat AI) that's taken 14 months to build. The entire codebase is under 15K lines, designed to be readable and extensible. Looking for developer feedback and contributors. GitHub: github.com/inbharatai/jak-swarm

Reeturaj Goswami

---

## 4. AI Breakfast

**Subject:** Launching an open-source AI swarm: 39 agents that work together

Hi AI Breakfast team,

I just released JAK Swarm, an open-source platform where multiple AI agents collaborate on complex tasks -- like having a team of AI specialists instead of one generalist. It ships with 39 agents, 119 tools, and works with 6 different LLM providers.

The use cases that might resonate with your audience: a research swarm that gathers information from dozens of sources and produces structured reports, a code analysis pipeline that reviews a codebase across multiple dimensions simultaneously, and a content workflow where research, writing, editing, and fact-checking agents each handle their specialty. All orchestrated automatically with built-in cost tracking and failure handling.

The project is MIT licensed, runs locally with Ollama, and was built over 14 months by a solo developer. I'm actively looking for community feedback on which agents and tools to prioritize next. GitHub: github.com/inbharatai/jak-swarm

Best,
Reeturaj Goswami
InBharat AI

---

## 5. The Neuron

**Subject:** Open-sourcing 14 months of work: multi-agent AI with 39 agents

Hi Neuron team,

I'm sharing JAK Swarm, an open-source multi-agent AI platform I've been building for the past 14 months. It ships with 39 specialized agents, 119 tools, and supports 6 LLM providers -- including full local execution via Ollama.

What sets it apart from other agent frameworks: the focus on practical, task-based agent orchestration rather than conversational AI. Agents are specialists -- a Research Agent with web scraping tools, a Code Agent with execution capabilities, a Data Agent with analysis tools -- that hand work to each other through a simple shared context system. Developers can create new agents in about 20 lines of code and new tools with a standard registration interface.

I built this as a solo developer at InBharat AI in India because the existing frameworks were either too complex for straightforward multi-agent tasks or too limited for real orchestration. It's MIT licensed, the codebase is under 15K lines of Python, and I'm building the community openly. GitHub: github.com/inbharatai/jak-swarm

Reeturaj Goswami

---

## 6. Import AI

**Subject:** Multi-agent orchestration platform: 39 agents, simple architecture, MIT licensed

Hi Jack,

I wanted to share JAK Swarm, an open-source multi-agent AI platform that might interest your more technically-minded readers. It's a Python framework for orchestrating 33 specialized AI agents across 6 LLM providers using a deliberately simple architecture.

The design philosophy: agents communicate through a shared context (a growing dictionary, not a message queue), tools are resolved dynamically through a registry pattern, and LLM providers are fully abstracted so agent logic is provider-agnostic. The orchestrator handles task decomposition and delegation, and agents can recursively delegate to other agents. Failure handling includes retries with exponential backoff, output validation, and fallback strategies. The entire system is under 15K lines of Python with no framework dependencies beyond the LLM SDKs.

This reflects 14 months of building and iterating as a solo developer. My main finding: specialized agents with narrow tool sets significantly outperform generalist agents on complex tasks, and simple communication patterns (shared state) beat sophisticated ones (pub/sub, event systems) for debuggability. MIT licensed at github.com/inbharatai/jak-swarm

Reeturaj Goswami
InBharat AI

---

## 7. AI Weekly

**Subject:** New open-source project: 38 AI agents working as a coordinated team

Hi AI Weekly team,

I'd like to pitch JAK Swarm for your readers. It's an open-source multi-agent AI platform that I've been building for 14 months. The platform ships with 38 pre-built agents, 119 tools, and support for 6 LLM providers.

The angle I think your audience would find valuable: JAK Swarm demonstrates that multi-agent AI doesn't need to be complex to be effective. The architecture uses shared context (not message queues), thin agent wrappers (not deep inheritance hierarchies), and dynamic tool resolution (not hardcoded tool calls). A developer can understand the entire system in a day and build a new agent in 20 lines of code.

The project is MIT licensed, supports full local execution via Ollama, and includes built-in cost tracking so developers can manage LLM spending across multi-agent workflows. Looking for early adopters and contributors. GitHub: github.com/inbharatai/jak-swarm

Reeturaj Goswami
InBharat AI

---

## 8. Superhuman AI

**Subject:** JAK Swarm: run 38 AI agents locally with zero cloud dependency

Hi Superhuman AI team,

I just launched JAK Swarm, an open-source multi-agent AI platform that runs entirely locally. 38 specialized agents, 119 tools, 6 LLM providers -- including Ollama for complete on-device execution with no API keys required.

What your productivity-focused audience should know: JAK Swarm handles multi-step tasks by breaking them into subtasks and assigning each to a specialized agent. A research workflow that would take a human hours -- searching multiple sources, extracting key information, analyzing patterns, and writing a structured report -- runs in minutes. The agents handle the orchestration; users just define the task and the output format.

Built over 14 months by a solo developer (InBharat AI), MIT licensed, and designed to be extended by the community. The codebase is intentionally simple so anyone can add agents and tools for their specific workflows. GitHub: github.com/inbharatai/jak-swarm

Best,
Reeturaj Goswami

---

## 9. The AI Valley

**Subject:** 38 AI agents, one platform, fully open-source -- JAK Swarm launch

Hi AI Valley team,

I'm reaching out about JAK Swarm, a multi-agent AI platform I just open-sourced after 14 months of development. It ships with 39 agents, 119 tools, and works with 6 LLM providers including local execution through Ollama.

The story that might resonate with your audience: I'm a solo developer in India who built this because the existing AI frameworks didn't solve my specific problem -- coordinating multiple specialized AI agents on complex tasks without drowning in infrastructure complexity. JAK Swarm keeps the architecture deliberately simple (under 15K lines of Python) so the barrier to entry is low. No complex setup. No heavy dependencies. Install it and start orchestrating agents in minutes.

The project is MIT licensed with no usage limits, no freemium gating, and no plans to change that. I'm building the community and looking for developers who want to contribute agents, tools, and integrations. GitHub: github.com/inbharatai/jak-swarm

Reeturaj Goswami
InBharat AI

---

## 10. AI Tool Report

**Subject:** New AI tool: JAK Swarm -- orchestrate 39 agents with any LLM provider

Hi AI Tool Report team,

I'd like to share JAK Swarm with your readers. It's a free, open-source multi-agent AI platform that ships with 33 ready-to-use agents, 119 tools, and support for 6 LLM providers.

What makes it relevant for your tool-focused audience: JAK Swarm is a force multiplier for anyone using AI tools. Instead of manually moving between different AI tools and copying context between them, you define a task and let specialized agents handle the entire workflow. Research, analysis, coding, writing, and review agents work in sequence, passing context automatically. It supports OpenAI, Anthropic, Google, Mistral, Ollama (fully local), and Groq, and you can use different providers for different agents in the same workflow.

Setup takes under five minutes, it's MIT licensed (free forever), and the pre-built agents work out of the box while being fully customizable. I built it over 14 months and am actively developing based on community feedback. GitHub: github.com/inbharatai/jak-swarm

Reeturaj Goswami
InBharat AI
