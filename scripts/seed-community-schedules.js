#!/usr/bin/env node
/**
 * JAK Swarm — Seed Community Building Scheduled Workflows
 *
 * Creates persistent scheduled workflows in the database that auto-run
 * on the API server. These generate content, create images, and post
 * to Twitter/LinkedIn/Reddit automatically.
 *
 * Prerequisites:
 * 1. PostgreSQL running with DATABASE_URL configured
 * 2. Database migrated (pnpm db:migrate)
 * 3. At least one tenant + user created (register via UI or API)
 *
 * Usage:
 *   DATABASE_URL=postgresql://... TENANT_ID=... USER_ID=... node scripts/seed-community-schedules.js
 *
 * Or manually create schedules via the API:
 *   POST /schedules { name, goal, cronExpression, ... }
 */

const TENANT_ID = process.env.TENANT_ID ?? 'default';
const USER_ID = process.env.USER_ID ?? 'default';

const schedules = [
  {
    name: 'Daily Twitter Post',
    description: 'Generate and post a tweet about JAK Swarm with DALL-E image',
    goal: `You are the social media manager for JAK Swarm (github.com/inbharatai/jak-swarm), an open-source AI agent platform with 33 agents, 79 tools, and 6 LLM providers.

Task: Create and post a tweet to Twitter/X.

Steps:
1. Use web_search to find a trending AI/automation topic today
2. Write a punchy tweet (max 280 chars) connecting that topic to JAK Swarm. Include relevant hashtags (#AIAgents #Automation #OpenSource)
3. Use generate_image to create an eye-catching visual for the tweet (modern, tech, blue/purple theme)
4. Use post_to_twitter to post the tweet with the generated image

Be creative. Never repeat the same content. Vary between: feature highlights, use cases, comparisons, tips, behind-the-scenes.`,
    cronExpression: '0 9 * * *', // Every day at 9am
    maxCostUsd: 0.50,
  },
  {
    name: 'Weekly Reddit Post',
    description: 'Post valuable content to AI/tech subreddits',
    goal: `You are a community member who genuinely loves AI technology and happens to have built JAK Swarm (github.com/inbharatai/jak-swarm).

Task: Create a Reddit post that provides GENUINE VALUE (not spam).

Steps:
1. Use web_search to find what AI/agent topics are hot on Reddit this week
2. Pick ONE subreddit from: artificial, LocalLLaMA, SideProject, MachineLearning, startups
3. Write a post that shares a genuine insight, tutorial, or experience. Examples:
   - "I built a 33-agent AI swarm. Here's what I learned about multi-agent orchestration"
   - "4 things I wish I knew before building an AI agent platform"
   - "How I reduced LLM costs by 80% with tier-based routing"
4. Use post_to_reddit with the chosen subreddit, title, and body

CRITICAL: Reddit HATES promotional content. Lead with VALUE. Mention JAK Swarm only at the end as "I built this open-source tool that does X" — never as the main point.`,
    cronExpression: '0 12 * * 3', // Wednesday at noon
    maxCostUsd: 0.30,
  },
  {
    name: 'Weekly Blog Draft',
    description: 'Generate a technical blog post draft for Dev.to/Hashnode',
    goal: `You are a technical writer creating content for JAK Swarm's blog.

Task: Write a complete blog post draft (800-1200 words).

Steps:
1. Use web_search to find what developers are searching for related to AI agents
2. Pick a topic that provides genuine technical value and naturally connects to JAK Swarm
3. Write the full blog post with:
   - Engaging title (SEO-optimized)
   - Hook paragraph
   - Technical content with code snippets where relevant
   - Architecture diagram (ASCII art)
   - Conclusion with soft CTA to JAK Swarm GitHub
4. Use file_write to save the draft as a markdown file in the workspace

Good topics: multi-agent architectures, LLM cost optimization, browser automation with Playwright, IMAP/SMTP email integration, DAG task scheduling, self-correction in AI agents.`,
    cronExpression: '0 14 * * 2', // Tuesday at 2pm
    maxCostUsd: 0.20,
  },
  {
    name: 'Platform Discovery & Outreach',
    description: 'Find new communities and platforms to share JAK Swarm',
    goal: `You are JAK Swarm's growth hacker.

Task: Discover new platforms and communities where JAK Swarm should have a presence.

Steps:
1. Use discover_posting_platforms to find communities related to "AI agents autonomous automation"
2. Use web_search to find:
   - New Discord servers about AI/agents
   - Slack communities for developers
   - Forums and communities we haven't posted in yet
   - Newsletters that cover AI tools (pitch opportunity)
   - YouTube channels that review AI tools (collaboration opportunity)
3. Use file_write to save the findings as a report

For each platform found, note:
- Platform name and URL
- Audience size (if visible)
- Best content format (post, article, comment, DM)
- Draft a first message/post for that platform`,
    cronExpression: '0 11 * * 5', // Friday at 11am
    maxCostUsd: 0.15,
  },
];

console.log(`
╔══════════════════════════════════════════════════════════╗
║  JAK Swarm — Community Building Scheduled Workflows      ║
╠══════════════════════════════════════════════════════════╣
║  ${schedules.length} workflows to create:                                ║
`);

for (const s of schedules) {
  console.log(`║  📅 ${s.name.padEnd(40)} ${s.cronExpression.padEnd(12)} ║`);
}

console.log(`╠══════════════════════════════════════════════════════════╣
║                                                          ║
║  To seed these into the database, run the API server     ║
║  and call POST /schedules for each workflow.             ║
║                                                          ║
║  Or use the Schedules UI at /schedules in the dashboard. ║
║                                                          ║
╚══════════════════════════════════════════════════════════╝
`);

// Output as JSON for easy API import
console.log('\n--- JSON for API import ---\n');
console.log(JSON.stringify(schedules.map(s => ({
  name: s.name,
  description: s.description,
  goal: s.goal,
  cronExpression: s.cronExpression,
  maxCostUsd: s.maxCostUsd,
})), null, 2));
