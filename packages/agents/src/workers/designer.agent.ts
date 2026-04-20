import type OpenAI from 'openai';
import { AgentRole } from '@jak-swarm/shared';
import { BaseAgent } from '../base/base-agent.js';
import type { ToolLoopResult } from '../base/base-agent.js';
import type { AgentContext } from '../base/agent-context.js';

export type DesignerAction =
  | 'DESIGN_UI'
  | 'REVIEW_DESIGN'
  | 'WIREFRAME'
  | 'DESIGN_SYSTEM'
  | 'UX_AUDIT'
  | 'CREATE_MOCKUP';

export interface DesignerTask {
  action: DesignerAction;
  description?: string;
  targetPlatform?: 'web' | 'mobile' | 'desktop' | 'responsive';
  existingDesign?: string;
  brandGuidelines?: string;
  userPersona?: string;
  constraints?: string[];
}

export interface DesignComponent {
  name: string;
  type: string;
  props?: Record<string, string>;
  children?: DesignComponent[];
  styles?: Record<string, string>;
  interactions?: string[];
}

export interface DesignerResult {
  action: DesignerAction;
  designSpec: string;
  components: DesignComponent[];
  colorPalette: Record<string, string>;
  typography: Record<string, string>;
  layoutGrid: string;
  accessibilityNotes: string[];
  userFlowDescription: string;
  confidence: number;
}

const DESIGNER_SUPPLEMENT = `You are a staff-level product designer who has shipped design systems at scale and been the last line of defense against shipping an inaccessible interface. You reason from contrast ratios, touch targets, cognitive load, and platform conventions — not from "looks modern" vibes.

NON-NEGOTIABLES (hard-fail any output that violates these):
1. Contrast: body text minimum 4.5:1 against its actual background (WCAG AA). Large text (≥18pt or ≥14pt bold) minimum 3:1. Use check_color_contrast to verify; if you propose #9ca3af on #ffffff you will be rejected.
2. Touch targets: interactive elements minimum 44×44 px on touch devices, 24×24 px on pointer devices. Spacing between adjacent targets minimum 8 px.
3. Focus: every interactive element has a visible focus indicator with ≥3:1 contrast against BOTH the element and its surroundings. Removing focus outlines without a replacement is a critical bug.
4. Motion: any animation over 200ms must respect prefers-reduced-motion. Never auto-play motion on first paint.
5. Color-only signaling: never use color alone to convey meaning. Errors, required fields, status indicators MUST also carry icon / text / pattern.
6. Font sizes: body minimum 16px (1rem) on web, 17pt on iOS, 14sp on Android. Labels 12-14px with ≥4.5:1 contrast.

FAILURE MODES to avoid (these are the mistakes a bad designer makes):
- Proposing light-gray-on-white (#cccccc on white is 1.6:1 — fails AA by a wide margin). Any value below #767676 on white or #949494 on #1e293b body text without verification is a red flag.
- Removing the default focus ring "because it's ugly" without adding a replacement.
- Using placeholder text as the only label — it disappears on focus and fails accessibility.
- Inventing a color palette without a documented design token name (e.g. "--color-primary-500") so engineers can't implement consistently.
- Specifying typography in pixels only without also giving rem (breaks user text scaling).
- Ignoring the empty / error / loading / unauthorized states — a component with only the happy path is half-shipped.

Action handling:

DESIGN_UI:
- Start from user goal + platform + data shape. "Make it look good" is not a brief; refine first.
- Produce a complete component tree: name, variants, states, props. Use check_color_contrast on every proposed text/background pair.
- Responsive: specify behavior at 375px (mobile), 768px (tablet), 1280px (desktop). Describe what collapses, wraps, or hides.
- States required per interactive component: default, hover, focus-visible, active, disabled, loading, error, empty, unauthorized.
- Tokens: every color → design token name. Every spacing → rem scale step. Every typography → named style.

REVIEW_DESIGN:
- Audit against the non-negotiables above in order. Report FIRST violation by severity (critical > major > minor).
- For every accessibility issue: state the exact contrast ratio (use check_color_contrast), the WCAG criterion failed (e.g., "WCAG 2.1 AA 1.4.3 Contrast"), and the concrete fix.
- Don't re-state subjective preferences as problems. "Too much whitespace" is not a finding; "CTA below the fold on 375px" is.
- Use validate_wcag for multi-criterion compliance checks.

WIREFRAME:
- Low-fi, no colors, no typography finesse — structure + content + hierarchy only.
- Annotate every region with: purpose, priority (1-3), expected user action, empty state behavior.

DESIGN_SYSTEM:
- Token taxonomy: color, spacing, radius, shadow, typography, motion, z-index, breakpoints. Every token has a semantic name AND a raw name (e.g. "color.surface.default" + "gray.50").
- Atomic design: atoms (button, input) → molecules (form field with label + error) → organisms (header, data table). Document composition rules.
- Each component spec includes: props API, variants, states, do/don't usage, accessibility requirements.
- Use search_figma_library to check if an existing component already solves the case before proposing a new one.

UX_AUDIT:
- Structured against Nielsen's 10 heuristics + WCAG 2.1 AA + platform HIG (iOS HIG, Material Design).
- Every finding has: severity (critical/major/minor/cosmetic), heuristic/criterion violated, reproduction steps, concrete fix with expected lift.

CREATE_MOCKUP:
- Developer-implementable spec. Every value resolvable without asking clarifying questions.
- Responsive variants specified. Animations specified with duration + easing + reduced-motion fallback.

Tools you have:
- check_color_contrast(foreground, background, largeText?) → returns WCAG ratio, pass/fail. USE BEFORE proposing any text/background pair.
- search_figma_library(component, variant?) → checks if an existing design system component matches. USE BEFORE inventing a new component.
- validate_wcag(componentSpec, level) → runs multi-criterion accessibility check against AA or AAA. USE ON FINAL OUTPUT of DESIGN_UI / CREATE_MOCKUP.
- search_knowledge → brand guidelines, existing patterns.
- generate_report → structured deliverable.

Respond with STRICT JSON matching DesignerResult. accessibilityNotes MUST include measured contrast ratios and the WCAG criterion each satisfies (e.g. "Body text #1e293b on #ffffff: 16.6:1 — WCAG AA 1.4.3"). No markdown fences.`;

export class DesignerAgent extends BaseAgent {
  constructor(apiKey?: string) {
    super(AgentRole.WORKER_DESIGNER, apiKey);
  }

  async execute(input: unknown, context: AgentContext): Promise<DesignerResult> {
    const startedAt = new Date();
    const task = input as DesignerTask;

    this.logger.info(
      { runId: context.runId, action: task.action, platform: task.targetPlatform },
      'Designer agent executing task',
    );

    const tools: OpenAI.ChatCompletionTool[] = [
      {
        type: 'function',
        function: {
          name: 'check_color_contrast',
          description: 'Compute WCAG contrast ratio between two colors. Returns ratio (e.g. 4.6), and pass flags for AA normal, AA large, AAA normal, AAA large. Use BEFORE proposing any text/background color pair.',
          parameters: {
            type: 'object',
            properties: {
              foreground: { type: 'string', description: 'Foreground color — hex (#RRGGBB) or rgb()' },
              background: { type: 'string', description: 'Background color — hex (#RRGGBB) or rgb()' },
              largeText: { type: 'boolean', description: 'True if text is ≥18pt or ≥14pt bold (applies 3:1 threshold instead of 4.5:1)' },
            },
            required: ['foreground', 'background'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'search_figma_library',
          description: 'Search an existing Figma/design-system library for components matching the described intent. Returns matches with usage notes and variants. Use BEFORE inventing a new component.',
          parameters: {
            type: 'object',
            properties: {
              component: { type: 'string', description: 'Component role / intent (e.g. "primary cta", "multi-select filter", "empty state card")' },
              variant: { type: 'string', description: 'Optional variant hint (e.g. "destructive", "compact")' },
            },
            required: ['component'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'validate_wcag',
          description: 'Run multi-criterion WCAG 2.1 check against a component spec. Returns per-criterion pass/fail (e.g. 1.4.3 Contrast, 2.1.1 Keyboard, 2.4.7 Focus Visible, 1.3.1 Info and Relationships). Use on final DESIGN_UI / CREATE_MOCKUP output.',
          parameters: {
            type: 'object',
            properties: {
              componentSpec: { type: 'string', description: 'Component spec in markdown or JSON' },
              level: { type: 'string', enum: ['AA', 'AAA'], description: 'WCAG conformance level to validate against' },
            },
            required: ['componentSpec', 'level'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'search_knowledge',
          description: 'Search the knowledge base for brand guidelines, existing design patterns, and component libraries',
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'Search query for design patterns or brand guidelines' },
              category: { type: 'string', description: 'Category filter (e.g., "brand", "components", "patterns")' },
            },
            required: ['query'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'generate_report',
          description: 'Compile design specifications into a structured report',
          parameters: {
            type: 'object',
            properties: {
              title: { type: 'string', description: 'Report title' },
              content: { type: 'string', description: 'Report content in markdown' },
              format: { type: 'string', enum: ['markdown', 'json', 'html'], description: 'Output format' },
            },
            required: ['title', 'content'],
          },
        },
      },
    ];

    const messages: OpenAI.ChatCompletionMessageParam[] = [
      {
        role: 'system',
        content: this.buildSystemMessage(DESIGNER_SUPPLEMENT),
      },
      {
        role: 'user',
        content: JSON.stringify({
          action: task.action,
          description: task.description,
          targetPlatform: task.targetPlatform,
          existingDesign: task.existingDesign,
          brandGuidelines: task.brandGuidelines,
          userPersona: task.userPersona,
          constraints: task.constraints,
          industryContext: context.industry,
        }),
      },
    ];

    let loopResult: ToolLoopResult;
    try {
      loopResult = await this.executeWithTools(messages, tools, context, {
        maxTokens: 4096,
        temperature: 0.3,
        maxIterations: 4,
      });
    } catch (err) {
      this.logger.error({ err }, 'Designer executeWithTools failed');
      const fallback: DesignerResult = {
        action: task.action,
        designSpec: 'The designer agent encountered an error while processing the request.',
        components: [],
        colorPalette: {},
        typography: {},
        layoutGrid: '',
        accessibilityNotes: [],
        userFlowDescription: '',
        confidence: 0,
      };
      this.recordTrace(context, input, fallback, [], startedAt);
      return fallback;
    }

    let result: DesignerResult;

    try {
      const parsed = this.parseJsonResponse<Partial<DesignerResult>>(loopResult.content);
      result = {
        action: task.action,
        designSpec: parsed.designSpec ?? '',
        components: parsed.components ?? [],
        colorPalette: parsed.colorPalette ?? {},
        typography: parsed.typography ?? {},
        layoutGrid: parsed.layoutGrid ?? '',
        accessibilityNotes: parsed.accessibilityNotes ?? [],
        userFlowDescription: parsed.userFlowDescription ?? '',
        confidence: parsed.confidence ?? 0.7,
      };
    } catch {
      result = {
        action: task.action,
        designSpec: loopResult.content || '',
        components: [],
        colorPalette: {},
        typography: {},
        layoutGrid: '',
        accessibilityNotes: [
          'Manual review required — output format was unexpected. Do not ship without running contrast + WCAG validation on proposed values.',
        ],
        userFlowDescription: '',
        confidence: 0.4,
      };
    }

    this.recordTrace(context, input, result, loopResult.toolCalls, startedAt);

    this.logger.info(
      {
        action: task.action,
        componentCount: result.components.length,
        confidence: result.confidence,
      },
      'Designer agent completed',
    );

    return result;
  }
}
