export interface Slot {
  id: string;
  providerId: string;
  country: string;
  city: string;
  consulate: string;
  date: string;       // YYYY-MM-DD
  time: string;       // HH:MM
  visaCategory: string;
  availableSeats: number;
  bookingUrl: string;
  rawData: Record<string, unknown>;
  detectedAt: string; // ISO timestamp
}

export type SlotStatus = 'detected' | 'alerted' | 'gone';
