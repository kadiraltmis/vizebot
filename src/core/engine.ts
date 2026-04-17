import type { AppConfig, ProviderConfig } from '../types/config.types.js';
import type { Slot } from '../types/slot.types.js';
import { createProvider } from '../providers/registry.js';
import {
  upsertSlot,
  getPreviouslyVisibleSlotIds,
  updateLastSeenBatch,
  markSlotAlerted,
  countRecentErrors,
} from '../db/repository.js';
import { Notifier } from '../services/notifier.js';
import { captureScreenshot } from '../services/capture.js';
import { withRetry } from '../utils/retry.js';
import { childLogger } from '../utils/logger.js';
import type { Logger } from 'pino';

export class Engine {
  private config: AppConfig;
  private notifier: Notifier;
  private log: Logger;

  constructor(config: AppConfig) {
    this.config = config;
    this.notifier = new Notifier(config.notifications);
    this.log = childLogger({ component: 'engine' });
  }

  /**
   * Run one full monitoring cycle across all enabled providers (sequential).
   * Kept for compatibility — Scheduler now calls runProviderCycle directly.
   */
  async runCycle(): Promise<void> {
    const enabled = this.config.providers.filter((p) => p.enabled);
    this.log.debug({ count: enabled.length }, 'Starting monitoring cycle');
    for (const providerConfig of enabled) {
      await this.runProviderCycle(providerConfig);
    }
  }

  /**
   * Run a single provider cycle.
   * Browser mutex is managed inside each provider's checkAvailability().
   */
  async runProviderCycle(providerConfig: ProviderConfig): Promise<void> {
    const log = childLogger({ provider: providerConfig.id });
    const provider = createProvider(providerConfig);
    const intervalMs = providerConfig.pollingIntervalSeconds * 1_000;

    try {
      // ── 1. Snapshot the PREVIOUS cycle's visible slots ─────────────────────
      // Must happen BEFORE fetching the current state so we compare against
      // what was actually on the page in the last run.
      const previousIds = getPreviouslyVisibleSlotIds(providerConfig.id, intervalMs);
      log.debug({ previousCount: previousIds.size }, 'Previous cycle slot count');

      // ── 2. Fetch current available slots ──────────────────────────────────
      const slots = await withRetry(
        () => provider.checkAvailability(),
        { maxAttempts: 3, initialDelayMs: 5_000 },
        'checkAvailability'
      );
      log.debug({ total: slots.length }, 'Slots fetched from provider');

      // ── 3. Filter by preferences ──────────────────────────────────────────
      const current = this.filterSlots(slots, providerConfig);
      log.debug({ matching: current.length }, 'Slots matching preferences');

      // ── 4. Persist all currently-visible slots ────────────────────────────
      for (const slot of current) {
        upsertSlot(slot);
      }

      // ── 5. Detect NEWLY appeared slots (current − previous) ───────────────
      const newSlots = current.filter((s) => !previousIds.has(s.id));
      const disappearedCount = [...previousIds].filter(
        (id) => !current.some((s) => s.id === id)
      ).length;

      if (disappearedCount > 0) {
        log.info({ disappearedCount }, 'Slots that disappeared since last cycle');
      }

      if (newSlots.length === 0) {
        log.debug('No new slots this cycle');
      }

      // ── 6. Alert on each new slot ─────────────────────────────────────────
      for (const slot of newSlots) {
        // Start screenshot capture immediately in background — never awaited here
        const screenshotCapture = this.captureSlotScreenshot(provider, providerConfig.id);

        // CRITICAL PATH: send Telegram text first, target < 1 s from detection
        await this.notifier.sendSlotFoundText(slot, providerConfig.name);

        // DB write + log happen right after text is delivered
        markSlotAlerted(slot.id);
        log.info(
          { slotId: slot.id, date: slot.date, time: slot.time, city: slot.city },
          'NEW SLOT DETECTED'
        );

        // BACKGROUND: send screenshot photo + email + desktop once screenshot resolves
        void screenshotCapture.then((screenshotPath) =>
          this.notifier.sendSlotFoundFollowUp(slot, providerConfig.name, screenshotPath ?? undefined)
        );
      }

      // ── 7. Stamp all current slots as "seen this cycle" ───────────────────
      // This establishes the baseline that the NEXT cycle will diff against.
      updateLastSeenBatch(current.map((s) => s.id));

      // ── 8. Alert on repeated provider errors ──────────────────────────────
      const recentErrors = countRecentErrors(providerConfig.id, 60);
      if (recentErrors >= providerConfig.maxConsecutiveErrors) {
        log.warn({ recentErrors }, 'Repeated errors threshold reached');
        await this.notifier.sendAlert(
          `[${providerConfig.name}] Repeated errors`,
          `${recentErrors} errors in the last 60 minutes. Manual check recommended.`
        );
      }
    } catch (err) {
      log.error({ err }, 'Unhandled error in provider cycle');
      await this.notifier.sendAlert(
        `[${providerConfig.name}] Unexpected error`,
        String(err)
      );
    } finally {
      await provider.close();
    }
  }

  /**
   * Best-effort screenshot capture — resolves to null on any failure.
   * Intentionally non-throwing so it never delays the critical alert path.
   */
  private async captureSlotScreenshot(
    provider: unknown,
    providerId: string
  ): Promise<string | null> {
    try {
      const p = provider as { session?: { page: import('playwright').Page } };
      if (p.session?.page) {
        return await captureScreenshot(p.session.page, providerId, 'slot_found');
      }
    } catch {
      // intentionally swallowed — screenshot is non-critical
    }
    return null;
  }

  /**
   * Filter slots against the user's date / time / location preferences.
   */
  private filterSlots(slots: Slot[], cfg: ProviderConfig): Slot[] {
    return slots.filter((slot) => {
      if (!cfg.targetCountries.includes(slot.country)) return false;
      if (cfg.preferredCities.length > 0 && !cfg.preferredCities.includes(slot.city)) return false;
      if (slot.visaCategory !== cfg.visaCategory) return false;

      const { earliest, latest } = cfg.dateRange;
      if (slot.date < earliest || slot.date > latest) return false;

      const hour = parseInt(slot.time.split(':')[0] ?? '0', 10);
      if (hour < cfg.timeRange.earliestHour || hour > cfg.timeRange.latestHour) return false;

      return true;
    });
  }
}
