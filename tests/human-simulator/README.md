# JAK Swarm — Human Simulator Tests

3 simulated users test the platform end-to-end, exactly like real humans would.

## Users

| Agent | Role | What They Test |
|-------|------|---------------|
| **Sarah** | CEO / Founder | Strategy, competitor research, board summaries, financial models, PR, legal compliance, web search, statistics |
| **Dev** | Senior Engineer | Code generation, architecture review, code execution, file I/O, PDF extraction, project estimation, feature specs, web fetch |
| **Maya** | Marketing Director | Social media content, SEO analysis, lead scoring, email sequences, keyword research, competitor messaging, trend analytics |

## Run

```bash
OPENAI_API_KEY=sk-... node tests/human-simulator/run-all.js
```

## What Gets Tested

- **12 AI agents**: Strategist, Research, Content, Finance, PR, Legal, Coder, Technical, Project, Product, SEO, Marketing, Analytics
- **11 tools**: web_search, compute_statistics, code_execute, file_read, file_write, pdf_extract_text, web_fetch, score_lead, create_email_sequence, research_keywords, audit_seo
- **24 end-to-end scenarios** with real OpenAI API calls
- Each test has 60-second timeout
- Results show pass/fail with timing

## Expected Output

```
╔═══════════════════════════════════════════════════════╗
║   JAK SWARM — Human Simulator Test Suite              ║
║   3 Users × 8 Tests = 24 End-to-End Scenarios         ║
╚═══════════════════════════════════════════════════════╝

👩‍💼 SARAH (CEO / Founder)

  ✓ Strategic analysis (12.3s)
  ✓ Competitor research (8.7s)
  ...

👨‍💻 DEV (Senior Engineer)

  ✓ Code generation (9.1s)
  ...

👩‍🎨 MAYA (Marketing Director)

  ✓ LinkedIn post (7.4s)
  ...

╔═══════════════════════════════════════════════════════╗
║                    SCORECARD                          ║
╠═══════════════════════════════════════════════════════╣
║  👩‍💼 Sarah   ████████ 8/8                             ║
║  👨‍💻 Dev     ████████ 8/8                             ║
║  👩‍🎨 Maya    ████████ 8/8                             ║
╠═══════════════════════════════════════════════════════╣
║  Total: 24/24 (100%) | ALL PASSED | 187s              ║
╚═══════════════════════════════════════════════════════╝
```
