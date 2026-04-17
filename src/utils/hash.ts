import { createHash } from 'crypto';

/**
 * Deterministic slot ID — same slot detected in different cycles produces the same ID.
 * Composite key: providerId + country + city + date + time + visaCategory
 */
export function buildSlotId(
  providerId: string,
  country: string,
  city: string,
  date: string,
  time: string,
  visaCategory: string
): string {
  return createHash('sha256')
    .update([providerId, country, city, date, time, visaCategory].join('|'))
    .digest('hex')
    .slice(0, 16);
}
