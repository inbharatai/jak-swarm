# JAK Swarm - Reddit Posts

---

## Post 1: r/artificial

**Title:** I open-sourced a multi-agent AI platform after 14 months of development -- 38 agents, 112 tools, 6 LLM providers

**Body:**

After spending 14 months building AI orchestration systems for my own projects, I decided to open-source the whole thing. JAK Swarm is a multi-agent AI platform that lets you run teams of specialized AI agents that collaborate on complex tasks.

The core idea is simple: instead of one all-purpose AI call, you create specialized agents (a researcher, a coder, an analyst, a writer) and let them work together. Each agent has focused system prompts, specific tool access, and can use any LLM provider.

What's included:

- 33 pre-built specialized agents covering research, code, data, content, and utility tasks
- 112 tools for web scraping, file operations, API calls, code execution, and more
- Support for OpenAI, Anthropic, Google, Mistral, Ollama (local), and Groq
- Shared context system for agent communication
- Dynamic delegation (agents can hand off work to other agents mid-task)

A few things that might interest this community:

The agent architecture is intentionally minimal. Each agent is just a system prompt + a tool set + an LLM provider. No complex inheritance hierarchies. You can create a new agent in about 20 lines of code.

The provider abstraction means you can run the same agent pipeline on GPT-4 for quality, Groq for speed, or Ollama for complete local privacy. Swap a config value and everything else stays the same.

I'm particularly interested in feedback from people who've worked with multi-agent systems. What patterns have you found that work? What should I avoid?

MIT licensed: https://github.com/inbharatai/jak-swarm

---

## Post 2: r/LocalLLaMA

**Title:** Built an open-source multi-agent platform that works with Ollama -- run 33 AI agents entirely locally

**Body:**

I wanted to share something I think this community will appreciate: JAK Swarm supports Ollama as a first-class LLM provider, meaning you can run the entire multi-agent platform locally without any API keys or cloud dependencies.

JAK Swarm is an open-source multi-agent AI platform with 38 specialized agents and 112 tools. The agents collaborate on tasks -- research, code analysis, data processing, content generation, and more.

Why local LLM users should care:

- Full Ollama integration. Point it at your local Ollama instance and go
- Use different local models for different agents. Codestral for your code agent, Llama for your general agent, Mistral for your writing agent
- Zero data leaves your machine. No API calls. No telemetry. Nothing phones home
- Token tracking works with local models too, so you can benchmark performance

I'll be honest about the limitations with local models:

- Complex multi-agent tasks (5+ agents in a chain) can be slow depending on your hardware
- Some of the larger agent workflows were tuned on GPT-4 class models and may need prompt adjustments for smaller local models
- Tool-use reliability varies by model. Models with strong instruction following work best

The platform also supports cloud providers (OpenAI, Anthropic, Google, Mistral, Groq), so you can mix and match. Use local models for privacy-sensitive tasks and cloud models when you need the extra capability.

The project is MIT licensed and I'd love feedback from people running local models on how the agent prompts perform with different model families.

GitHub: https://github.com/inbharatai/jak-swarm

What local models are you running? I want to add specific optimization notes for popular Ollama models.

---

## Post 3: r/SideProject

**Title:** 14 months of evenings and weekends: I built an open-source AI agent platform with 38 agents and 112 tools

**Body:**

I want to share the side project that consumed my last 14 months. JAK Swarm is an open-source multi-agent AI platform that lets you build AI teams -- multiple specialized agents working together on complex tasks.

The journey in numbers:

- Started: Early 2025
- Time invested: ~1,400 hours of evenings and weekends
- Agents built: 33
- Tools integrated: 79
- LLM providers supported: 6
- Lines of Python: ~15,000
- License: MIT (completely free)

What I'd do differently:

1. Start with fewer agents. I built 20 before I had users. Half of them needed significant rework based on real-world feedback. Should have started with 5 solid ones.

2. Write documentation as I build, not after. Playing catch-up on docs is painful and the quality suffers.

3. Get community involved earlier. I worked in isolation for months when other developers could have helped spot design issues sooner.

What went right:

1. Keeping the architecture simple. Under 15K lines. Anyone can read and understand it. This made iteration fast.

2. Provider abstraction from day one. Supporting 6 LLM providers is easy when the abstraction layer is solid. Retrofitting it would have been a nightmare.

3. Building tools I personally needed. Every agent and tool exists because I hit a real problem. Nothing was built speculatively.

If you're thinking about building an open-source side project, my biggest advice: solve your own problem first. I built JAK Swarm because I needed it. That kept me motivated through the inevitable "why am I doing this at 11pm on a Tuesday" moments.

GitHub: https://github.com/inbharatai/jak-swarm

Happy to answer questions about the build process, architecture decisions, or the open-source journey.

---

## Post 4: r/webdev

**Title:** How I built a tool-use system for 33 AI agents -- architecture patterns that might be useful for your projects

**Body:**

I recently open-sourced JAK Swarm, a multi-agent AI platform, and I wanted to share some of the architecture patterns that webdevs building AI features might find useful.

The challenge: I needed 33 different AI agents to be able to discover and use 79 different tools (web scraping, file I/O, API calls, code execution, etc.) without hardcoding every combination.

The solution has three parts:

**1. Tool Registry Pattern**

Every tool registers itself with a standard interface: name, description, parameters schema, and an execute function. Think of it like a service registry in microservices. Agents don't import tools directly -- they query the registry.

**2. Dynamic Tool Resolution**

When an agent needs a tool, it describes what it needs in natural language. The resolver matches the description against registered tools using semantic similarity. The agent gets back the best-matching tool without knowing its implementation details.

**3. Normalized Provider Interface**

Every LLM provider (OpenAI, Anthropic, Google, Mistral, Ollama, Groq) has a different API. I built a single interface that normalizes them all. You write agent logic once and swap providers with a config change. This is useful for any project using LLMs -- not just multi-agent systems.

These patterns work well beyond AI agent platforms. If you're building AI features into web apps, the tool registry and provider abstraction patterns translate directly.

A few practical tips for webdevs adding AI to projects:

- Always track token usage. Costs sneak up fast.
- Build retry logic with exponential backoff for every LLM call. They fail more often than you'd expect.
- Validate LLM output structurally before using it. If you expect JSON, parse it and handle failures.
- Log everything. Debugging AI features without logs is practically impossible.

The full codebase is MIT licensed and under 15K lines of Python: https://github.com/inbharatai/jak-swarm

---

## Post 5: r/startups

**Title:** I'm open-sourcing my AI agent platform instead of charging for it -- here's why

**Body:**

I spent 14 months building JAK Swarm, a multi-agent AI platform with 38 agents, 112 tools, and support for 6 LLM providers. And I'm giving it away for free under the MIT license.

People keep asking me if I'm going to monetize this. The answer is: not directly.

Here's my thinking:

**The competitive landscape favors open-source.**

LangChain, CrewAI, AutoGen, and dozens of other frameworks are competing for the AI tooling market. Some are open-source, some are freemium. For a solo developer in India, trying to out-market VC-backed companies selling proprietary AI platforms is a losing game.

But I can build something genuinely useful, make it completely free, and let the distribution compound.

**Open-source is a distribution channel, not a product.**

JAK Swarm establishes my expertise and InBharat AI's capabilities. Every developer who uses it knows our name. Some of them will need custom AI solutions and come to us. Some will hire us for consulting. The software is free; the expertise is what has value.

**The real moat is community, not code.**

If 500 developers contribute agents and tools to JAK Swarm, the platform becomes more valuable than anything I could build alone. That community is the moat. You can't fork community momentum.

**What I've learned building this that's relevant to other founders:**

1. Being an open-source maintainer is a form of marketing that never stops working. Blog posts get buried. Ads stop when you stop paying. But a useful open-source project compounds.

2. "Free" doesn't mean "no business model." It means the business model is indirect. I've already had consulting inquiries from people who found JAK Swarm.

3. Shipping fast matters more than shipping perfect. JAK Swarm has limitations (documented honestly in the README). Users respect honesty more than polish.

GitHub: https://github.com/inbharatai/jak-swarm

For other founders building in AI: are you going open-source or proprietary? What's driving your decision?
