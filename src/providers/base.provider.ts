import fs from 'fs';
import path from 'path';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import type { ProviderConfig } from '../types/config.types.js';
import type { Slot } from '../types/slot.types.js';
import type { ProviderAdapter } from '../types/provider.types.js';
import { childLogger } from '../utils/logger.js';
import type { Logger } from 'pino';

const SESSION_DIR = path.resolve(process.cwd(), 'artifacts', 'sessions');

export interface BrowserSession {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  usingCdp: boolean;
}

export abstract class BaseProvider implements ProviderAdapter {
  readonly providerId: string;
  protected config: ProviderConfig;
  protected log: Logger;
  session: BrowserSession | null = null;

  protected get page() {
    if (!this.session) throw new Error('Browser session not started — call ensureSession() first');
    return this.session.page;
  }

  protected get context() {
    if (!this.session) throw new Error('Browser session not started — call ensureSession() first');
    return this.session.context;
  }

  constructor(config: ProviderConfig) {
    this.providerId = config.id;
    this.config = config;
    this.log = childLogger({ provider: config.id });
  }

  abstract checkAvailability(): Promise<Slot[]>;

  protected get sessionFile(): string {
    if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR, { recursive: true });
    return path.join(SESSION_DIR, `${this.providerId}.json`);
  }

  /**
   * Connect to Chrome browser via CDP (port 9222).
   * Falls back to launching headless Chromium if CDP is not available.
   * Used for Railway/Docker deployments where no user Chrome exists.
   */
  protected async ensureSession(headless = true): Promise<BrowserSession> {
    if (this.session) return this.session;

    const cdpUrl = 'http://localhost:9222';
    let browser: Browser;

    // Try to connect to user's Chrome via CDP first
    try {
      browser = await chromium.connectOverCDP(cdpUrl);
      this.log.info('Connected to user Chrome via CDP');
    } catch {
      // CDP not available — launch headless Chromium (for Railway/Docker)
      this.log.info('CDP not available — launching headless Chromium');
      const chromeBin = process.env.CHROME_BIN || '/usr/bin/chromium';
      browser = await chromium.launch({
        headless,
        executablePath: chromeBin,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
      });
    }

    // Use the existing default context from the browser
    const contexts = browser.contexts();
    const context = contexts[0] ?? await browser.newContext();

    const pages = context.pages();
    const page = pages.length > 0 ? pages[0]! : await context.newPage();

    const usingCdp = cdpUrl === cdpUrl; // CDP mode if we connected over CDP
    this.session = { browser, context, page, usingCdp };
    return this.session;
  }

  /** Save current cookies/storage so next run skips login. */
  protected async saveSession(): Promise<void> {
    if (!this.session) return;
    try {
      await this.session.context.storageState({ path: this.sessionFile });
      this.log.info('Session saved to disk');
    } catch {
      this.log.debug('Could not save session (CDP context) — skipping');
    }
  }

  /** Delete saved session (forces re-login next run). */
  protected clearSession(): void {
    if (fs.existsSync(this.sessionFile)) {
      fs.unlinkSync(this.sessionFile);
      this.log.info('Saved session cleared');
    }
  }

  async close(): Promise<void> {
    if (this.session) {
      // Don't close user's Chrome in CDP mode
      if (!this.session.usingCdp) {
        await this.session.browser.close().catch(() => undefined);
      }
      this.session = null;
    }
  }

  protected requireEnv(name: string): string {
    const val = process.env[name];
    if (!val) {
      throw new Error(
        `Environment variable ${name} is required for provider "${this.providerId}" but is not set.`
      );
    }
    return val;
  }
}
