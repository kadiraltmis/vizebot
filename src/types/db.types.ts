import type { SlotStatus } from './slot.types.js';

export interface SlotRecord {
  id: string;
  providerId: string;
  country: string;
  city: string;
  consulate: string;
  date: string;
  time: string;
  visaCategory: string;
  availableSeats: number;
  bookingUrl: string;
  rawData: string;        // JSON string
  detectedAt: string;
  status: SlotStatus;
  last_seen_at: string | null;  // updated every cycle the slot is visible
  alertedAt: string | null;
  updatedAt: string;
}

export interface ErrorRecord {
  id: number;
  providerId: string;
  occurredAt: string;
  message: string;
  screenshotPath: string | null;
  htmlPath: string | null;
}
