import { ImapFlow } from 'imapflow';

const user = process.env.VFS_EMAIL;
const pass = process.env.GMAIL_APP_PASSWORD;

console.log('IMAP bağlanılıyor:', user);
console.log('App Password:', pass ? pass.substring(0,4) + '...' : 'YOK');

const client = new ImapFlow({
  host: 'imap.gmail.com',
  port: 993,
  secure: true,
  auth: { user, pass },
  tls: { rejectUnauthorized: false },
  logger: false,
});

try {
  await client.connect();
  console.log('✅ IMAP bağlantısı başarılı');

  await client.mailboxOpen('INBOX');
  console.log('✅ INBOX açıldı');

  // Son 30 dakikadaki TÜM mailler
  const since = new Date(Date.now() - 30 * 60 * 1000);
  const result = await client.search({ since });
  const messages = Array.isArray(result) ? result : [];
  console.log(`Son 30 dakikada ${messages.length} mail var`);

  // Son 5 maili listele
  const uids = messages.slice(-5).reverse();
  for (const uid of uids) {
    const msg = await client.fetchOne(uid.toString(), { envelope: true });
    if (msg && 'envelope' in msg) {
      const env = msg.envelope;
      console.log(`  - [${uid}] Gönderen: ${env.from?.[0]?.address} | Konu: ${env.subject}`);
    }
  }

  // VFS maili ara
  console.log('\nVFS maili aranıyor...');
  const allResult = await client.search({ since: new Date(Date.now() - 60 * 60 * 1000) });
  const allMessages = Array.isArray(allResult) ? allResult : [];

  for (const uid of [...allMessages].reverse().slice(0, 10)) {
    const msg = await client.fetchOne(uid.toString(), { source: true });
    if (!msg || !('source' in msg) || !msg.source) continue;
    const text = msg.source.toString('utf-8');
    if (text.toLowerCase().includes('vfs') || text.toLowerCase().includes('otp') || text.toLowerCase().includes('one-time')) {
      console.log(`✅ VFS maili bulundu! UID: ${uid}`);
      const otpMatch = text.match(/\b([0-9]{6})\b/);
      if (otpMatch) console.log('OTP kodu:', otpMatch[1]);
      else console.log('OTP kodu bulunamadı — mail içeriği:', text.substring(0, 300));
      break;
    }
  }

} catch (err) {
  console.error('❌ Hata:', err.message);
} finally {
  await client.logout().catch(() => {});
}
