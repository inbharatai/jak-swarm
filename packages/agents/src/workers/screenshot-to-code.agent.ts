import type OpenAI from 'openai';
import { AgentRole } from '@jak-swarm/shared';
import { BaseAgent } from '../base/base-agent.js';
import type { ToolLoopResult } from '../base/base-agent.js';
import type { AgentContext } from '../base/agent-context.js';

export type ScreenshotToCodeAction =
  | 'ANALYZE_SCREENSHOT'
  | 'REPLICATE_UI'
  | 'EXTRACT_DESIGN_TOKENS';

export interface ScreenshotToCodeTask {
  action: ScreenshotToCodeAction;
  imageBase64?: string;
  imageUrl?: string;
  targetFramework?: string;
  existingDesignSystem?: string;
  additionalInstructions?: string;
}

export interface DesignToken {
  category: 'color' | 'typography' | 'spacing' | 'border' | 'shadow';
  name: string;
  value: string;
  usage: string;
}

export interface ComponentSpec {
  name: string;
  code: string;
  styles?: string;
  description: string;
  props?: Array<{ name: string; type: string; description: string }>;
}

export interface ScreenshotToCodeResult {
  action: ScreenshotToCodeAction;
  layoutAnalysis: string;
  components: ComponentSpec[];
  designTokens: DesignToken[];
  colorPalette: Record<string, string>;
  typography: Record<string, string>;
  overallDescription: string;
  confidence: number;
}

const SCREENSHOT_TO_CODE_SUPPLEMENT = `You are the Screenshot-to-Code Agent for JAK Swarm's Vibe Coding engine. You analyze UI screenshots and convert them into pixel-accurate React + Tailwind CSS code.

You have EXCEPTIONAL visual analysis abilities. You can identify:
- Layout structure (grid, flex, spacing, alignment)
- Color palette (exact hex values from the image)
- Typography (font sizes, weights, line heights, letter spacing)
- Component boundaries (cards, buttons, inputs, navigation, headers)
- Responsive breakpoints (implied by the layout)
- Interactive patterns (buttons, forms, modals, dropdowns)

For ANALYZE_SCREENSHOT:
1. Describe the overall layout structure (grid columns, sections, hierarchy)
2. Identify every distinct UI component visible
3. Extract the color palette (primary, secondary, accent, neutral, background, text)
4. Identify typography system (heading sizes, body text, caption text)
5. Note spacing patterns (padding, margins, gaps)
6. Identify interactive elements and their states

For REPLICATE_UI:
1. Generate React + Tailwind components that visually match the screenshot
2. Use shadcn/ui patterns where applicable
3. Include responsive design (mobile-first)
4. Match colors as closely as possible using Tailwind classes or custom values
5. Include placeholder content that matches the structure
6. Generate COMPLETE, working components — not pseudocode

For EXTRACT_DESIGN_TOKENS:
1. Extract all visual constants into a design token system
2. Colors: primary, secondary, accent, background, surface, text, border
3. Typography: font families, sizes, weights, line heights
4. Spacing: padding scale, margin scale, gap scale
5. Borders: radius values, widths, styles
6. Shadows: elevation levels

Output code must:
- Use Tailwind CSS classes (no inline styles)
- Be fully responsive (mobile-first with sm:, md:, lg: breakpoints)
- Use semantic HTML (nav, main, section, article, aside, footer)
- Include accessibility attributes (alt, aria-label, role)
- Be production-ready (no TODOs, no placeholders except sample content)

Respond with JSON:
{
  "layoutAnalysis": "detailed layout description",
  "components": [{"name": "Hero", "code": "complete React component", "description": "..."}],
  "designTokens": [{"category": "color", "name": "primary", "value": "#3B82F6", "usage": "buttons, links"}],
  "colorPalette": {"primary": "#3B82F6", "secondary": "#1E293B"},
  "typography": {"heading1": "text-4xl font-bold", "body": "text-base"},
  "overallDescription": "summary of the UI",
  "confidence": 0.0-1.0
}`;

export class ScreenshotToCodeAgent extends BaseAgent {
  constructor(apiKey?: string) {
    super(AgentRole.WORKER_SCREENSHOT_TO_CODE, apiKey);
  }

  async execute(input: unknown, context: AgentContext): Promise<ScreenshotToCodeResult> {
    const startedAt = new Date();
    const task = input as ScreenshotToCodeTask;

    this.logger.info(
      { runId: context.runId, action: task.action, hasImage: !!(task.imageBase64 || task.imageUrl) },
      'Screenshot-to-Code agent executing task',
    );

    // If image is provided, use vision analysis first
    let imageDescription = '';
    if (task.imageBase64 || task.imageUrl) {
      try {
        const imageAnalysis = await this.analyzeImage(
          task.imageBase64 ?? task.imageUrl ?? '',
          'Analyze this UI screenshot in extreme detail. Describe: 1) Overall layout structure (grid, sections, spacing), 2) Every visible component (buttons, cards, inputs, navigation, headers, footers), 3) Color palette (list exact hex values you can identify), 4) Typography (font sizes, weights), 5) Spacing patterns, 6) Any interactive elements. Be as specific and detailed as possible.',
        );
        imageDescription = typeof imageAnalysis === 'string' ? imageAnalysis : JSON.stringify(imageAnalysis);
      } catch (err) {
        this.logger.warn({ err }, 'Vision analysis failed, proceeding with text-only');
        imageDescription = 'Vision analysis was unavailable. Use the description provided instead.';
      }
    }

    const userContent: Record<string, unknown> = {
      action: task.action,
      imageAnalysis: imageDescription,
      targetFramework: task.targetFramework ?? 'nextjs',
      existingDesignSystem: task.existingDesignSystem,
      additionalInstructions: task.additionalInstructions,
    };

    const messages: OpenAI.ChatCompletionMessageParam[] = [
      {
        role: 'system',
        content: this.buildSystemMessage(SCREENSHOT_TO_CODE_SUPPLEMENT),
      },
      {
        role: 'user',
        content: JSON.stringify(userContent),
      },
    ];

    let loopResult: ToolLoopResult;
    try {
      loopResult = await this.executeWithTools(messages, [], context, {
        maxTokens: 8192,
        temperature: 0.2,
        maxIterations: 2,
      });
    } catch (err) {
      this.logger.error({ err }, 'Screenshot-to-Code executeWithTools failed');
      const fallback: ScreenshotToCodeResult = {
        action: task.action,
        layoutAnalysis: '',
        components: [],
        designTokens: [],
        colorPalette: {},
        typography: {},
        overallDescription: 'Screenshot analysis failed.',
        confidence: 0,
      };
      this.recordTrace(context, input, fallback, [], startedAt);
      return fallback;
    }

    let result: ScreenshotToCodeResult;
    try {
      const parsed = this.parseJsonResponse<Partial<ScreenshotToCodeResult>>(loopResult.content);
      result = {
        action: task.action,
        layoutAnalysis: parsed.layoutAnalysis ?? '',
        components: parsed.components ?? [],
        designTokens: parsed.designTokens ?? [],
        colorPalette: parsed.colorPalette ?? {},
        typography: parsed.typography ?? {},
        overallDescription: parsed.overallDescription ?? '',
        confidence: parsed.confidence ?? 0.6,
      };
    } catch {
      result = {
        action: task.action,
        layoutAnalysis: loopResult.content || '',
        components: [],
        designTokens: [],
        colorPalette: {},
        typography: {},
        overallDescription: 'Output was not in expected format.',
        confidence: 0.3,
      };
    }

    this.recordTrace(context, input, result, loopResult.toolCalls, startedAt);

    this.logger.info(
      {
        action: task.action,
        componentCount: result.components.length,
        tokenCount: result.designTokens.length,
        confidence: result.confidence,
      },
      'Screenshot-to-Code agent completed',
    );

    return result;
  }
}
