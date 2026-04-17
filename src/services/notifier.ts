import fs from 'fs';
import path from 'path';
import nodemailer from 'nodemailer';
import notifier from 'node-notifier';
import type { NotificationConfig } from '../types/config.types.js';
import type { Slot } from '../types/slot.types.js';
import { childLogger } from '../utils/logger.js';
import type { Logger } from 'pino';

export class Notifier {
  private config: NotificationConfig;
  private log: Logger;

  constructor(config: NotificationConfig) {
    this.config = config;
    this.log = childLogger({ component: 'notifier' });
  }

  // ── CRITICAL PATH ─────────────────────────────────────────────────────────
  // Call this first, await it, then fire sendSlotFoundFollowUp in background.
  // Target: Telegram text delivered within 1 second of slot detection.

  async sendSlotFoundText(slot: Slot, providerName: string): Promise<void> {
    const cfg = this.config.telegram;
    if (!cfg) return;

    const text = this.buildMarkdownMessage(slot, providerName);
    const targets = this.allChatIds(cfg);

    const sends = targets.map((id) => this.postTelegramMessage(cfg.botToken, id, text));

    // OpenClaw botu da gönder
    const openclawToken = process.env.OPENCLAW_BOT_TOKEN;
    if (openclawToken) {
      targets.forEach((id) => sends.push(this.postTelegramMessage(openclawToken, id, text)));
    }

    await Promise.all(sends);
  }

  // ── BACKGROUND PATH ──────────────────────────────────────────────────────
  // Fire-and-forget after the critical text is sent.
  // Handles: screenshot photo, email, desktop popup.

  async sendSlotFoundFollowUp(
    slot: Slot,
    providerName: string,
    screenshotPath?: string
  ): Promise<void> {
    const cfg = this.config.telegram;
    const plain = this.buildPlainMessage(slot, providerName);

    const targets = cfg ? this.allChatIds(cfg) : [];
    await Promise.allSettled([
      ...(cfg && screenshotPath && fs.existsSync(screenshotPath)
        ? targets.map((id) =>
            this.sendTelegramPhoto(`https://api.telegram.org/bot${cfg.botToken}`, id, screenshotPath)
          )
        : [Promise.resolve()]),
      this.sendEmail(`SLOT FOUND – ${slot.country} ${slot.city} ${slot.date}`, plain),
      this.sendDesktop('SLOT FOUND!', `${slot.city} – ${slot.date} at ${slot.time}`),
    ]);
  }

  // ── System / error alerts ─────────────────────────────────────────────────

  async sendAlert(title: string, message: string): Promise<void> {
    const cfg = this.config.telegram;
    const text = `⚠️ ${title}\n\n${message}`;
    const targets = cfg ? this.allChatIds(cfg) : [];
    const openclawToken = process.env.OPENCLAW_BOT_TOKEN;

    await Promise.allSettled([
      ...targets.map((id) =>
        cfg ? this.postTelegramPlain(cfg.botToken, id, text) : Promise.resolve()
      ),
      ...(openclawToken
        ? targets.map((id) => this.postTelegramPlain(openclawToken, id, text))
        : []),
      this.sendEmail(title, message),
      this.sendDesktop(title, message),
    ]);
  }

  // ── Message builders ──────────────────────────────────────────────────────

  private buildMarkdownMessage(slot: Slot, providerName: string): string {
    const ts = new Date().toLocaleString('tr-TR', { hour12: false });
    return [
      '🚨 *SLOT FOUND!*',
      '',
      `🌍 *Country:* ${slot.country}`,
      `🏙️ *City:* ${slot.city}`,
      `🏛️ *Consulate:* ${slot.consulate}`,
      `📅 *Date:* ${slot.date}`,
      `⏰ *Time:* ${slot.time}`,
      `🎫 *Visa:* ${slot.visaCategory}`,
      `💺 *Seats:* ${slot.availableSeats}`,
      '',
      `🔗 [Book Now](${slot.bookingUrl})`,
      '',
      `⏱️ ${ts}  |  📡 ${providerName}`,
    ].join('\n');
  }

  private buildPlainMessage(slot: Slot, providerName: string): string {
    return [
      'SLOT FOUND!',
      `Country: ${slot.country}`,
      `City: ${slot.city}`,
      `Consulate: ${slot.consulate}`,
      `Date: ${slot.date}`,
      `Time: ${slot.time}`,
      `Visa: ${slot.visaCategory}`,
      `Seats: ${slot.availableSeats}`,
      `Book: ${slot.bookingUrl}`,
      `Provider: ${providerName}`,
      `Detected: ${new Date().toISOString()}`,
    ].join('\n');
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private allChatIds(cfg: NonNullable<typeof this.config.telegram>): string[] {
    const extra = cfg.chatIds ?? [];
    return [cfg.chatId, ...extra.filter((id) => id !== cfg.chatId)];
  }

  // ── Telegram ──────────────────────────────────────────────────────────────

  private async postTelegramMessage(
    botToken: string,
    chatId: string,
    text: string
  ): Promise<void> {
    try {
      const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: 'Markdown',
          disable_web_page_preview: false,
        }),
      });

      if (res.ok) {
        this.log.info('Telegram text sent');
      } else {
        const err = await res.text();
        this.log.error({ status: res.status, err }, 'Telegram sendMessage failed');
      }
    } catch (err) {
      this.log.error({ err }, 'Telegram network error');
    }
  }

  private async postTelegramPlain(botToken: string, chatId: string, text: string): Promise<void> {
    try {
      const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text }),
      });
      if (!res.ok) {
        const err = await res.text();
        this.log.error({ status: res.status, err }, 'Telegram alert failed');
      }
    } catch (err) {
      this.log.error({ err }, 'Telegram alert network error');
    }
  }

  private async sendTelegramPhoto(
    base: string,
    chatId: string,
    filePath: string
  ): Promise<void> {
    try {
      const buffer = fs.readFileSync(filePath);
      const form = new FormData();
      form.append('chat_id', chatId);
      form.append('photo', new Blob([buffer], { type: 'image/png' }), path.basename(filePath));
      form.append('caption', '📸 Screenshot at detection time');

      const res = await fetch(`${base}/sendPhoto`, { method: 'POST', body: form });
      if (res.ok) {
        this.log.info('Telegram screenshot sent');
      } else {
        this.log.warn({ status: res.status }, 'Telegram sendPhoto failed');
      }
    } catch (err) {
      this.log.warn({ err }, 'Telegram screenshot error (non-critical)');
    }
  }

  // ── Email ─────────────────────────────────────────────────────────────────

  private async sendEmail(subject: string, text: string): Promise<void> {
    const cfg = this.config.email;
    if (!cfg) return;

    try {
      const transport = nodemailer.createTransport({
        host: cfg.host,
        port: cfg.port,
        secure: cfg.secure,
        auth: { user: cfg.user, pass: cfg.password },
      });
      await transport.sendMail({
        from: cfg.user,
        to: cfg.to,
        subject: `[VisaMonitor] ${subject}`,
        text,
      });
      this.log.info({ to: cfg.to }, 'Email sent');
    } catch (err) {
      this.log.error({ err }, 'Email error');
    }
  }

  // ── Desktop ───────────────────────────────────────────────────────────────

  private sendDesktop(title: string, message: string): Promise<void> {
    if (!this.config.desktop) return Promise.resolve();
    return new Promise((resolve) => {
      notifier.notify({ title, message, sound: true }, () => resolve());
    });
  }
}
