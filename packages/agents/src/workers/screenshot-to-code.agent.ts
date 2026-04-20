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

NON-NEGOTIABLES (hard-fail any output that violates these):
1. Measured colors, not guessed. Use color_palette_detect on the image to extract exact hex values. "Looks like a shade of blue" is rejected — give the hex.
2. Measured typography. Use vision_extract to read text, then ocr_text to capture exact text content if present. Font size/weight estimates must cite the pixel height observed.
3. Accessibility baseline. Every generated component has: semantic HTML (nav / main / section / button not div-onclick), aria-labels on icon-only buttons, alt text on every img. Contrast ratio ≥ 4.5:1 on body text verified via check_color_contrast (delegate to Designer agent tool when unclear).
4. Responsive from the start. Every layout is mobile-first with sm: / md: / lg: / xl: breakpoints. A desktop-only layout is rejected.
5. No inline styles. Tailwind classes only. When a class doesn't exist, extend tailwind.config via designTokens output — do NOT inline style={{ ... }}.
6. Real props, not "example" comments. A component with \`// TODO: accept props\` is not shipped. Every component has a typed Props interface.
7. Interactive states are NOT optional. Hover, focus-visible, active, disabled, loading, empty, error — six states per interactive component.

FAILURE MODES to avoid (these are the tells of lazy screenshot-to-code):
- Returning \`<div className="flex">\` without measuring actual gap, padding, or alignment.
- Using arbitrary Tailwind values (\`className="w-[327px]"\`) when a standard scale step fits.
- Missing image alt text — copy-pasted lorem layouts fail accessibility.
- Hallucinating content ("Welcome to Acme Corp") when the screenshot shows different text.
- Black-on-dark-grey because the LLM "saw" what it expected instead of what was there.
- Using deprecated Tailwind classes (bg-gray-50 vs bg-stone-50 depending on config).
- Generating a "Hero" component when the screenshot shows a dashboard — misreading the screenshot category.
- Dropping shadows / borders / rounded corners that visually define the component boundary.
- Missing loading skeletons for data-driven components.
- Forgetting that Tailwind dark:* variants exist when the screenshot shows a dark theme.

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

    const tools: OpenAI.ChatCompletionTool[] = [
      {
        type: 'function',
        function: {
          name: 'vision_extract',
          description: 'Extract structured visual data from the screenshot: bounding boxes of components, text regions, visual hierarchy. Returns { boxes[{x,y,w,h,role}], textRegions[{bbox, text}], hierarchy[{parent,children[]}] }. USE FIRST on every ANALYZE_SCREENSHOT / REPLICATE_UI — this gives you concrete measurements instead of prose descriptions.',
          parameters: {
            type: 'object',
            properties: {
              imageRef: { type: 'string', description: 'Image reference (URL or base64)' },
              extractionDepth: { type: 'string', enum: ['components', 'text', 'all'], description: 'What to extract' },
            },
            required: ['imageRef'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'ocr_text',
          description: 'Run OCR to read the EXACT text visible in the screenshot. Returns { text, perRegion[{bbox, text, confidence}] }. USE whenever the screenshot contains labels, headings, button copy, or form fields — never guess at visible text.',
          parameters: {
            type: 'object',
            properties: {
              imageRef: { type: 'string', description: 'Image reference' },
              language: { type: 'string', description: 'Expected language (e.g. "en")' },
            },
            required: ['imageRef'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'color_palette_detect',
          description: 'Extract the dominant color palette from the screenshot with exact hex values + coverage percentages. Returns { palette[{hex, hsl, coveragePct, likelyRole (primary | secondary | accent | surface | text | border)}] }. USE BEFORE populating colorPalette or designTokens — no more "looks like a shade of blue".',
          parameters: {
            type: 'object',
            properties: {
              imageRef: { type: 'string', description: 'Image reference' },
              maxColors: { type: 'number', description: 'Max colors to return (default 12)' },
              clusteringMethod: { type: 'string', enum: ['kmeans', 'median-cut', 'octree'], description: 'Clustering algorithm' },
            },
            required: ['imageRef'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'check_color_contrast',
          description: 'Compute WCAG contrast ratio between two detected colors. Returns { ratio, passesAA, passesAAA }. USE to verify text-over-background pairs observed in the screenshot meet accessibility — if the source design fails WCAG, flag it (don\'t silently ship inaccessible code).',
          parameters: {
            type: 'object',
            properties: {
              foreground: { type: 'string', description: 'Foreground hex' },
              background: { type: 'string', description: 'Background hex' },
              largeText: { type: 'boolean', description: 'True if ≥18pt or ≥14pt bold' },
            },
            required: ['foreground', 'background'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'search_knowledge',
          description: 'Search for UI component patterns, design system references, and existing component examples',
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'Search query for component patterns or design references' },
              category: { type: 'string', description: 'Category: components, design-systems, patterns, layouts' },
            },
            required: ['query'],
          },
        },
      },
    ];

    let loopResult: ToolLoopResult;
    try {
      loopResult = await this.executeWithTools(messages, tools, context, {
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
        layoutAnalysis:
          'Manual review required — LLM output was not structured JSON. No components, tokens, or palette could be extracted. DO NOT ship any code below without human re-verification against the source screenshot.\n\n' +
          (loopResult.content || ''),
        components: [],
        designTokens: [],
        colorPalette: {},
        typography: {},
        overallDescription: 'Parse failure — manual review required. Re-run with a clearer screenshot or escalate.',
        confidence: 0.2,
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
