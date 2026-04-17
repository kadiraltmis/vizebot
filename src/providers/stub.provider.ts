import { createHash } from 'crypto';
import type { ProviderConfig } from '../types/config.types.js';
import type { Slot } from '../types/slot.types.js';
import type { ProviderAdapter } from '../types/provider.types.js';
import { childLogger } from '../utils/logger.js';

/**
 * Stub provider — for testing the alert pipeline without a real website.
 * Returns one fake slot on the FIRST call, then empty on subsequent calls.
 * This validates that the dedup logic fires exactly once.
 */
export class StubProvider implements ProviderAdapter {
  readonly providerId: string;
  private callCount = 0;
  private log;

  constructor(config: ProviderConfig) {
    this.providerId = config.id;
    this.log = childLogger({ provider: config.id });
  }

  async checkAvailability(): Promise<Slot[]> {
    this.callCount++;
    this.log.debug({ callCount: this.callCount }, 'Stub provider called');

    if (this.callCount !== 1) return [];

    const slot: Slot = {
      id: createHash('sha256')
        .update('stub|Netherlands|Amsterdam|2025-09-15|09:00')
        .digest('hex')
        .slice(0, 16),
      providerId: this.providerId,
      country: 'Netherlands',
      city: 'Amsterdam',
      consulate: 'VFS Global Amsterdam',
      date: '2025-09-15',
      time: '09:00',
      visaCategory: 'Schengen Visa',
      availableSeats: 2,
      bookingUrl: 'https://visa.vfsglobal.com/tur/en/nld/book-an-appointment',
      rawData: { source: 'stub' },
      detectedAt: new Date().toISOString(),
    };

    this.log.info({ slotId: slot.id }, 'Stub returning fake slot');
    return [slot];
  }

  async close(): Promise<void> {
    // no browser to close
  }
}
