import type { AppConfig, ProviderConfig } from '../types/config.types.js';
import { Engine } from './engine.js';
import { childLogger } from '../utils/logger.js';

interface Timer {
  providerId: string;
  handle: ReturnType<typeof setInterval>;
}

export class Scheduler {
  private engine: Engine;
  private timers: Timer[] = [];
  private log = childLogger({ component: 'scheduler' });

  constructor(config: AppConfig) {
    this.engine = new Engine(config);
  }

  start(config: AppConfig): void {
    const enabled = config.providers.filter((p) => p.enabled);

    if (enabled.length === 0) {
      this.log.warn('No enabled providers found — nothing to monitor');
      return;
    }

    // Her provider'ı ayrı ayrı zamanlıyoruz.
    // İlk çalışmayı stagger ediyoruz: her provider 10 saniye arayla başlıyor.
    // Böylece 19 provider aynı anda başlamıyor.
    enabled.forEach((providerConfig, index) => {
      this.scheduleProvider(providerConfig, index * 10_000);
    });

    this.log.info({ providers: enabled.map((p) => p.id) }, 'Scheduler started');
  }

  private scheduleProvider(providerConfig: ProviderConfig, initialDelayMs: number): void {
    const intervalMs = providerConfig.pollingIntervalSeconds * 1_000;
    const log = childLogger({ provider: providerConfig.id });

    log.info({ intervalMs }, 'Provider scheduled');

    // İlk çalışmayı stagger ile geciktir
    const startTimer = setTimeout(() => {
      void this.runSafe(providerConfig, log);

      const handle = setInterval(() => {
        void this.runSafe(providerConfig, log);
      }, intervalMs);

      handle.unref();
      this.timers.push({ providerId: providerConfig.id, handle });
    }, initialDelayMs);

    (startTimer as NodeJS.Timeout).unref?.();
  }

  private async runSafe(
    providerConfig: ProviderConfig,
    log: ReturnType<typeof childLogger>
  ): Promise<void> {
    try {
      // Her provider sadece KENDİSİNİ çalıştırıyor (runCycle değil)
      await this.engine.runProviderCycle(providerConfig);
    } catch (err) {
      log.error({ err, providerId: providerConfig.id }, 'Unhandled scheduler error');
    }
  }

  stop(): void {
    for (const t of this.timers) clearInterval(t.handle);
    this.timers = [];
    this.log.info('Scheduler stopped');
  }
}
