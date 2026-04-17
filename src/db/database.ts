// @ts-expect-error node:sqlite types not yet in @types/node
import { DatabaseSync } from 'node:sqlite';
import path from 'path';
import fs from 'fs';
import { logger } from '../utils/logger.js';

const DB_DIR = path.resolve(process.cwd(), 'artifacts');
const DB_PATH = path.join(DB_DIR, 'visa-monitor.db');

let _db: DatabaseSync | null = null;

export function getDb(): DatabaseSync {
  if (_db) return _db;

  if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

  _db = new DatabaseSync(DB_PATH);
  _db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

  runMigrations(_db);
  logger.info({ dbPath: DB_PATH }, 'SQLite database opened');

  return _db;
}

export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}

function runMigrations(db: DatabaseSync): void {
  // ── Initial schema ─────────────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS slots (
      id             TEXT PRIMARY KEY,
      providerId     TEXT NOT NULL,
      country        TEXT NOT NULL,
      city           TEXT NOT NULL,
      consulate      TEXT NOT NULL,
      date           TEXT NOT NULL,
      time           TEXT NOT NULL,
      visaCategory   TEXT NOT NULL,
      availableSeats INTEGER NOT NULL DEFAULT 0,
      bookingUrl     TEXT NOT NULL DEFAULT '',
      rawData        TEXT NOT NULL DEFAULT '{}',
      detectedAt     TEXT NOT NULL,
      status         TEXT NOT NULL DEFAULT 'detected',
      last_seen_at   TEXT,
      alertedAt      TEXT,
      updatedAt      TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS errors (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      providerId     TEXT NOT NULL,
      occurredAt     TEXT NOT NULL,
      message        TEXT NOT NULL,
      screenshotPath TEXT,
      htmlPath       TEXT
    );
  `);

  // ── Incremental migrations (idempotent) ────────────────────────────────────
  // Add last_seen_at to databases created before this column existed.
  try {
    db.exec('ALTER TABLE slots ADD COLUMN last_seen_at TEXT;');
  } catch {
    // Column already exists — OK
  }

  // Index for fast state-comparison queries
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_slots_provider_last_seen
      ON slots (providerId, last_seen_at);
  `);
}
