# JAK Swarm - Influencer Outreach

---

## 1. Fireship (Jeff Delaney)

**Platform:** YouTube (2M+ subscribers), Twitter
**Why:** Known for fast-paced, honest dev tool reviews. His audience is exactly the developer demographic that would use JAK Swarm. A "100 seconds of" style video would drive massive awareness.

**DM (Twitter):**

Hey Jeff, I'm a solo developer from India who just open-sourced JAK Swarm -- a multi-agent AI platform with 38 agents, 119 tools, and support for 6 LLM providers including fully local execution via Ollama.

The pitch for your audience: a TypeScript monorepo with deliberately simple abstractions. Agents are just a system prompt + tool set + LLM provider. You can understand it in a day and build a new agent in a few lines.

Would make for a fun "100 seconds of multi-agent AI" or an honest review. Happy to give you a technical walkthrough if it's interesting.

GitHub: github.com/inbharatai/jak-swarm

---

## 2. Andrej Karpathy

**Platform:** Twitter, YouTube
**Why:** One of the most respected voices in AI. Even a like or retweet would drive enormous attention from the ML/AI community. His audience appreciates clean, simple engineering.

**DM (Twitter):**

Hi Andrej, I built JAK Swarm, an open-source multi-agent AI platform. 38 specialized agents, 119 tools, 6 LLM providers, in a TypeScript monorepo.

The design philosophy you might appreciate: agents communicate through a shared context (literally a dictionary), not complex message buses. Specialization beats generalization -- 38 focused agents significantly outperform fewer general-purpose ones. And the whole thing runs locally with Ollama.

I know you value simple, readable code. The entire architecture is designed to be understood in a few hours.

Would love any feedback: github.com/inbharatai/jak-swarm

---

## 3. Matt Shumer

**Platform:** Twitter
**Why:** CEO of HyperWrite, very active in the AI agent space. Frequently shares and discusses open-source AI tools. His audience is deeply technical and agent-focused.

**DM (Twitter):**

Hey Matt, I've been following your work on AI agents and wanted to share something: JAK Swarm, an open-source multi-agent platform I just released after 14 months of building.

What might interest you from an agent architecture perspective: agents delegate to each other dynamically (not just sequential chains), tool selection is resolved at runtime through a registry pattern, and the LLM provider layer is fully abstracted so you can mix Claude for writing, GPT-4 for reasoning, and Ollama for privacy in the same pipeline.

38 agents, 119 tools, MIT licensed: github.com/inbharatai/jak-swarm

Would love your take on the delegation patterns.

---

## 4. Lenny Rachitsky

**Platform:** Newsletter, Twitter, YouTube
**Why:** Massive reach in the product/startup community. His audience includes builders and founders who would benefit from understanding multi-agent AI tools.

**DM (Twitter):**

Hi Lenny, I'm a solo developer from India who just open-sourced a multi-agent AI platform called JAK Swarm (38 agents, 119 tools, 6 LLM providers).

The story that might interest your audience: I built this over 14 months of evenings and weekends while running InBharat AI. The business decision to open-source (MIT license, free forever) instead of charging was deliberate -- open source as distribution strategy, not business model. I've already gotten consulting inquiries just from people discovering the project.

It's a "build in public" story with some honest lessons about building developer tools as a solo founder.

github.com/inbharatai/jak-swarm

---

## 5. Yannic Kilcher

**Platform:** YouTube, Twitter
**Why:** Deep technical AI content creator. His audience can evaluate and contribute to the technical architecture. A review from Yannic carries significant weight in the ML community.

**DM (Twitter):**

Hi Yannic, I built JAK Swarm -- an open-source multi-agent AI platform that takes a deliberately simple approach to agent orchestration.

The technical bit: 38 agents communicate through shared state (no message queues), tools are resolved dynamically through a registry with semantic matching, and the system is a TypeScript monorepo with a minimal dependency surface. It supports 6 providers including Ollama for fully local execution.

One finding that might be worth discussing: specializing agents (narrow prompt + few tools) significantly outperforms generalist agents on complex tasks, even when the underlying LLM is the same. The prompt constraints seem to matter more than the model capability.

github.com/inbharatai/jak-swarm

---

## 6. Mckay Wrigley

**Platform:** Twitter, YouTube
**Why:** Builds AI tools in public and has a large developer following. Known for reviewing and building with open-source AI projects. Would likely try JAK Swarm and share his experience.

**DM (Twitter):**

Hey Mckay, I just open-sourced JAK Swarm -- a multi-agent AI platform with 38 agents, 119 tools, and 6 LLM providers.

Given your work building AI tools, I think you'd find the architecture interesting. Each agent is dead simple (system prompt + tools + LLM), agents delegate to each other dynamically, and you can mix providers per agent. The whole thing works with Ollama for full local execution.

I designed it so a developer can create a new agent in about 20 lines of code. Would love to see what you'd build with it or hear where you think the approach falls short.

github.com/inbharatai/jak-swarm

---

## 7. Riley Brown

**Platform:** Twitter, YouTube
**Why:** Creates practical AI development tutorials. His audience is developers actively building with AI, which is exactly the JAK Swarm target user.

**DM (Twitter):**

Hey Riley, I've been watching your AI dev tutorials and wanted to share a project: JAK Swarm, an open-source multi-agent AI platform I built over 14 months.

It would make for a great tutorial topic -- you can set up a multi-agent pipeline (research agent to analysis agent to writing agent) in about 10 lines of code, and the whole thing works with Ollama so your viewers can follow along without API keys.

38 agents, 119 tools, 6 providers, MIT licensed: github.com/inbharatai/jak-swarm

Happy to jump on a call to walk through the architecture if you want to cover it.

---

## 8. Harrison Chase

**Platform:** Twitter
**Why:** Creator of LangChain. While JAK Swarm is a different tool, Harrison frequently amplifies interesting open-source AI projects. Getting his attention would validate JAK Swarm in the LLM framework community.

**DM (Twitter):**

Hi Harrison, I built JAK Swarm, an open-source multi-agent AI platform that focuses specifically on agent orchestration. It's not a LangChain replacement -- it's a complement for the multi-agent coordination layer.

The approach: 38 specialized agents communicate through shared context, delegate dynamically, and use different LLM providers per agent. The architecture is intentionally narrow (just orchestration, not a full LLM framework) and simple (no complex abstractions).

I've been open about positioning: LangChain for comprehensive LLM tooling, JAK Swarm for focused multi-agent workflows. Would appreciate any feedback on the agent patterns.

github.com/inbharatai/jak-swarm

---

## 9. Swyx (Shawn Wang)

**Platform:** Twitter, Newsletter (Latent Space)
**Why:** AI engineer thought leader. His Latent Space podcast and newsletter reach serious AI builders. He values thoughtful engineering and honest takes on AI tooling.

**DM (Twitter):**

Hey Swyx, I wanted to share JAK Swarm -- an open-source multi-agent platform I built over 14 months as a solo developer in India.

The angle I think would resonate with the Latent Space audience: my core finding after building 38 agents is that specialization + simple coordination crushes generalization + complex coordination. A focused agent with 3 tools and a tight prompt beats a general agent with 30 tools almost every time. The shared context architecture (a dictionary, not a message queue) is boring but outperformed every "sophisticated" pattern I tried.

6 LLM providers, 119 tools, TypeScript monorepo, MIT licensed: github.com/inbharatai/jak-swarm

Would be a fun Latent Space topic -- the case for boring agent architectures.

---

## 10. Lina Khan / Simon Willison

**Platform:** Twitter, Blog
**Why:** Simon Willison is one of the most respected voices in the open-source community. His blog posts about tools get enormous developer attention. He values practical, well-engineered tools and honest documentation.

**DM (Twitter):**

Hi Simon, I built JAK Swarm, an open-source (MIT) multi-agent AI platform in TypeScript. 38 agents, 119 tools, 6 LLM providers.

What I think you'd appreciate: no framework dependencies beyond LLM SDKs, agents are just a system prompt + tool set + provider (no magic base classes), tools register through a standard interface and are resolved dynamically, and the whole thing runs locally with Ollama. I prioritized readability and simplicity over abstraction.

I was directly inspired by your writing about building tools that are transparent and inspectable. Every agent call, tool invocation, and LLM response is logged by default.

github.com/inbharatai/jak-swarm

Would love your feedback on the design.
