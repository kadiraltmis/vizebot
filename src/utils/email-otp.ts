/**
 * Gmail IMAP üzerinden VFS OTP kodunu otomatik çeker.
 *
 * Gereksinimler:
 *   - Google hesabında 2FA aktif olmalı
 *   - .env'de GMAIL_APP_PASSWORD tanımlı olmalı (Google App Password)
 *
 * App Password oluşturma:
 *   myaccount.google.com → Güvenlik → 2 Adımlı Doğrulama → Uygulama Şifreleri
 */

import { ImapFlow } from 'imapflow';
import { childLogger } from './logger.js';

const log = childLogger({ component: 'email-otp' });

interface GmailConfig {
  user: string;        // Gmail adresi
  appPassword: string; // Google App Password (boşluksuz 16 karakter)
}

/**
 * VFS OTP mailini bekler ve kodu döndürür.
 * @param timeoutMs Maksimum bekleme süresi (varsayılan: 5 dakika)
 */
export async function waitForEmailOtp(timeoutMs = 5 * 60 * 1000): Promise<string | null> {
  const user = process.env.GMAIL_USER ?? process.env.VFS_EMAIL ?? '';
  const appPassword = process.env.GMAIL_APP_PASSWORD ?? '';

  if (!appPassword) {
    log.warn('GMAIL_APP_PASSWORD tanımlı değil — email OTP devre dışı');
    return null;
  }

  const config: GmailConfig = { user, appPassword };
  const deadline = Date.now() + timeoutMs;
  const pollIntervalMs = 8_000;

  log.info({ user }, 'Email OTP bekleniyor...');

  while (Date.now() < deadline) {
    const otp = await fetchLatestVfsOtp(config);
    if (otp) {
      log.info({ otp }, 'Email OTP alındı');
      return otp;
    }
    const remaining = deadline - Date.now();
    if (remaining > pollIntervalMs) {
      await sleep(pollIntervalMs);
    } else {
      break;
    }
  }

  log.warn('Email OTP zaman aşımına uğradı');
  return null;
}

/**
 * Son 10 dakika içinde gelen VFS OTP maillerini tarar.
 */
async function fetchLatestVfsOtp(cfg: GmailConfig): Promise<string | null> {
  const client = new ImapFlow({
    host: 'imap.gmail.com',
    port: 993,
    secure: true,
    auth: {
      user: cfg.user,
      pass: cfg.appPassword,
    },
    // TLS sertifika doğrulaması aktif (MITM koruması) — secure: true zaten TLS sağlıyor
    // tls: { rejectUnauthorized: false } kaldırıldı
    logger: false,
  });

  try {
    await client.connect();
    await client.mailboxOpen('INBOX');

    // Son 10 dakika içinde gelen, okunmamış mailler
    const since = new Date(Date.now() - 10 * 60 * 1000);
    const result = await client.search({ since, seen: false });
    const messages = Array.isArray(result) ? result : [];

    if (messages.length === 0) {
      return null;
    }

    // En yeni mailden başla
    const uids = messages.slice(-5).reverse();

    for (const uid of uids) {
      const msg = await client.fetchOne(uid.toString(), { source: true });
      if (!msg || !('source' in msg) || !msg.source) continue;

      const text = (msg.source as Buffer).toString('utf-8');

      // VFS maili mi?
      const isVfsMail =
        text.toLowerCase().includes('vfsglobal') ||
        text.toLowerCase().includes('vfs global') ||
        text.toLowerCase().includes('one-time password') ||
        text.toLowerCase().includes('tek seferlik');

      if (!isVfsMail) continue;

      // OTP'yi çek: 4-8 haneli sayı
      const otpMatch =
        text.match(/\b([0-9]{6})\b/) ??
        text.match(/OTP[^0-9]*([0-9]{4,8})/i) ??
        text.match(/code[^0-9]*([0-9]{4,8})/i) ??
        text.match(/password[^0-9]*([0-9]{4,8})/i) ??
        text.match(/şifre[^0-9]*([0-9]{4,8})/i);

      if (otpMatch?.[1]) {
        // Maili okundu olarak işaretle
        await client.messageFlagsAdd(uid.toString(), ['\\Seen']).catch(() => {});
        return otpMatch[1];
      }
    }

    return null;
  } catch (err) {
    log.warn({ err }, 'IMAP bağlantı hatası');
    return null;
  } finally {
    await client.logout().catch(() => {});
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
