/**
 * VibeCodingExecutionService
 *
 * The orchestration engine for vibe coding. Chains agents together:
 * 1. [Optional] ScreenshotToCode → analyze image
 * 2. AppArchitect → create architecture + file tree
 * 3. AppGenerator → generate code files (batched)
 * 4. Save to DB + create version snapshot
 * 5. Sync to sandbox → install deps → build
 * 6. If build fails → AppDebugger (max 3 retries)
 * 7. Start dev server → return preview URL
 *
 * Emits SSE events at every stage for real-time UI updates.
 */

import { EventEmitter } from 'node:events';
import type { PrismaClient } from '@jak-swarm/db';
import type { FastifyBaseLogger } from 'fastify';
import { AgentContext } from '@jak-swarm/agents';
import {
  AppArchitectAgent,
  AppGeneratorAgent,
  AppDebuggerAgent,
  ScreenshotToCodeAgent,
} from '@jak-swarm/agents';
import { ProjectService } from './project.service.js';
import { getTemplate, generatePackageJson } from '@jak-swarm/tools/adapters/sandbox/template-registry.js';
import type { SandboxAdapter } from '@jak-swarm/tools/adapters/sandbox/sandbox.interface.js';

const MAX_DEBUG_RETRIES = 3;

export interface GenerateParams {
  projectId: string;
  tenantId: string;
  userId: string;
  description: string;
  framework?: string;
  templateId?: string;
  imageBase64?: string;
}

export interface IterateParams {
  projectId: string;
  tenantId: string;
  userId: string;
  message: string;
  imageBase64?: string;
}

export class VibeCodingExecutionService extends EventEmitter {
  private readonly projectService: ProjectService;

  constructor(
    private readonly db: PrismaClient,
    private readonly log: FastifyBaseLogger,
    private readonly sandbox?: SandboxAdapter,
  ) {
    super();
    this.projectService = new ProjectService(db, log);
  }

  /**
   * Emit a typed SSE event for a project.
   */
  private emitProjectEvent(projectId: string, type: string, data?: Record<string, unknown>) {
    this.emit(`project:${projectId}`, { type, projectId, timestamp: new Date().toISOString(), ...data });
  }

  /**
   * Generate a full app from scratch.
   */
  async generateProject(params: GenerateParams): Promise<void> {
    const { projectId, tenantId, userId, description, framework, templateId, imageBase64 } = params;
    const runId = `vibe-gen-${projectId}-${Date.now()}`;

    this.log.info({ projectId, tenantId, runId }, 'Starting vibe coding generation');

    try {
      await this.projectService.updateProjectStatus(projectId, 'GENERATING');
      this.emitProjectEvent(projectId, 'generation_started', { description });

      const context = new AgentContext({
        traceId: runId,
        runId,
        tenantId,
        userId,
        workflowId: runId,
        industry: 'TECHNOLOGY',
      });

      // ─── Step 1: Screenshot Analysis (optional) ────────────────────
      let imageAnalysis: string | undefined;
      if (imageBase64) {
        this.emitProjectEvent(projectId, 'screenshot_analysis_started');
        const screenshotAgent = new ScreenshotToCodeAgent();
        const ssResult = await screenshotAgent.execute(
          { action: 'ANALYZE_SCREENSHOT', imageBase64, targetFramework: framework ?? 'nextjs' },
          context,
        );
        imageAnalysis = ssResult.layoutAnalysis + '\n' + ssResult.overallDescription;
        this.emitProjectEvent(projectId, 'screenshot_analysis_completed', {
          componentCount: ssResult.components.length,
        });
      }

      // ─── Step 2: Architecture ──────────────────────────────────────
      this.emitProjectEvent(projectId, 'architect_started');
      const architectAgent = new AppArchitectAgent();
      const architecture = await architectAgent.execute(
        {
          action: 'ARCHITECT_APP',
          description,
          framework: framework ?? 'nextjs',
          imageAnalysis,
        },
        context,
      );
      this.emitProjectEvent(projectId, 'architect_completed', {
        fileCount: architecture.fileTree.length,
        modelCount: architecture.dataModels.length,
        confidence: architecture.confidence,
      });

      if (architecture.fileTree.length === 0) {
        throw new Error('Architect produced empty file tree — cannot generate code');
      }

      // ─── Step 3: Load template + generate files ────────────────────
      this.emitProjectEvent(projectId, 'generation_files_started', { totalFiles: architecture.fileTree.length });

      // Start with template scaffold if available
      const template = getTemplate(templateId ?? framework ?? 'nextjs-app');
      const allFiles: Array<{ path: string; content: string; language: string }> = [];

      if (template) {
        // Add template files
        for (const tf of template.files) {
          allFiles.push({ path: tf.path, content: tf.content, language: tf.path.split('.').pop() ?? 'text' });
        }
        // Add package.json from template
        const pkgJson = generatePackageJson(template, {
          name: (await this.projectService.getProject(tenantId, projectId))?.name ?? 'jak-app',
          description,
          extraDeps: architecture.dependencies,
          extraDevDeps: architecture.devDependencies,
        });
        allFiles.push({ path: 'package.json', content: pkgJson, language: 'json' });
      }

      // Generate non-template files via AppGenerator
      const generatorAgent = new AppGeneratorAgent();
      const filesToGenerate = architecture.fileTree.filter(
        f => !allFiles.some(af => af.path === f.path),
      );

      // Batch generation: process in groups of 3 to stay within context limits
      const batchSize = 3;
      for (let i = 0; i < filesToGenerate.length; i += batchSize) {
        const batch = filesToGenerate.slice(i, i + batchSize);
        const genResult = await generatorAgent.execute(
          {
            action: 'GENERATE_BATCH',
            architecture: architecture.architecture,
            targetFiles: batch,
            framework: framework ?? 'nextjs',
            dependencies: architecture.dependencies,
            dataModels: architecture.dataModels,
            apiEndpoints: architecture.apiEndpoints,
            componentHierarchy: architecture.componentHierarchy,
            existingFiles: allFiles.map(f => ({ path: f.path, content: f.content })),
          },
          context,
        );

        for (const file of genResult.files) {
          const existing = allFiles.findIndex(f => f.path === file.path);
          if (existing >= 0) {
            allFiles[existing] = file;
          } else {
            allFiles.push(file);
          }
        }

        this.emitProjectEvent(projectId, 'file_generated', {
          batchIndex: Math.floor(i / batchSize) + 1,
          totalBatches: Math.ceil(filesToGenerate.length / batchSize),
          filesInBatch: genResult.files.map(f => f.path),
        });
      }

      // ─── Step 4: Save to DB + create version ──────────────────────
      await this.projectService.saveFiles(projectId, allFiles);
      await this.projectService.createVersion(projectId, `Initial generation: ${description.slice(0, 100)}`, 'agent', runId);
      await this.projectService.addConversation(projectId, 'assistant', `Generated ${allFiles.length} files based on your description.`, {
        fileCount: allFiles.length,
        architecture: architecture.architecture,
      });

      this.emitProjectEvent(projectId, 'files_saved', { fileCount: allFiles.length });

      // ─── Step 5: Sandbox build (if sandbox available) ──────────────
      if (this.sandbox?.isAvailable()) {
        await this.buildInSandbox(projectId, allFiles, context);
      } else {
        // No sandbox — mark as READY without build verification
        this.log.warn({ projectId }, 'No sandbox available — skipping build verification');
        await this.projectService.updateProjectStatus(projectId, 'READY');
        this.emitProjectEvent(projectId, 'generation_completed', {
          status: 'READY',
          fileCount: allFiles.length,
          message: 'Files generated successfully. No sandbox available for build verification.',
        });
      }

      // Track cost
      const traces = context.getTraces();
      const totalCost = traces.reduce((sum, t) => sum + (t.costUsd ?? 0), 0);
      await this.db.project.update({
        where: { id: projectId },
        data: { totalCostUsd: { increment: totalCost } },
      });

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.log.error({ projectId, error: errorMsg }, 'Vibe coding generation failed');
      await this.projectService.updateProjectStatus(projectId, 'FAILED');
      await this.projectService.addConversation(projectId, 'system', `Generation failed: ${errorMsg}`);
      this.emitProjectEvent(projectId, 'generation_failed', { error: errorMsg });
    }
  }

  /**
   * Iterative refinement — modify existing project based on user message.
   */
  async iterateProject(params: IterateParams): Promise<void> {
    const { projectId, tenantId, userId, message } = params;
    const runId = `vibe-iter-${projectId}-${Date.now()}`;

    this.log.info({ projectId, tenantId, runId }, 'Starting vibe coding iteration');

    try {
      await this.projectService.updateProjectStatus(projectId, 'GENERATING');
      this.emitProjectEvent(projectId, 'iteration_started', { message });

      const context = new AgentContext({
        traceId: runId,
        runId,
        tenantId,
        userId,
        workflowId: runId,
        industry: 'TECHNOLOGY',
      });

      // Get existing files
      const existingFiles = await this.projectService.getFiles(projectId);
      const conversations = await this.projectService.getConversations(projectId);

      // ─── Step 1: Plan changes ─────────────────────────────────────
      this.emitProjectEvent(projectId, 'architect_started');
      const architectAgent = new AppArchitectAgent();
      const changePlan = await architectAgent.execute(
        {
          action: 'PLAN_CHANGES',
          changeRequest: message,
          existingFiles: existingFiles.map(f => ({ path: f.path, content: f.content })),
          conversationHistory: conversations.slice(-10).map(c => ({ role: c.role, content: c.content })),
        },
        context,
      );
      this.emitProjectEvent(projectId, 'architect_completed', {
        filesToModify: changePlan.filesToModify,
      });

      // ─── Step 2: Modify affected files ────────────────────────────
      const filesToModify = changePlan.filesToModify ?? [];
      if (filesToModify.length === 0) {
        await this.projectService.addConversation(projectId, 'assistant', 'No file changes needed for this request.');
        await this.projectService.updateProjectStatus(projectId, 'READY');
        this.emitProjectEvent(projectId, 'iteration_completed', { changes: 0 });
        return;
      }

      const generatorAgent = new AppGeneratorAgent();
      const affectedFiles = existingFiles.filter(f => filesToModify.includes(f.path));

      const genResult = await generatorAgent.execute(
        {
          action: 'MODIFY_FILE',
          modifyInstructions: message,
          existingFiles: affectedFiles.map(f => ({ path: f.path, content: f.content })),
          architecture: changePlan.architecture,
          framework: 'nextjs',
        },
        context,
      );

      this.emitProjectEvent(projectId, 'files_modified', {
        modifiedCount: genResult.files.length,
        files: genResult.files.map(f => f.path),
      });

      // ─── Step 3: Save + version ───────────────────────────────────
      if (genResult.files.length > 0) {
        await this.projectService.saveFiles(projectId, genResult.files);
        await this.projectService.createVersion(projectId, `Iteration: ${message.slice(0, 100)}`, 'agent', runId);
      }

      await this.projectService.addConversation(projectId, 'assistant', `Modified ${genResult.files.length} files: ${genResult.files.map(f => f.path).join(', ')}`, {
        modifiedFiles: genResult.files.map(f => f.path),
      });

      // ─── Step 4: Rebuild in sandbox ───────────────────────────────
      if (this.sandbox?.isAvailable()) {
        const allFiles = await this.projectService.getFiles(projectId);
        await this.buildInSandbox(projectId, allFiles.map(f => ({ path: f.path, content: f.content, language: f.language ?? 'text' })), context);
      } else {
        await this.projectService.updateProjectStatus(projectId, 'READY');
        this.emitProjectEvent(projectId, 'iteration_completed', {
          status: 'READY',
          changes: genResult.files.length,
        });
      }

      // Track cost
      const traces = context.getTraces();
      const totalCost = traces.reduce((sum, t) => sum + (t.costUsd ?? 0), 0);
      await this.db.project.update({
        where: { id: projectId },
        data: { totalCostUsd: { increment: totalCost } },
      });

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.log.error({ projectId, error: errorMsg }, 'Vibe coding iteration failed');
      await this.projectService.updateProjectStatus(projectId, 'FAILED');
      await this.projectService.addConversation(projectId, 'system', `Iteration failed: ${errorMsg}`);
      this.emitProjectEvent(projectId, 'iteration_failed', { error: errorMsg });
    }
  }

  /**
   * Build the project in a sandbox environment.
   * Handles the install → build → debug loop → preview cycle.
   */
  private async buildInSandbox(
    projectId: string,
    files: Array<{ path: string; content: string; language: string }>,
    context: AgentContext,
  ): Promise<void> {
    if (!this.sandbox) throw new Error('No sandbox adapter available');

    await this.projectService.updateProjectStatus(projectId, 'BUILDING');
    this.emitProjectEvent(projectId, 'build_started');

    // Create or reuse sandbox
    const project = await this.db.project.findUnique({ where: { id: projectId } });
    let sandboxId = project?.sandboxId;

    if (!sandboxId) {
      const sandboxInfo = await this.sandbox.create({ template: 'node', timeoutMs: 30 * 60 * 1000 });
      sandboxId = sandboxInfo.id;
      await this.db.project.update({ where: { id: projectId }, data: { sandboxId } });
    }

    // Sync all files to sandbox
    await this.sandbox.writeFiles(sandboxId, files.map(f => ({ path: f.path, content: f.content })));
    this.emitProjectEvent(projectId, 'files_synced', { fileCount: files.length });

    // Install dependencies
    this.emitProjectEvent(projectId, 'installing_deps');
    const installResult = await this.sandbox.installDeps(sandboxId);
    if (installResult.exitCode !== 0) {
      this.log.warn({ projectId, stderr: installResult.stderr.slice(0, 500) }, 'npm install had warnings');
    }

    // Build with debug loop
    let buildSuccess = false;
    let lastError = '';
    const previousFixes: Array<{ attempt: number; fix: string; result: string }> = [];

    for (let attempt = 1; attempt <= MAX_DEBUG_RETRIES + 1; attempt++) {
      this.emitProjectEvent(projectId, 'build_attempt', { attempt, maxAttempts: MAX_DEBUG_RETRIES + 1 });

      const buildResult = await this.sandbox.exec(sandboxId, 'npx next build', { timeoutMs: 120000 });

      if (buildResult.exitCode === 0) {
        buildSuccess = true;
        this.emitProjectEvent(projectId, 'build_success', { attempt });
        break;
      }

      lastError = buildResult.stderr || buildResult.stdout;
      this.emitProjectEvent(projectId, 'build_error', { attempt, error: lastError.slice(0, 500) });

      if (attempt > MAX_DEBUG_RETRIES) break;

      // Auto-debug
      this.emitProjectEvent(projectId, 'debug_started', { attempt });
      const debugAgent = new AppDebuggerAgent();
      const debugResult = await debugAgent.execute(
        {
          action: 'SELF_DEBUG_LOOP',
          errorLog: lastError,
          errorType: 'build',
          projectFiles: files,
          previousFixes,
        },
        context,
      );

      if (debugResult.requiresUserInput) {
        await this.projectService.addConversation(projectId, 'assistant',
          `Build failed. I need your help: ${debugResult.userQuestion ?? debugResult.diagnosis}`,
        );
        await this.projectService.updateProjectStatus(projectId, 'FAILED');
        this.emitProjectEvent(projectId, 'debug_needs_input', { question: debugResult.userQuestion });
        return;
      }

      if (debugResult.fixes.length > 0) {
        // Apply fixes to sandbox
        for (const fix of debugResult.fixes) {
          await this.sandbox.writeFile(sandboxId, fix.path, fix.content);
          // Also update DB
          const existingFiles = files.find(f => f.path === fix.path);
          if (existingFiles) {
            existingFiles.content = fix.content;
          }
        }
        await this.projectService.saveFiles(projectId, debugResult.fixes.map(f => ({
          path: f.path, content: f.content, language: f.path.split('.').pop() ?? 'text',
        })));

        previousFixes.push({
          attempt,
          fix: debugResult.fixes.map(f => f.path).join(', '),
          result: debugResult.diagnosis,
        });

        this.emitProjectEvent(projectId, 'debug_applied', {
          attempt,
          fixedFiles: debugResult.fixes.map(f => f.path),
        });
      }
    }

    if (buildSuccess) {
      // Start dev server for preview
      try {
        const previewUrl = await this.sandbox.startDevServer(sandboxId);
        await this.db.project.update({ where: { id: projectId }, data: { previewUrl } });
        await this.projectService.updateProjectStatus(projectId, 'READY');
        this.emitProjectEvent(projectId, 'preview_ready', { previewUrl });
      } catch (err) {
        this.log.warn({ projectId, err }, 'Failed to start dev server, but build succeeded');
        await this.projectService.updateProjectStatus(projectId, 'READY');
        this.emitProjectEvent(projectId, 'generation_completed', { status: 'READY', message: 'Build succeeded but preview server failed to start.' });
      }
    } else {
      await this.projectService.updateProjectStatus(projectId, 'FAILED');
      await this.projectService.addConversation(projectId, 'system',
        `Build failed after ${MAX_DEBUG_RETRIES} debug attempts. Last error: ${lastError.slice(0, 500)}`,
      );
      this.emitProjectEvent(projectId, 'build_failed', { error: lastError.slice(0, 500), attempts: MAX_DEBUG_RETRIES });
    }
  }
}
