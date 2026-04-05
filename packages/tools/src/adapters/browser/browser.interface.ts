export interface BrowserContext {
  sessionId: string;
  allowedDomains: string[];
  tenantId: string;
  screenshotBeforeWrite?: boolean;
}

export interface NavigateResult {
  url: string;
  title: string;
  statusCode: number;
  loadTimeMs: number;
  screenshotBuffer?: Buffer;
}

export interface ExtractResult {
  selector: string;
  text: string;
  html: string;
  count: number;
  items: Array<{ text: string; html: string; attributes: Record<string, string> }>;
}

export interface FillResult {
  fieldsSet: string[];
  success: boolean;
  screenshotBefore?: Buffer;
  screenshotAfter?: Buffer;
}

export interface ClickResult {
  selector: string;
  success: boolean;
  isDestructive: boolean; // true if it's a submit/delete button
  requiresApproval: boolean;
  screenshotBefore?: Buffer;
  screenshotAfter?: Buffer;
}

export interface BrowserError {
  type: 'DOMAIN_BLOCKED' | 'ELEMENT_NOT_FOUND' | 'NAVIGATION_FAILED' | 'TIMEOUT' | 'UNKNOWN';
  message: string;
  selector?: string;
  url?: string;
}

export interface BrowserAdapter {
  /**
   * Navigate to a URL.
   * Domain allowlist is checked before navigation.
   */
  navigate(url: string, context: BrowserContext): Promise<NavigateResult>;

  /**
   * Extract content from one or more CSS selectors.
   */
  extract(selector: string, context: BrowserContext): Promise<ExtractResult>;

  /**
   * Fill form fields by their CSS selectors.
   * Takes screenshots before and after by default.
   * Always marks as requiring approval.
   */
  fillForm(fields: Record<string, string>, context: BrowserContext): Promise<FillResult>;

  /**
   * Click an element.
   * Safety check: if target is a submit/delete button, sets requiresApproval=true.
   */
  click(selector: string, context: BrowserContext): Promise<ClickResult>;

  /**
   * Take a screenshot of the current page.
   */
  screenshot(context: BrowserContext): Promise<Buffer>;

  /**
   * Close a browser session and release resources.
   */
  close(sessionId: string): Promise<void>;
}
