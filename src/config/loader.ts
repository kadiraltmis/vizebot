import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import type { AppConfig } from '../types/config.types.js';

// ── Zod schema ─────────────────────────────────────────────────────────────────

const DateRangeSchema = z.object({
  earliest: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  latest: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const TimeRangeSchema = z.object({
  earliestHour: z.number().int().min(0).max(23),
  latestHour: z.number().int().min(0).max(23),
});

const TelegramSchema = z.object({
  botToken: z.string().min(1),
  chatId: z.string().min(1),
  chatIds: z.array(z.string().min(1)).optional(),
});

const EmailSchema = z.object({
  host: z.string(),
  port: z.number(),
  secure: z.boolean(),
  user: z.string(),
  password: z.string(),
  to: z.string(),
});

const NotificationSchema = z.object({
  telegram: TelegramSchema.optional(),
  email: EmailSchema.optional(),
  desktop: z.boolean().default(false),
});

const ProviderSchema = z.object({
  id: z.string(),
  name: z.string(),
  enabled: z.boolean(),
  baseUrl: z.string().url(),
  targetCountries: z.array(z.string()),
  preferredCities: z.array(z.string()),
  visaCategory: z.string(),
  dateRange: DateRangeSchema,
  timeRange: TimeRangeSchema,
  pollingIntervalSeconds: z.number().min(10),
  maxConsecutiveErrors: z.number().int().min(1),
});

const AppConfigSchema = z.object({
  providers: z.array(ProviderSchema),
  notifications: NotificationSchema,
});

// ── Loader ─────────────────────────────────────────────────────────────────────

export function loadConfig(): AppConfig {
  const configPath = path.resolve(process.cwd(), 'config', 'config.json');

  // Railway gibi production ortamlarında config dosyası yerine doğrudan env değişkenlerini kullan
  const botToken = process.env['TELEGRAM_BOT_TOKEN'];
  const chatId = process.env['TELEGRAM_CHAT_ID'];

  // Eğer config.json yok ama TELEGRAM_BOT_TOKEN var ise, minimal config oluştur
  if (!fs.existsSync(configPath) && botToken && chatId) {
    return {
      providers: [
        {
          id: 'vfs-global-tur-che',
          name: 'VFS Global Turkey → Switzerland',
          enabled: true,
          baseUrl: 'https://visa.vfsglobal.com/tur/tr/che',
          targetCountries: ['CH'],
          preferredCities: [],
          visaCategory: 'Family',
          dateRange: { earliest: '2026-04-17', latest: '2026-12-31' },
          timeRange: { earliestHour: 8, latestHour: 18 },
          pollingIntervalSeconds: 60,
          maxConsecutiveErrors: 3,
        },
      ],
      notifications: {
        desktop: false,
        telegram: { botToken, chatId },
      },
    };
  }


  if (!fs.existsSync(configPath)) {
    throw new Error(
      `Config file not found at ${configPath}. ` +
      `Copy config/config.example.json → config/config.json and fill in your settings.`
    );
  }

  const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as unknown;

  // Merge Telegram credentials from environment (overrides config.json values)
  if (typeof raw === 'object' && raw !== null) {
    const r = raw as Record<string, unknown>;
    if (!r['notifications']) r['notifications'] = {};
    const notif = r['notifications'] as Record<string, unknown>;

    const botToken = process.env['TELEGRAM_BOT_TOKEN'];
    const chatId = process.env['TELEGRAM_CHAT_ID'];
    const groupIds = process.env['TELEGRAM_GROUP_CHAT_IDS'];

    if (botToken && chatId) {
      const extra = groupIds
        ? groupIds.split(',').map((s) => s.trim()).filter(Boolean)
        : undefined;
      notif['telegram'] = { botToken, chatId, ...(extra?.length ? { chatIds: extra } : {}) };
    }
  }

  const result = AppConfigSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(`Invalid config: ${result.error.message}`);
  }

  return result.data as AppConfig;
}
