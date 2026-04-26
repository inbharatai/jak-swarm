/**
 * control-test.service — runs the per-control test loop for an audit run.
 *
 * For each ControlTest row in PLANNED/TESTING state, this service:
 *   1. Builds a real test procedure (LLM-generated via OpenAIRuntime when key
 *      available, deterministic fallback when not — never fakes a procedure).
 *   2. Loads the evidence universe for that control from
 *      ControlEvidenceMapping + ManualEvidence (real DB reads — never mocks).
 *   3. Asks the LLM to evaluate the evidence against the procedure
 *      (structured output — pass/fail/exception/needs_evidence + rationale +
 *      confidence). When LLM is unavailable, falls back to a deterministic
 *      coverage rule: ≥1 mapping AND ≥1 manual = pass; ≥1 mapping = pass with
 *      lower confidence; 0 evidence = needs_evidence.
 *   4. Persists the result back to ControlTest. When result='fail' or
 *      'exception', creates an AuditException row via the supplied
 *      AuditExceptionService and links its id back into ControlTest.
 *   5. Recomputes the parent AuditRun's coveragePercent + riskSummary from
 *      the latest ControlTest set.
 *   6. Emits control_test_started + control_test_completed lifecycle events
 *      (and exception_found when applicable) on every test.
 *
 * Honesty:
 *   - When OPENAI_API_KEY is unset, the deterministic fallback writes
 *     `rationale = 'evaluated by deterministic coverage rule (no LLM key)'`
 *     so reviewers see the difference. We never claim "LLM-evaluated" when
 *     the LLM did not run.
 *   - Confidence < 0.7 marks the row reviewer_required so the workpaper
 *     gate refuses auto-approval.
 *
 * Tenant isolation enforced at every method.
 */

import type { PrismaClient } from '@jak-swarm/db';
import type { FastifyBaseLogger } from 'fastify';
import { z } from 'zod';
import { AgentContext } from '@jak-swarm/agents';
import { getRuntime, type LLMRuntime, type LegacyAgentBackend } from '@jak-swarm/agents';
import type { AuditExceptionService } from './audit-exception.service.js';
import type { AuditLifecycleEmitter, AuditRunStatus } from './audit-run.service.js';
import { AuditSchemaUnavailableError } from './audit-run.service.js';

// ─── Schema-missing fail-safe ──────────────────────────────────────────

function rethrowIfSchemaMissing(err: unknown): never {
  const code = (err as { code?: string }).code;
  const msg = err instanceof Error ? err.message : String(err);
  if (code === 'P2021' || /relation .* does not exist|table .* does not exist/i.test(msg)) {
    throw new AuditSchemaUnavailableError();
  }
  throw err;
}

// ─── LLM evaluation contract ───────────────────────────────────────────

const TestEvaluationSchema = z.object({
  result: z.enum(['pass', 'fail', 'exception', 'needs_evidence']),
  rationale: z.string().min(20).max(2000),
  confidence: z.number().min(0).max(1),
  recommendedRemediation: z.string().max(1000).optional(),
});

export type TestEvaluation = z.infer<typeof TestEvaluationSchema>;

// ─── Service ───────────────────────────────────────────────────────────

export interface RunSingleTestInput {
  auditRunId: string;
  controlTestId: string;
  tenantId: string;
  triggeredBy: string;
}

export interface RunAllTestsInput {
  auditRunId: string;
  tenantId: string;
  triggeredBy: string;
  /** Limit per batch; defaults to all not-yet-passed tests. */
  limit?: number;
}

export interface RunAllTestsResult {
  totalTests: number;
  ranTests: number;
  passed: number;
  failed: number;
  exceptions: number;
  needsEvidence: number;
  durationMs: number;
}

export class ControlTestService {
  private cachedRuntime: LLMRuntime | null = null;

  constructor(
    private readonly db: PrismaClient,
    private readonly log: FastifyBaseLogger,
    private readonly exceptions: AuditExceptionService,
    private readonly emit: AuditLifecycleEmitter = () => {},
  ) {}

  private getLLM(): LLMRuntime | null {
    if (this.cachedRuntime) return this.cachedRuntime;
    if (!process.env['OPENAI_API_KEY']) return null;
    try {
      // The backend stub is required by LegacyRuntime's signature but is never
      // exercised because OPENAI_API_KEY presence routes to OpenAIRuntime.
      const stubBackend: LegacyAgentBackend = {
        callLLMPublic: () => { throw new Error('[control-test] legacy backend invoked unexpectedly'); },
        executeWithToolsPublic: () => { throw new Error('[control-test] legacy backend invoked unexpectedly'); },
      };
      this.cachedRuntime = getRuntime('CONTROL_TEST_AGENT', stubBackend);
      return this.cachedRuntime;
    } catch (err) {
      this.log.warn({ err: err instanceof Error ? err.message : String(err) }, '[control-test] LLM runtime unavailable — using deterministic evaluation');
      return null;
    }
  }

  /**
   * Run all not-yet-passed tests for an audit run. Idempotent — already-passed
   * tests are skipped. Returns a summary tally.
   */
  async runAll(input: RunAllTestsInput): Promise<RunAllTestsResult> {
    const start = Date.now();
    const tests = await (this.db.controlTest.findMany as unknown as (a: unknown) => Promise<Array<{ id: string; status: string }>>)({
      where: {
        auditRunId: input.auditRunId,
        tenantId: input.tenantId,
        status: { in: ['not_started', 'evidence_received', 'evidence_missing', 'testing', 'reviewer_required'] },
      },
      select: { id: true, status: true },
      orderBy: { createdAt: 'asc' },
      take: input.limit ?? 1000,
    }).catch((err) => rethrowIfSchemaMissing(err));

    const summary: RunAllTestsResult = {
      totalTests: tests.length,
      ranTests: 0,
      passed: 0,
      failed: 0,
      exceptions: 0,
      needsEvidence: 0,
      durationMs: 0,
    };

    // Transition run status PLANNED → TESTING (idempotent if already TESTING)
    await this.transitionRunIfNeeded(input.auditRunId, input.tenantId, 'TESTING');

    for (const t of tests) {
      try {
        const result = await this.runSingle({
          auditRunId: input.auditRunId,
          controlTestId: t.id,
          tenantId: input.tenantId,
          triggeredBy: input.triggeredBy,
        });
        summary.ranTests++;
        if (result === 'pass') summary.passed++;
        else if (result === 'fail') summary.failed++;
        else if (result === 'exception') summary.exceptions++;
        else if (result === 'needs_evidence') summary.needsEvidence++;
      } catch (err) {
        this.log.error({ controlTestId: t.id, err: err instanceof Error ? err.message : String(err) }, '[control-test] runSingle failed');
      }
    }

    // Recompute coverage on the run + transition to REVIEWING when all tests are terminal
    const allTerminal = await this.refreshRunCoverage(input.auditRunId, input.tenantId);
    if (allTerminal) {
      await this.transitionRunIfNeeded(input.auditRunId, input.tenantId, 'REVIEWING');
    }

    summary.durationMs = Date.now() - start;
    return summary;
  }

  /**
   * Run one test. Returns the terminal result so callers can tally.
   */
  async runSingle(input: RunSingleTestInput): Promise<'pass' | 'fail' | 'exception' | 'needs_evidence'> {
    const test = await (this.db.controlTest.findFirst as unknown as (a: unknown) => Promise<{
      id: string; tenantId: string; auditRunId: string; controlId: string; controlCode: string; controlTitle: string; testProcedure: string | null;
    } | null>)({
      where: { id: input.controlTestId, tenantId: input.tenantId, auditRunId: input.auditRunId },
    }).catch((err) => rethrowIfSchemaMissing(err));
    if (!test) throw new Error(`ControlTest ${input.controlTestId} not found in audit run ${input.auditRunId}`);

    // Fetch the underlying control + framework for richer evaluation context
    const control = await this.db.complianceControl.findUnique({
      where: { id: test.controlId },
      include: { framework: { select: { slug: true, name: true } } },
    });
    if (!control) {
      throw new Error(`Control ${test.controlId} no longer exists in catalog (test was orphaned)`);
    }

    // Mark test as started + emit started event
    await this.db.controlTest.update({
      where: { id: test.id },
      data: { status: 'testing', startedAt: new Date() },
    });
    this.emit({
      type: 'control_test_started',
      auditRunId: test.auditRunId,
      agentRole: 'CONTROL_TEST_AGENT',
      timestamp: new Date().toISOString(),
      details: { controlId: test.controlId, controlCode: test.controlCode },
    });

    // Build / load test procedure
    const procedure = test.testProcedure ?? await this.buildTestProcedure(control);

    // Load evidence universe for this control
    const [autoMappings, manualEvidence] = await Promise.all([
      this.db.controlEvidenceMapping.findMany({
        where: { tenantId: input.tenantId, controlId: test.controlId },
        orderBy: { evidenceAt: 'desc' },
        take: 50, // cap so the LLM context stays bounded
      }),
      this.db.manualEvidence.findMany({
        where: { tenantId: input.tenantId, controlId: test.controlId, deletedAt: null },
        orderBy: { evidenceAt: 'desc' },
        take: 25,
      }),
    ]);

    const evidenceConsidered = {
      autoMappingCount: autoMappings.length,
      manualEvidenceCount: manualEvidence.length,
      autoMappingIds: autoMappings.map((m) => ({ id: m.id, type: m.evidenceType, evidenceId: m.evidenceId, at: m.evidenceAt.toISOString() })),
      manualEvidenceIds: manualEvidence.map((m) => ({ id: m.id, title: m.title })),
    };

    // Evaluate
    const evaluation = await this.evaluateWithLLM({
      procedure,
      control: { code: control.code, title: control.title, description: control.description, framework: control.framework.name },
      evidence: { autoMappings, manualEvidence },
      tenantId: input.tenantId,
      auditRunId: input.auditRunId,
    });

    // Status mapping
    const status = evaluation.result === 'pass' ? (evaluation.confidence < 0.7 ? 'reviewer_required' : 'passed')
      : evaluation.result === 'fail' ? 'failed'
      : evaluation.result === 'exception' ? 'exception_found'
      : 'evidence_missing';

    // Persist result
    let exceptionId: string | undefined;
    if (evaluation.result === 'fail' || evaluation.result === 'exception') {
      const createdException = await this.exceptions.createFromTest({
        tenantId: input.tenantId,
        auditRunId: test.auditRunId,
        controlTestId: test.id,
        controlId: test.controlId,
        controlCode: test.controlCode,
        severity: this.severityFromControl(control),
        description: `${control.code} ${evaluation.result === 'fail' ? 'failed' : 'raised an exception'}: ${evaluation.rationale.slice(0, 280)}`,
        rationale: evaluation.rationale,
        recommendedRemediation: evaluation.recommendedRemediation,
      });
      exceptionId = createdException.id;
    }

    await this.db.controlTest.update({
      where: { id: test.id },
      data: {
        status,
        result: evaluation.result,
        rationale: evaluation.rationale,
        confidence: evaluation.confidence,
        evidenceConsidered: evidenceConsidered as object,
        evidenceCount: autoMappings.length + manualEvidence.length,
        ...(exceptionId ? { exceptionId } : {}),
        ...(test.testProcedure ? {} : { testProcedure: procedure }),
        completedAt: new Date(),
      },
    });

    // Emit completed event
    this.emit({
      type: 'control_test_completed',
      auditRunId: test.auditRunId,
      agentRole: 'CONTROL_TEST_AGENT',
      timestamp: new Date().toISOString(),
      details: {
        controlId: test.controlId,
        controlCode: test.controlCode,
        result: evaluation.result,
        confidence: evaluation.confidence,
        evidenceCount: autoMappings.length + manualEvidence.length,
      },
    });

    if (exceptionId) {
      this.emit({
        type: 'exception_found',
        auditRunId: test.auditRunId,
        agentRole: 'EXCEPTION_FINDER',
        timestamp: new Date().toISOString(),
        details: { controlCode: test.controlCode, exceptionId, severity: this.severityFromControl(control) },
      });
    }

    return evaluation.result;
  }

  /**
   * Build a test procedure from a control description. Uses LLM if available,
   * else a deterministic templated procedure derived from the control's
   * description.
   */
  private async buildTestProcedure(control: { code: string; title: string; description: string; framework: { name: string } }): Promise<string> {
    const llm = this.getLLM();
    if (!llm) {
      return [
        `Test procedure for ${control.code} — ${control.title} (${control.framework.name})`,
        `(deterministic procedure — no LLM key configured)`,
        '',
        '1. Review the control description below and identify the design + operating expectations.',
        '2. Inspect each piece of evidence mapped to this control. Confirm the evidence',
        '   covers the in-scope period and is from an authoritative source (audit log,',
        '   approval record, signed artifact, or curated manual evidence).',
        '3. Sample at least one piece of evidence per quarter of the audit period.',
        '4. Confirm the evidence supports the design intent of the control.',
        '5. Identify any gaps — periods with no evidence, missing approvals, or unsigned artefacts.',
        '6. Decide pass / fail / exception:',
        '   - pass: evidence covers the period and demonstrates the control operates as designed.',
        '   - fail: design or operating gap that breaks the control intent.',
        '   - exception: control is largely operating but has a discrete deviation.',
        '   - needs_evidence: insufficient evidence to make a determination.',
        '',
        `Control description: ${control.description}`,
      ].join('\n');
    }

    try {
      const ctx = new AgentContext({ tenantId: 'system', userId: 'control-test-builder', workflowId: 'audit-control-test' });
      const resp = await llm.respond(
        [
          {
            role: 'system',
            content: `You are an experienced ${control.framework.name} auditor. Write a concrete, audit-grade test procedure (5-8 numbered steps) that an associate auditor can execute. Reference the specific control's design intent. Plain prose, no markdown headers, no extra preamble.`,
          },
          {
            role: 'user',
            content: `Control ${control.code} — ${control.title}\n\nDescription:\n${control.description}\n\nWrite the test procedure now.`,
          },
        ],
        { temperature: 0.1, maxTokens: 700 },
        ctx,
      );
      const text = resp.choices?.[0]?.message?.content?.trim();
      if (text && text.length >= 50) return text;
    } catch (err) {
      this.log.warn({ controlCode: control.code, err: err instanceof Error ? err.message : String(err) }, '[control-test] LLM procedure build failed — falling back to template');
    }

    return this.buildTestProcedure.call({ getLLM: () => null }, control);
  }

  /**
   * Evaluate evidence against the procedure. LLM when available, deterministic
   * coverage rule when not.
   */
  private async evaluateWithLLM(input: {
    procedure: string;
    control: { code: string; title: string; description: string; framework: string };
    evidence: { autoMappings: Array<{ evidenceType: string; evidenceId: string; evidenceAt: Date }>; manualEvidence: Array<{ title: string; description: string }> };
    tenantId: string;
    auditRunId: string;
  }): Promise<TestEvaluation> {
    const llm = this.getLLM();
    const totalEvidence = input.evidence.autoMappings.length + input.evidence.manualEvidence.length;

    if (!llm) {
      // Deterministic coverage rule — honest fallback.
      if (totalEvidence === 0) {
        return {
          result: 'needs_evidence',
          rationale: 'Deterministic coverage rule (no LLM key configured): no auto-mapped evidence and no manual evidence rows exist for this control in the audit period.',
          confidence: 1.0,
        };
      }
      const hasManual = input.evidence.manualEvidence.length > 0;
      const hasAuto = input.evidence.autoMappings.length > 0;
      const result: TestEvaluation['result'] = hasManual && hasAuto ? 'pass' : 'pass';
      const confidence = hasManual && hasAuto ? 0.65 : 0.4;
      return {
        result,
        rationale: `Deterministic coverage rule (no LLM key configured): ${input.evidence.autoMappings.length} auto-mapped evidence row(s) + ${input.evidence.manualEvidence.length} manual evidence row(s). Marked as needing reviewer override because LLM judgment was unavailable.`,
        confidence,
      };
    }

    try {
      const ctx = new AgentContext({ tenantId: input.tenantId, userId: 'control-test-evaluator', workflowId: input.auditRunId });
      const evidenceSummary = [
        `Auto-mapped evidence (${input.evidence.autoMappings.length} row(s)):`,
        ...input.evidence.autoMappings.slice(0, 20).map((m, i) => `  ${i + 1}. ${m.evidenceType} ${m.evidenceId} @ ${m.evidenceAt.toISOString()}`),
        '',
        `Manual evidence (${input.evidence.manualEvidence.length} row(s)):`,
        ...input.evidence.manualEvidence.slice(0, 20).map((m, i) => `  ${i + 1}. "${m.title}" — ${m.description.slice(0, 120)}`),
      ].join('\n');

      const evaluation = await llm.respondStructured(
        [
          {
            role: 'system',
            content: `You are a senior ${input.control.framework} auditor evaluating a single control. You MUST return strict JSON matching the schema. Use the test procedure to drive your judgment. Use the evidence list as the only data available — do not invent evidence. If the evidence is insufficient, return result='needs_evidence'. If the evidence covers the period AND demonstrates the control operates as designed, return result='pass'. If there is a clear gap, return result='fail'. If there is a discrete deviation but the control mostly works, return result='exception'.`,
          },
          {
            role: 'user',
            content: `Control: ${input.control.code} — ${input.control.title}\n\nDescription:\n${input.control.description}\n\nTest procedure:\n${input.procedure}\n\nEvidence:\n${evidenceSummary}\n\nReturn JSON: { result, rationale (>=20 chars, <=2000 chars), confidence (0..1), recommendedRemediation (only when result is 'fail' or 'exception') }`,
          },
        ],
        TestEvaluationSchema,
        { temperature: 0.0, maxTokens: 800, schemaName: 'control_test_evaluation' },
        ctx,
      );
      return evaluation;
    } catch (err) {
      this.log.warn({ controlCode: input.control.code, err: err instanceof Error ? err.message : String(err) }, '[control-test] LLM evaluation failed — falling back to deterministic rule');
      // Fallback: deterministic rule, marked low-confidence so reviewer is forced.
      if (totalEvidence === 0) {
        return {
          result: 'needs_evidence',
          rationale: `LLM evaluation failed (${err instanceof Error ? err.message : String(err)}); deterministic fallback: 0 evidence rows.`,
          confidence: 1.0,
        };
      }
      return {
        result: 'pass',
        rationale: `LLM evaluation failed (${err instanceof Error ? err.message : String(err)}); deterministic fallback: ${totalEvidence} evidence row(s) present, marked low-confidence so reviewer override is required.`,
        confidence: 0.3,
      };
    }
  }

  private severityFromControl(control: { code: string; description: string }): 'low' | 'medium' | 'high' | 'critical' {
    const desc = `${control.code} ${control.description}`.toLowerCase();
    if (/\b(encryption|auth(entication)?|mfa|pii|phi|payment|kms|secret|key management)\b/.test(desc)) return 'high';
    if (/\b(monitor|alert|review|approval)\b/.test(desc)) return 'medium';
    return 'medium';
  }

  /**
   * Recompute and persist coveragePercent + riskSummary on an audit run.
   * Returns true when every control test is in a terminal state (passed,
   * failed, exception_found, evidence_missing, approved, rejected).
   */
  async refreshRunCoverage(auditRunId: string, tenantId: string): Promise<boolean> {
    const tests = await (this.db.controlTest.findMany as unknown as (a: unknown) => Promise<Array<{ status: string; result: string | null }>>)({
      where: { auditRunId, tenantId },
      select: { status: true, result: true },
    });
    if (tests.length === 0) return false;

    const passed = tests.filter((t) => t.result === 'pass').length;
    const fails = tests.filter((t) => t.result === 'fail').length;
    const excs = tests.filter((t) => t.result === 'exception').length;
    const coverage = (passed / tests.length) * 100;
    const riskSummary = fails + excs >= Math.ceil(tests.length * 0.2) ? 'critical'
      : fails > 0 ? 'high'
      : excs > 0 ? 'medium'
      : 'low';

    await this.db.auditRun.update({
      where: { id: auditRunId },
      data: { coveragePercent: Math.round(coverage * 10) / 10, riskSummary },
    });

    const terminal = new Set(['passed', 'failed', 'exception_found', 'evidence_missing', 'approved', 'rejected', 'remediated']);
    return tests.every((t) => terminal.has(t.status));
  }

  private async transitionRunIfNeeded(auditRunId: string, tenantId: string, to: AuditRunStatus): Promise<void> {
    const cur = await (this.db.auditRun.findFirst as unknown as (a: unknown) => Promise<{ status: AuditRunStatus } | null>)({
      where: { id: auditRunId, tenantId },
      select: { status: true },
    });
    if (!cur) return;
    if (cur.status === to) return;
    // Direct update — we trust the lifecycle logic in AuditRunService for
    // user-initiated transitions; runAll just nudges TESTING/REVIEWING.
    const validForward = (cur.status === 'PLANNED' && to === 'TESTING')
      || (cur.status === 'MAPPING' && to === 'TESTING')
      || (cur.status === 'TESTING' && to === 'REVIEWING')
      || (cur.status === 'REVIEWING' && to === 'TESTING');
    if (!validForward) return;
    await this.db.auditRun.update({ where: { id: auditRunId }, data: { status: to } });
  }
}
