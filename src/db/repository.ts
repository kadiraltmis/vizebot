import { getDb } from './database.js';
import type { Slot } from '../types/slot.types.js';

function now(): string {
  return new Date().toISOString();
}

// ─── Slots ────────────────────────────────────────────────────────────────────

export function upsertSlot(slot: Slot): void {
  const db = getDb();
  const existing = db.prepare('SELECT id FROM slots WHERE id = :id').get({ id: slot.id });

  if (!existing) {
    db.prepare(`
      INSERT INTO slots
        (id, providerId, country, city, consulate, date, time, visaCategory,
         availableSeats, bookingUrl, rawData, detectedAt, status, last_seen_at, alertedAt, updatedAt)
      VALUES
        (:id, :providerId, :country, :city, :consulate, :date, :time, :visaCategory,
         :availableSeats, :bookingUrl, :rawData, :detectedAt, 'detected', NULL, NULL, :updatedAt)
    `).run({
      id: slot.id,
      providerId: slot.providerId,
      country: slot.country,
      city: slot.city,
      consulate: slot.consulate,
      date: slot.date,
      time: slot.time,
      visaCategory: slot.visaCategory,
      availableSeats: slot.availableSeats,
      bookingUrl: slot.bookingUrl,
      rawData: JSON.stringify(slot.rawData),
      detectedAt: slot.detectedAt,
      updatedAt: now(),
    });
  } else {
    // Update seat count on subsequent sightings
    db.prepare(`
      UPDATE slots SET availableSeats = :seats, updatedAt = :updatedAt WHERE id = :id
    `).run({ seats: slot.availableSeats, updatedAt: now(), id: slot.id });
  }
}

/**
 * Return IDs of slots that were visible during the PREVIOUS polling cycle.
 *
 * A slot is considered "previously visible" if its last_seen_at timestamp
 * falls within the grace window: now - (pollingInterval * 1.5).
 * The 1.5× multiplier absorbs timing jitter between cycles.
 */
export function getPreviouslyVisibleSlotIds(
  providerId: string,
  pollingIntervalMs: number
): Set<string> {
  const since = new Date(Date.now() - pollingIntervalMs * 1.5).toISOString();
  const rows = getDb()
    .prepare('SELECT id FROM slots WHERE providerId = :providerId AND last_seen_at >= :since')
    .all({ providerId, since }) as Array<{ id: string }>;
  return new Set(rows.map((r) => r.id));
}

/**
 * Mark all currently-visible slot IDs as seen RIGHT NOW.
 * Called after processing each cycle — establishes the baseline for
 * the NEXT cycle's state comparison.
 */
export function updateLastSeenBatch(slotIds: string[]): void {
  if (slotIds.length === 0) return;
  const db = getDb();
  const ts = now();
  db.exec('BEGIN');
  const stmt = db.prepare(
    'UPDATE slots SET last_seen_at = :ts, updatedAt = :ts WHERE id = :id'
  );
  for (const id of slotIds) {
    stmt.run({ ts, id });
  }
  db.exec('COMMIT');
}

/** Mark a slot as alerted (for audit trail). Does NOT affect dedup logic. */
export function markSlotAlerted(slotId: string): void {
  getDb().prepare(`
    UPDATE slots SET status = 'alerted', alertedAt = :alertedAt, updatedAt = :updatedAt WHERE id = :id
  `).run({ alertedAt: now(), updatedAt: now(), id: slotId });
}

// ─── Errors ───────────────────────────────────────────────────────────────────

export function logError(
  providerId: string,
  message: string,
  screenshotPath?: string,
  htmlPath?: string
): void {
  getDb().prepare(`
    INSERT INTO errors (providerId, occurredAt, message, screenshotPath, htmlPath)
    VALUES (:providerId, :occurredAt, :message, :screenshotPath, :htmlPath)
  `).run({
    providerId,
    occurredAt: now(),
    message,
    screenshotPath: screenshotPath ?? null,
    htmlPath: htmlPath ?? null,
  });
}

export function countRecentErrors(providerId: string, sinceMinutes: number): number {
  const since = new Date(Date.now() - sinceMinutes * 60_000).toISOString();
  const row = getDb()
    .prepare(
      'SELECT COUNT(*) AS cnt FROM errors WHERE providerId = :providerId AND occurredAt >= :since'
    )
    .get({ providerId, since }) as { cnt: number } | undefined;
  return row?.cnt ?? 0;
}
