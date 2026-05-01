# Human QA Report — landing

Generated: 2026-05-01T14:23:07.808Z
Screenshots: `C:\Users\reetu\Desktop\JAK\jak-swarm\qa\human-qa-reports\a-z-audit\landing\shots` (11 captured)

## Severity summary

| Severity | Count |
|---|---|
| CRITICAL | 0 |
| HIGH | 0 |
| MEDIUM | 0 |
| LOW | 0 |
| INFO | 5 |

## Status summary

| Status | Count |
|---|---|
| working | 5 |
| partially-working | 0 |
| present-but-not-wired | 0 |
| not-implemented | 0 |
| observation | 0 |

## Findings

| # | Severity | Status | Category | Section | Expected | Actual | Suggested fix |
|---|---|---|---|---|---|---|---|
| 1 | INFO | working | trust | trust-signals | pricing link visible | present | (no action — trust signal present) |
| 2 | INFO | working | trust | trust-signals | GitHub link visible | present | (no action — trust signal present) |
| 3 | INFO | working | trust | trust-signals | contact / email link visible | present | (no action — trust signal present) |
| 4 | INFO | working | trust | trust-signals | security / privacy link visible | present | (no action — trust signal present) |
| 5 | INFO | working | trust | trust-signals | audit / compliance link visible | present | (no action — trust signal present) |

## Disclosure

This report uses the Human QA Tester framework: observe-first, slow-interact, claim-vs-behaviour, four-state status. Status meanings: **working** = observable + complete; **partially-working** = observable but with caveats; **present-but-not-wired** = UI rendered but action does nothing real; **not-implemented** = claimed but absent; **observation** = INFO only. Absence of findings does NOT mean a category was tested deeply — it means the explicit checks the test author wired returned clean.