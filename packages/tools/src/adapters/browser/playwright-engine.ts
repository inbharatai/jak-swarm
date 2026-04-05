import { chromium, Browser, Page, BrowserContext } from 'playwright';
import * as path from 'node:path';
import * as os from 'node:os';

/**
 * Singleton Playwright browser engine for JAK Swarm.
 *
 * - Lazily launches Chromium on first use (headless by default)
 * - Uses a persistent browser context so login state (Gmail, etc.) persists
 * - Creates pages on demand, cleans up after use
 * - Configurable timeout (default 30s)
 * - Never throws unhandled errors from public methods
 */

const DEFAULT_TIMEOUT = 30_000;

function getUserDataDir(): string {
  const home = os.homedir();
  return path.join(home, '.jak-swarm', 'browser-profile');
}

function isHeadless(): boolean {
  return process.env['JAK_BROWSER_HEADLESS'] !== 'false';
}

export interface NavigateResult {
  title: string;
  url: string;
  content: string;
  statusCode: number;
}

export interface BrowserErrorResult {
  error: string;
  code: string;
}

class PlaywrightEngine {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private timeout: number = DEFAULT_TIMEOUT;

  /** Set custom timeout in milliseconds. */
  setTimeout(ms: number): void {
    this.timeout = ms;
  }

  /**
   * Get or launch the browser instance.
   * Uses persistent context for login state.
   */
  async getBrowser(): Promise<Browser> {
    if (this.browser && this.browser.isConnected()) {
      return this.browser;
    }
    // When using launchPersistentContext, we get a context directly (no separate browser handle).
    // So we launch a regular browser and then create the context separately.
    this.browser = await chromium.launch({
      headless: isHeadless(),
    });
    return this.browser;
  }

  /**
   * Get or create a persistent browser context.
   */
  async getContext(): Promise<BrowserContext> {
    if (this.context) {
      return this.context;
    }

    // Use launchPersistentContext for login persistence
    const userDataDir = getUserDataDir();
    this.context = await chromium.launchPersistentContext(userDataDir, {
      headless: isHeadless(),
      viewport: { width: 1280, height: 800 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    });
    // The persistent context owns its own browser internally
    this.browser = this.context.browser();
    this.context.setDefaultTimeout(this.timeout);
    return this.context;
  }

  /**
   * Create a new page in the persistent context.
   */
  async getPage(): Promise<Page> {
    const ctx = await this.getContext();
    const page = await ctx.newPage();
    page.setDefaultTimeout(this.timeout);
    return page;
  }

  /**
   * Close a page, releasing resources.
   */
  async closePage(page: Page): Promise<void> {
    try {
      if (!page.isClosed()) {
        await page.close();
      }
    } catch {
      // Already closed or crashed — ignore
    }
  }

  /**
   * Shut down the browser and release all resources.
   */
  async shutdown(): Promise<void> {
    try {
      if (this.context) {
        await this.context.close();
        this.context = null;
      }
      if (this.browser) {
        await this.browser.close();
        this.browser = null;
      }
    } catch {
      this.context = null;
      this.browser = null;
    }
  }

  // ─── Core Operations ──────────────────────────────────────────────────

  /**
   * Navigate to a URL, wait for load, return page info and cleaned text.
   */
  async navigate(url: string): Promise<NavigateResult | BrowserErrorResult> {
    let page: Page | null = null;
    try {
      page = await this.getPage();
      const response = await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: this.timeout,
      });

      const title = await page.title();
      const finalUrl = page.url();
      const statusCode = response?.status() ?? 0;

      // Extract cleaned text content
      const content = await this.getPageContent(page);

      return { title, url: finalUrl, content, statusCode };
    } catch (err) {
      return {
        error: err instanceof Error ? err.message : String(err),
        code: 'NAVIGATION_FAILED',
      };
    } finally {
      if (page) await this.closePage(page);
    }
  }

  /**
   * Extract text content from elements matching a selector.
   */
  async extractText(page: Page, selector?: string): Promise<string> {
    try {
      if (!selector) {
        return await this.getPageContent(page);
      }
      const elements = await page.$$(selector);
      const texts: string[] = [];
      for (const el of elements) {
        const text = await el.textContent();
        if (text) texts.push(text.trim());
      }
      return texts.join('\n');
    } catch (err) {
      return `[Error extracting text: ${err instanceof Error ? err.message : String(err)}]`;
    }
  }

  /**
   * Fill form fields by CSS selector -> value.
   */
  async fillForm(page: Page, fields: Record<string, string>): Promise<{ filled: string[] } | BrowserErrorResult> {
    const filled: string[] = [];
    try {
      for (const [selector, value] of Object.entries(fields)) {
        await page.fill(selector, value, { timeout: this.timeout });
        filled.push(selector);
      }
      return { filled };
    } catch (err) {
      return {
        error: `Failed after filling [${filled.join(', ')}]: ${err instanceof Error ? err.message : String(err)}`,
        code: 'FILL_FAILED',
      };
    }
  }

  /**
   * Click an element by CSS selector.
   */
  async clickElement(page: Page, selector: string): Promise<{ clicked: boolean } | BrowserErrorResult> {
    try {
      await page.click(selector, { timeout: this.timeout });
      return { clicked: true };
    } catch (err) {
      return {
        error: err instanceof Error ? err.message : String(err),
        code: 'CLICK_FAILED',
      };
    }
  }

  /**
   * Take a PNG screenshot of the current page.
   * If fullPage is a boolean, it controls full-page capture; otherwise defaults to true.
   */
  async screenshot(page: Page, fullPage?: boolean): Promise<Buffer> {
    return Buffer.from(await page.screenshot({ type: 'png', fullPage: fullPage ?? true }));
  }

  /**
   * Get or create a persistent "active page" that stays open across tool calls.
   * Unlike getPage() which creates a new page each time, this returns the same
   * page for interactive browser control (typing, clicking, scrolling).
   */
  private activePage: Page | null = null;

  async getActivePage(): Promise<Page> {
    if (this.activePage && !this.activePage.isClosed()) {
      return this.activePage;
    }
    const ctx = await this.getContext();
    // Reuse an existing page if available, otherwise create one
    const pages = ctx.pages();
    if (pages.length > 0) {
      this.activePage = pages[pages.length - 1]!;
    } else {
      this.activePage = await ctx.newPage();
    }
    this.activePage.setDefaultTimeout(this.timeout);
    return this.activePage;
  }

  /**
   * Get cleaned visible text content from a page.
   */
  async getPageContent(page: Page): Promise<string> {
    try {
      // The function string runs in browser context where document/HTMLElement exist
      const text = await page.evaluate(`(() => {
        const clone = document.body.cloneNode(true);
        clone.querySelectorAll('script, style, nav, footer, header, noscript, svg, iframe').forEach(el => el.remove());
        return clone.innerText || clone.textContent || '';
      })()`) as string;
      // Collapse whitespace
      return text
        .replace(/\t/g, ' ')
        .replace(/ +/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
        .slice(0, 10_000); // Cap to prevent token overflow
    } catch (err) {
      return `[Error extracting content: ${err instanceof Error ? err.message : String(err)}]`;
    }
  }
}

/** Singleton instance. */
export const playwrightEngine = new PlaywrightEngine();
