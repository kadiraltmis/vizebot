import type { Slot } from './slot.types.js';

export interface ProviderAdapter {
  readonly providerId: string;
  checkAvailability(): Promise<Slot[]>;
  close(): Promise<void>;
}
