/**
 * Telegram üzerinden OTP bekler.
 *
 * Kullanım:
 *   1. Bot'a "OTP bekleniyor" mesajı gönder (çağıran taraf)
 *   2. waitForOtp() çağır — kullanıcı /otp 123456 yazana kadar bloklanır
 *   3. Kullanıcı Telegram'da botun chatine /otp 123456 veya sadece 123456 yazar
 *   4. Fonksiyon kodu döndürür
 *
 * Long-polling kullanır, webhook sunucusu gerektirmez.
 */

const POLL_TIMEOUT_SECONDS = 30;

interface TelegramUpdate {
  update_id: number;
  message?: {
    text?: string;
    chat?: { id: number };
  };
}

/**
 * Telegram bot getUpdates ile long-poll yaparak OTP bekler.
 * @param botToken  Telegram bot token
 * @param chatId    Beklenen chat ID (string veya number)
 * @param timeoutMs Toplam bekleme süresi (ms). Default: 10 dakika.
 * @returns OTP kodu (string, sadece rakamlar)
 */
export async function waitForOtp(
  botToken: string,
  chatId: string | number,
  timeoutMs = 10 * 60 * 1000
): Promise<string> {
  const base = `https://api.telegram.org/bot${botToken}`;
  const deadline = Date.now() + timeoutMs;
  let offset: number | undefined;

  // Mevcut update'leri temizle (eski mesajları yoksay)
  const initRes = await fetch(`${base}/getUpdates?limit=100&timeout=0`).catch(() => null);
  if (initRes?.ok) {
    const initData = await initRes.json() as { result?: TelegramUpdate[] };
    if (initData.result?.length) {
      offset = initData.result[initData.result.length - 1]!.update_id + 1;
    }
  }

  while (Date.now() < deadline) {
    const remaining = Math.floor((deadline - Date.now()) / 1000);
    const pollTimeout = Math.min(POLL_TIMEOUT_SECONDS, remaining);
    if (pollTimeout <= 0) break;

    const url = `${base}/getUpdates?timeout=${pollTimeout}${offset !== undefined ? `&offset=${offset}` : ''}`;

    let updates: TelegramUpdate[] = [];
    try {
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json() as { result?: TelegramUpdate[] };
        updates = data.result ?? [];
      }
    } catch {
      // Ağ hatası — kısa bekleyip tekrar dene
      await new Promise(r => setTimeout(r, 2_000));
      continue;
    }

    for (const upd of updates) {
      offset = upd.update_id + 1;

      const msg = upd.message;
      if (!msg?.text) continue;

      // Sadece beklenen chat'ten gelen mesajları kabul et
      if (chatId && String(msg.chat?.id) !== String(chatId)) continue;

      const text = msg.text.trim();

      // /otp 123456 veya sadece 123456
      const match = text.match(/^(?:\/otp\s+)?(\d{4,8})$/i);
      if (match) {
        return match[1]!;
      }
    }
  }

  throw new Error(`OTP ${Math.floor(timeoutMs / 60_000)} dakika içinde alınamadı.`);
}

/**
 * Telegram'a plain text mesaj gönderir (notifier bağımlılığı olmadan).
 */
export async function sendTelegramMessage(
  botToken: string,
  chatId: string | number,
  text: string
): Promise<void> {
  await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text }),
  }).catch(() => undefined);
}
