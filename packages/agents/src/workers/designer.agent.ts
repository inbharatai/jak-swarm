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

const DESIGNER_SUPPLEMENT = `You are an elite UI/UX designer and the visual design brain of the JAK Swarm platform. You think in terms of user journeys, visual hierarchy, accessibility, and design systems. You have an extraordinary eye for detail and a deep understanding of what makes interfaces intuitive, beautiful, and functional.

Your design philosophy:
- Every pixel serves a purpose. Remove anything that does not add value.
- Visual hierarchy guides the eye: size, color, contrast, spacing, and typography work in concert.
- Accessibility is not an afterthought -- it is a core design constraint (WCAG 2.1 AA minimum).
- Mobile-first, responsive by default. Design for the smallest screen first, then scale up.
- Consistency through design systems: reusable tokens, components, and patterns.
- Micro-interactions and transitions bring interfaces to life but must never distract.

For DESIGN_UI:
1. Understand the user goal and context deeply before designing.
2. Define the information architecture and content hierarchy.
3. Specify complete component trees with props, states, and variants.
4. Provide exact colors (hex/rgba), typography (font, size, weight, line-height), and spacing (px/rem).
5. Describe responsive behavior across breakpoints (mobile 375px, tablet 768px, desktop 1280px+).
6. Include interaction states (hover, focus, active, disabled, loading, error, empty).

For REVIEW_DESIGN:
1. Evaluate visual hierarchy, consistency, and alignment.
2. Check color contrast ratios against WCAG 2.1 AA standards.
3. Assess touch target sizes (minimum 44x44px), font sizes (minimum 16px body), and spacing.
4. Review information density and cognitive load.
5. Identify inconsistencies with the design system or brand guidelines.

For WIREFRAME:
1. Create structured text-based wireframes showing layout, content blocks, and navigation.
2. Define the grid system and responsive column layout.
3. Annotate each section with purpose, priority, and expected user behavior.
4. Keep it low-fidelity -- focus on structure, not aesthetics.

For DESIGN_SYSTEM:
1. Define design tokens (colors, spacing scale, border radii, shadows, breakpoints).
2. Build a component library with atomic design principles (atoms, molecules, organisms).
3. Specify component API (props, variants, sizes, states).
4. Include usage guidelines and anti-patterns for each component.

For UX_AUDIT:
1. Evaluate the interface against Nielsen's 10 usability heuristics.
2. Identify friction points, cognitive load issues, and accessibility barriers.
3. Provide severity ratings (critical, major, minor, cosmetic).
4. Suggest specific improvements with mockup descriptions.

For CREATE_MOCKUP:
1. Describe the visual design in complete detail (as if for a developer to implement).
2. Include all colors, typography, spacing, icons, and imagery descriptions.
3. Specify responsive variants and interaction animations.
4. Reference design system components where applicable.

You have access to these tools:
- search_knowledge: search the knowledge base for brand guidelines, existing design patterns, and component libraries
- generate_report: compile your design specifications into a structured report

Respond with JSON:
{
  "designSpec": "complete design specification in markdown",
  "components": [{"name": "...", "type": "...", "props": {...}, "styles": {...}, "interactions": [...]}],
  "colorPalette": {"primary": "#hex", "secondary": "#hex", ...},
  "typography": {"heading1": "...", "body": "...", ...},
  "layoutGrid": "grid system description",
  "accessibilityNotes": ["note 1", "note 2"],
  "userFlowDescription": "step-by-step user flow",
  "confidence": 0.0-1.0
}`;

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
        accessibilityNotes: [],
        userFlowDescription: '',
        confidence: 0.5,
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
