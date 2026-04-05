import type {
  BrowserAdapter,
  BrowserContext,
  NavigateResult,
  ExtractResult,
  FillResult,
  ClickResult,
  BrowserError,
} from './browser.interface.js';

/**
 * Playwright browser adapter.
 *
 * TODO: Install playwright: pnpm add playwright
 * Then uncomment the import below:
 * import { chromium, Browser, Page, BrowserContext as PlaywrightBrowserContext } from 'playwright';
 *
 * This adapter creates an isolated browser context per session for tenant isolation.
 * All write actions take before/after screenshots.
 * Domain allowlist is enforced before any navigation.
 */

// Destructive button patterns — clicking these requires approval
const DESTRUCTIVE_SELECTORS = [
  'button[type="submit"]',
  'input[type="submit"]',
  '[class*="delete"]',
  '[class*="remove"]',
  '[class*="destroy"]',
  '[id*="delete"]',
  '[id*="remove"]',
  '[data-action="delete"]',
  '[data-action="remove"]',
  '[aria-label*="delete" i]',
  '[aria-label*="remove" i]',
];

// 1x1 transparent PNG buffer for mock screenshots
const MOCK_SCREENSHOT = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

export class PlaywrightBrowserAdapter implements BrowserAdapter {
  // Session ID -> Playwright BrowserContext (typed as unknown to avoid requiring playwright package)
  private readonly sessions = new Map<string, unknown>();

  private async getOrCreateSession(context: BrowserContext): Promise<unknown> {
    if (this.sessions.has(context.sessionId)) {
      return this.sessions.get(context.sessionId);
    }

    // TODO: Uncomment when playwright is installed:
    // const browser = await chromium.launch({ headless: true });
    // const ctx = await browser.newContext({
    //   viewport: { width: 1280, height: 800 },
    //   userAgent: 'JAKSwarm-BrowserAgent/1.0',
    // });
    // this.sessions.set(context.sessionId, ctx);
    // return ctx;

    // Stub session for when playwright is not installed
    const stub = { sessionId: context.sessionId, stub: true };
    this.sessions.set(context.sessionId, stub);
    return stub;
  }

  private checkDomainAllowlist(url: string, allowedDomains: string[]): BrowserError | null {
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      return {
        type: 'NAVIGATION_FAILED',
        message: `Invalid URL: ${url}`,
        url,
      };
    }

    const host = parsedUrl.hostname.toLowerCase();
    const isAllowed = allowedDomains.some(
      (domain) =>
        host === domain.toLowerCase() ||
        host.endsWith(`.${domain.toLowerCase()}`),
    );

    if (!isAllowed) {
      return {
        type: 'DOMAIN_BLOCKED',
        message: `Domain '${host}' is not in the allowed domains list: [${allowedDomains.join(', ')}]`,
        url,
      };
    }

    return null;
  }

  private isDestructiveSelector(selector: string): boolean {
    const selectorLower = selector.toLowerCase();
    return DESTRUCTIVE_SELECTORS.some((ds) => {
      const dsLower = ds.toLowerCase();
      return (
        selectorLower === dsLower ||
        selectorLower.includes('delete') ||
        selectorLower.includes('remove') ||
        selectorLower.includes('destroy') ||
        selectorLower.includes('submit')
      );
    });
  }

  async navigate(url: string, context: BrowserContext): Promise<NavigateResult> {
    const domainError = this.checkDomainAllowlist(url, context.allowedDomains);
    if (domainError) {
      throw new Error(domainError.message);
    }

    await this.getOrCreateSession(context);

    const startedAt = Date.now();

    // TODO: Uncomment when playwright is installed:
    // const browserContext = this.sessions.get(context.sessionId) as PlaywrightBrowserContext;
    // const page = await browserContext.newPage();
    // const response = await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    // const title = await page.title();
    // const screenshot = await page.screenshot({ type: 'png' });
    // return {
    //   url: page.url(),
    //   title,
    //   statusCode: response?.status() ?? 200,
    //   loadTimeMs: Date.now() - startedAt,
    //   screenshotBuffer: screenshot,
    // };

    // Stub response when playwright is not installed
    return {
      url,
      title: `Page at ${url}`,
      statusCode: 200,
      loadTimeMs: Date.now() - startedAt,
      screenshotBuffer: MOCK_SCREENSHOT,
    };
  }

  async extract(selector: string, context: BrowserContext): Promise<ExtractResult> {
    await this.getOrCreateSession(context);

    // TODO: Uncomment when playwright is installed:
    // const browserContext = this.sessions.get(context.sessionId) as PlaywrightBrowserContext;
    // const pages = browserContext.pages();
    // const page = pages[pages.length - 1] ?? await browserContext.newPage();
    // const elements = await page.$$(selector);
    // const items = await Promise.all(
    //   elements.map(async (el) => ({
    //     text: await el.textContent() ?? '',
    //     html: await el.innerHTML(),
    //     attributes: {} as Record<string, string>,
    //   }))
    // );
    // return { selector, text: items.map(i => i.text).join('\n'), html: items.map(i => i.html).join(''), count: items.length, items };

    // Stub
    return {
      selector,
      text: `[Mock extracted text for selector: ${selector}]`,
      html: `<div>[Mock HTML for selector: ${selector}]</div>`,
      count: 1,
      items: [
        {
          text: `[Mock text for: ${selector}]`,
          html: `<div>[Mock HTML]</div>`,
          attributes: {},
        },
      ],
    };
  }

  async fillForm(fields: Record<string, string>, context: BrowserContext): Promise<FillResult> {
    await this.getOrCreateSession(context);

    const screenshotBefore = context.screenshotBeforeWrite !== false ? MOCK_SCREENSHOT : undefined;

    // TODO: Uncomment when playwright is installed:
    // const browserContext = this.sessions.get(context.sessionId) as PlaywrightBrowserContext;
    // const pages = browserContext.pages();
    // const page = pages[pages.length - 1] ?? await browserContext.newPage();
    // const screenshotBefore = await page.screenshot({ type: 'png' });
    // for (const [selector, value] of Object.entries(fields)) {
    //   await page.fill(selector, value);
    // }
    // const screenshotAfter = await page.screenshot({ type: 'png' });
    // return { fieldsSet: Object.keys(fields), success: true, screenshotBefore, screenshotAfter };

    // Stub
    return {
      fieldsSet: Object.keys(fields),
      success: true,
      ...(screenshotBefore !== undefined && { screenshotBefore }),
      screenshotAfter: MOCK_SCREENSHOT,
    };
  }

  async click(selector: string, context: BrowserContext): Promise<ClickResult> {
    await this.getOrCreateSession(context);

    const isDestructive = this.isDestructiveSelector(selector);
    const screenshotBefore = MOCK_SCREENSHOT;

    // TODO: Uncomment when playwright is installed:
    // const browserContext = this.sessions.get(context.sessionId) as PlaywrightBrowserContext;
    // const pages = browserContext.pages();
    // const page = pages[pages.length - 1] ?? await browserContext.newPage();
    // const screenshotBefore = await page.screenshot({ type: 'png' });
    // await page.click(selector);
    // const screenshotAfter = await page.screenshot({ type: 'png' });

    return {
      selector,
      success: true,
      isDestructive,
      requiresApproval: isDestructive,
      screenshotBefore,
      screenshotAfter: MOCK_SCREENSHOT,
    };
  }

  async screenshot(context: BrowserContext): Promise<Buffer> {
    await this.getOrCreateSession(context);

    // TODO: Uncomment when playwright is installed:
    // const browserContext = this.sessions.get(context.sessionId) as PlaywrightBrowserContext;
    // const pages = browserContext.pages();
    // const page = pages[pages.length - 1] ?? await browserContext.newPage();
    // return page.screenshot({ type: 'png', fullPage: true });

    return MOCK_SCREENSHOT;
  }

  async close(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session) {
      // TODO: Uncomment when playwright is installed:
      // const browserContext = session as PlaywrightBrowserContext;
      // await browserContext.close();
      this.sessions.delete(sessionId);
    }
  }
}
