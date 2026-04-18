/**
 * scripts/bench-vibe-coder.ts
 *
 * Benchmark harness for the end-to-end Vibe Coder workflow.
 *
 * Runs each spec in scripts/_bench/vibe-coder-specs.json through the real
 * `runVibeCoderWorkflow` function and measures:
 *   - time-to-first-build-pass (ms)
 *   - total duration incl. debug retries (ms)
 *   - debug iterations (0 = passed first try)
 *   - final status (completed / failed / needs_user_input)
 *   - files generated vs minFiles required
 *   - required files present: y/n
 *   - mustNotHavePhrases violated: y/n (detects truncation/placeholder leaks)
 *
 * Emits docs/_generated/vibe-coder-bench.json with a structured report and
 * prints a compact summary table. Exits 0 regardless of spec-level failures
 * — the harness reports, it doesn't gate CI.
 *
 * Run: `pnpm bench:vibe-coder`
 * Skips deploy (deployAfterBuild: false) so no Vercel cost. The heuristic +
 * static build checkers run in-loop; real agents consume ANTHROPIC_API_KEY
 * or OPENAI_API_KEY.
 *
 * Without LLM keys, the harness prints a clear skip message and exits 0
 * instead of hanging.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  runVibeCoderWorkflow,
  staticBuildChecker,
  heuristicBuildChecker,
  DockerBuildChecker,
  type BuildChecker,
  type BuildResult,
  type VibeCoderResult,
} from '../packages/swarm/src/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const outDir = resolve(repoRoot, 'docs/_generated');
const outFile = resolve(outDir, 'vibe-coder-bench.json');

interface BenchSpec {
  id: string;
  difficulty: 'easy' | 'medium' | 'hard';
  description: string;
  framework?: string;
  features?: string[];
  requiredFiles?: string[];
  requiredApiPatterns?: string[];
  minFiles?: number;
  mustNotHavePhrases?: string[];
}

interface SpecReport {
  id: string;
  difficulty: string;
  status: 'completed' | 'failed' | 'needs_user_input' | 'skipped';
  durationMs: number;
  debugAttempts: number;
  filesGenerated: number;
  minFilesMet: boolean;
  requiredFilesPresent: boolean;
  missingRequiredFiles: string[];
  phrasesViolated: string[];
  apiPatternsPresent: boolean;
  missingApiPatterns: string[];
  error?: string;
  userQuestion?: string;
}

const specsPath = resolve(repoRoot, 'scripts/_bench/vibe-coder-specs.json');
const specsFile = JSON.parse(readFileSync(specsPath, 'utf8')) as { specs: BenchSpec[] };

function hasLLMKey(): boolean {
  return Boolean(process.env['ANTHROPIC_API_KEY']) || Boolean(process.env['OPENAI_API_KEY']);
}

/**
 * Compose the heuristic, static, and (optionally) docker build checkers.
 * Layers run in order of cost and stop on the first real failure — the
 * debugger only sees the shallowest signal it can act on.
 *
 *   1. heuristic     — ~1ms, catches truncation / empty files / "Not implemented"
 *   2. static (tsc)  — sub-second, catches real syntax + type errors in-memory
 *   3. docker build  — 30-120s, catches Next.js / runtime / missing-dep errors
 *
 * The docker layer is enabled only when --docker is passed AND Docker is
 * running on the host. When Docker is unreachable, it returns `{ok:true, skipped:true}`
 * and the composition treats that as a pass-through — we never silently fail
 * a spec because the infra wasn't there.
 */
function composeBuildChecker(enableDocker: boolean): BuildChecker {
  const docker = enableDocker ? new DockerBuildChecker({ framework: 'nextjs' }) : null;
  return {
    async check(files): Promise<BuildResult> {
      const heur = await heuristicBuildChecker.check(files);
      if (!heur.ok) return heur;
      const stat = await staticBuildChecker.check(files);
      if (!stat.ok) return stat;
      if (docker) return docker.check(files);
      return stat;
    },
  };
}

async function runOne(spec: BenchSpec, checker: BuildChecker): Promise<SpecReport> {
  const started = Date.now();
  let result: VibeCoderResult;
  try {
    result = await runVibeCoderWorkflow({
      workflowId: `bench-${spec.id}-${Date.now().toString(36)}`,
      tenantId: 'bench',
      userId: 'bench',
      description: spec.description,
      framework: spec.framework ?? 'nextjs',
      features: spec.features,
      projectName: spec.id,
      subscriptionTier: 'paid', // run with full chain — this is measurement
      deployAfterBuild: false,
      maxDebugRetries: 3,
      buildChecker: checker,
    });
  } catch (err) {
    return {
      id: spec.id,
      difficulty: spec.difficulty,
      status: 'failed',
      durationMs: Date.now() - started,
      debugAttempts: 0,
      filesGenerated: 0,
      minFilesMet: false,
      requiredFilesPresent: false,
      missingRequiredFiles: spec.requiredFiles ?? [],
      phrasesViolated: [],
      apiPatternsPresent: false,
      missingApiPatterns: spec.requiredApiPatterns ?? [],
      error: err instanceof Error ? err.message : String(err),
    };
  }

  // Required files check
  const filePaths = new Set(result.files.map((f) => f.path));
  const missingRequiredFiles = (spec.requiredFiles ?? []).filter((req) => !filePaths.has(req));

  // Truncation / placeholder phrase check
  const allContent = result.files.map((f) => f.content).join('\n');
  const phrasesViolated = (spec.mustNotHavePhrases ?? []).filter((p) =>
    allContent.toLowerCase().includes(p.toLowerCase()),
  );

  // API pattern check (string match on file content)
  const missingApiPatterns = (spec.requiredApiPatterns ?? []).filter(
    (p) => !result.files.some((f) => f.content.includes(p) || f.path.includes(p)),
  );

  return {
    id: spec.id,
    difficulty: spec.difficulty,
    status: result.status,
    durationMs: result.durationMs,
    debugAttempts: result.debugAttempts,
    filesGenerated: result.files.length,
    minFilesMet: result.files.length >= (spec.minFiles ?? 1),
    requiredFilesPresent: missingRequiredFiles.length === 0,
    missingRequiredFiles,
    phrasesViolated,
    apiPatternsPresent: missingApiPatterns.length === 0,
    missingApiPatterns,
    error: result.error,
    userQuestion: result.userQuestion,
  };
}

function summarizeScore(report: SpecReport): 'pass' | 'partial' | 'fail' {
  if (report.status === 'completed' && report.minFilesMet && report.requiredFilesPresent && report.phrasesViolated.length === 0 && report.apiPatternsPresent) {
    return 'pass';
  }
  if (report.status === 'failed' || report.status === 'skipped') return 'fail';
  return 'partial';
}

async function main(): Promise<void> {
  /* eslint-disable no-console */
  if (!hasLLMKey()) {
    console.error('[bench-vibe-coder] Skipping — no ANTHROPIC_API_KEY or OPENAI_API_KEY set.');
    console.error('[bench-vibe-coder] Provision at least one LLM key to benchmark real agent output.');
    process.exit(0);
  }

  const args = process.argv.slice(2);
  const enableDocker = args.includes('--docker');
  const checker = composeBuildChecker(enableDocker);
  if (enableDocker) {
    console.log('[bench-vibe-coder] Docker build checker enabled — expect 30-120s per spec when the build runs.');
  } else {
    console.log('[bench-vibe-coder] Docker build checker disabled (pass --docker to enable real builds).');
  }

  console.log(`[bench-vibe-coder] Running ${specsFile.specs.length} specs…\n`);
  const reports: SpecReport[] = [];
  for (const spec of specsFile.specs) {
    console.log(`  [${spec.difficulty.padEnd(6)}] ${spec.id} — running…`);
    const r = await runOne(spec, checker);
    reports.push(r);
    const score = summarizeScore(r);
    const emoji = score === 'pass' ? '✓' : score === 'partial' ? '~' : '✗';
    console.log(
      `  ${emoji} ${spec.id}: status=${r.status} files=${r.filesGenerated} debug=${r.debugAttempts} time=${r.durationMs}ms`,
    );
  }

  mkdirSync(outDir, { recursive: true });
  const summary = {
    generatedAt: new Date().toISOString(),
    dockerBuildCheckerEnabled: enableDocker,
    totalSpecs: reports.length,
    pass: reports.filter((r) => summarizeScore(r) === 'pass').length,
    partial: reports.filter((r) => summarizeScore(r) === 'partial').length,
    fail: reports.filter((r) => summarizeScore(r) === 'fail').length,
    byDifficulty: {
      easy: reports.filter((r) => r.difficulty === 'easy'),
      medium: reports.filter((r) => r.difficulty === 'medium'),
      hard: reports.filter((r) => r.difficulty === 'hard'),
    },
    avgDebugAttempts:
      reports.reduce((acc, r) => acc + r.debugAttempts, 0) / Math.max(1, reports.length),
    avgDurationMs:
      reports.reduce((acc, r) => acc + r.durationMs, 0) / Math.max(1, reports.length),
    firstTryBuildPassRate:
      reports.filter((r) => r.status === 'completed' && r.debugAttempts === 0).length /
      Math.max(1, reports.length),
    reports,
  };

  writeFileSync(outFile, JSON.stringify(summary, null, 2) + '\n');

  console.log('\n[bench-vibe-coder] Summary:');
  console.log(`  total:               ${summary.totalSpecs}`);
  console.log(`  pass:                ${summary.pass}`);
  console.log(`  partial:             ${summary.partial}`);
  console.log(`  fail:                ${summary.fail}`);
  console.log(`  avg debug attempts:  ${summary.avgDebugAttempts.toFixed(2)}`);
  console.log(`  avg duration:        ${(summary.avgDurationMs / 1000).toFixed(1)}s`);
  console.log(`  first-try pass rate: ${(summary.firstTryBuildPassRate * 100).toFixed(1)}%`);
  console.log(`\n[bench-vibe-coder] Report: ${outFile}`);
  /* eslint-enable no-console */
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[bench-vibe-coder] Fatal:', err instanceof Error ? err.message : err);
  process.exit(1);
});
