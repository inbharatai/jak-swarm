# JAK Swarm - Product Hunt Launch

---

## Tagline (60 chars)

Open-source multi-agent AI with 33 agents and 79 tools

---

## Description (260 chars)

JAK Swarm is an open-source multi-agent AI platform with 33 specialized agents, 79 tools, and support for 6 LLM providers. Build complex AI workflows by orchestrating agents that collaborate, delegate, and execute tasks together. No vendor lock-in. Free forever.

---

## Maker's First Comment

Hey Product Hunt! Reeturaj here, founder of InBharat AI.

I started building JAK Swarm out of frustration. I was working on an AI project that needed multiple specialized capabilities -- research, code generation, data analysis, content creation -- and I realized I was stitching together a dozen different tools with duct tape and prayers.

So I asked: what if AI agents could work together the way a real team does? A researcher hands off findings to an analyst, who passes insights to a writer, who sends the draft to an editor. Each one specialized. Each one focused.

That question turned into 14 months of building. JAK Swarm now has 33 agents, 79 tools, and works with 6 different LLM providers (OpenAI, Anthropic, Google, Mistral, Ollama, and more). You can run the whole thing locally with Ollama if you want zero cloud dependency.

What makes this different from LangChain or CrewAI:

- True multi-agent orchestration, not just chaining prompts
- Agents can delegate to other agents dynamically
- Works with any LLM provider -- swap models without changing code
- Every agent is customizable and extensible
- Fully open-source, MIT licensed

I built this because I believe AI agents should be accessible to every developer, not just those at well-funded companies. The entire platform is free, runs locally, and you own your data.

Would love your feedback. What agents or tools would you want to see added? I'm building this in public and your input directly shapes the roadmap.

GitHub: https://github.com/inbharatai/jak-swarm

---

## Screenshot Descriptions

### Screenshot 1: Dashboard Overview
Title: "33 Agents, One Dashboard"
Description: The JAK Swarm control panel showing all 33 agents organized by category -- Research, Code, Data, Content, and Utility. Each agent card displays its name, description, available tools, and current status. The sidebar shows active swarm sessions and recent task history.

### Screenshot 2: Agent Orchestration Flow
Title: "Watch Agents Collaborate in Real-Time"
Description: A visual flowchart showing a multi-agent task in progress. The Research Agent has gathered data and is handing it off to the Analysis Agent, which will then pass results to the Report Agent. Connection lines show data flow between agents, with status indicators (completed, in-progress, queued) at each node.

### Screenshot 3: Tool Library
Title: "79 Tools. Zero Configuration."
Description: The tool library view showing all 79 available tools grouped by function -- Web Scraping, File Operations, API Integrations, Code Execution, Data Processing, and more. Each tool shows its description, required parameters, and which agents can use it. A search bar at the top allows filtering.

### Screenshot 4: LLM Provider Configuration
Title: "6 Providers. Your Choice."
Description: The LLM configuration screen showing supported providers -- OpenAI, Anthropic, Google Gemini, Mistral, Ollama (local), and Groq. Each provider card shows available models, pricing tier, and a toggle to enable/disable. The Ollama section highlights "Runs 100% locally -- no API key needed."

### Screenshot 5: Code Example
Title: "Deploy a Swarm in 10 Lines of Code"
Description: A clean code editor view showing a minimal Python example that initializes JAK Swarm, creates a research agent and a writing agent, connects them in a pipeline, and executes a task. The terminal below shows the output -- the agents working through the task step by step with clear, readable logs.
