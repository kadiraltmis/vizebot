/**
 * Telegram bildirimini test eder — sahte slot bulunmuş gibi mesaj gönderir
 */
import 'dotenv/config';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

if (!BOT_TOKEN || !CHAT_ID) {
  console.error('TELEGRAM_BOT_TOKEN veya TELEGRAM_CHAT_ID .env\'de tanımlı değil');
  process.exit(1);
}

const text = [
  '🚨 *SLOT FOUND\\!*',
  '',
  '🌍 *Country:* Switzerland',
  '🏙️ *City:* Ankara',
  '🏛️ *Consulate:* VFS Global Ankara \\(ESB\\)',
  '📅 *Date:* 2026\\-05\\-10',
  '⏰ *Time:* 09:00',
  '🎫 *Visa:* TOR \\(Turistik\\)',
  '💺 *Seats:* 1',
  '',
  '🔗 [Randevu Al](https://visa.vfsglobal.com/tur/tr/che/application-detail)',
  '',
  '⏱️ TEST MESAJI \\— Visa Monitor çalışıyor',
].join('\n');

const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
const resp = await fetch(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    chat_id: CHAT_ID,
    text,
    parse_mode: 'MarkdownV2',
    disable_web_page_preview: false,
  }),
});

const result = await resp.json();
if (result.ok) {
  console.log('✅ Telegram mesajı gönderildi! message_id:', result.result.message_id);
} else {
  console.error('❌ Telegram hatası:', JSON.stringify(result));
}
process.exit(result.ok ? 0 : 1);
