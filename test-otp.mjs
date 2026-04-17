import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';

const tgToken = process.env.TELEGRAM_BOT_TOKEN ?? '';
const tgChat  = process.env.TELEGRAM_CHAT_ID ?? '';

// Telegram'dan son OTP mesajını al
async function getLatestOtp() {
  const res = await fetch(`https://api.telegram.org/bot${tgToken}/getUpdates?limit=20`);
  const data = await res.json();
  const messages = (data.result ?? [])
    .filter(u => u.message?.chat?.id === parseInt(tgChat))
    .map(u => u.message.text ?? '')
    .reverse();

  for (const text of messages) {
    const m = text.match(/\/otp\s+(\d{4,8})/i) ?? text.match(/^(\d{4,8})$/);
    if (m) return m[1];
  }
  return null;
}

const otp = await getLatestOtp();
console.log('Telegram OTP:', otp ?? 'BULUNAMADI');

if (!otp) {
  console.log('OTP yok — lütfen /otp XXXXXX gönderin');
  process.exit(1);
}

const browser = await chromium.connectOverCDP('http://localhost:9222');
const contexts = browser.contexts();
const context = contexts[0];
const page = context.pages()[0];

console.log('Sayfa URL:', page.url());

// JWT yakalama
let capturedJwt = null;
page.on('response', async (response) => {
  try {
    const ct = response.headers()['content-type'] ?? '';
    if (ct.includes('json')) {
      const text = await response.text().catch(() => '');
      const m = text.match(/EAAAA[A-Za-z0-9+/=]{20,}/);
      if (m) { capturedJwt = m[0]; }
    }
  } catch {}
});

// OTP alanını doldur
console.log('OTP dolduruluyor...');
const otpInput = page.locator('input[maxlength="6"], input[formcontrolname="otp"], input[placeholder*="OTP"], input[placeholder*="şifre"]').first();
await otpInput.waitFor({ state: 'visible', timeout: 10000 });
await otpInput.click();
await page.keyboard.press('Control+a');
await page.keyboard.press('Delete');
await page.keyboard.type(otp, { delay: 100 });
console.log('OTP girildi:', otp);
await page.waitForTimeout(500);

// Submit
await page.evaluate(() => {
  const btn = document.querySelector('button[type="submit"], button.btn-brand-orange');
  if (btn) btn.click();
});
console.log('Submit tıklandı');

// JWT bekle
console.log('JWT bekleniyor...');
for (let i = 0; i < 30; i++) {
  await page.waitForTimeout(1000);
  const s = await page.evaluate(() => sessionStorage.getItem('JWT'));
  if (s) { capturedJwt = s; break; }
  if (capturedJwt) break;
  process.stdout.write('.');
}

if (capturedJwt) {
  console.log('\n✅ JWT alındı!');

  // .env dosyasını güncelle
  const envPath = '.env';
  let envContent = readFileSync(envPath, 'utf-8');
  if (envContent.includes('VFS_JWT=')) {
    envContent = envContent.replace(/VFS_JWT=.*/g, `VFS_JWT=${capturedJwt}`);
  } else {
    envContent += `\nVFS_JWT=${capturedJwt}`;
  }
  writeFileSync(envPath, envContent);

  // JWT cache dosyasına da yaz
  mkdirSync('artifacts/sessions', { recursive: true });
  writeFileSync('artifacts/sessions/vfs-jwt.txt', capturedJwt);

  console.log('JWT .env ve artifacts/sessions/vfs-jwt.txt dosyalarına kaydedildi');
  console.log('JWT başlangıcı:', capturedJwt.substring(0, 50) + '...');
} else {
  const url = page.url();
  console.log('\nSon URL:', url);
  const body = await page.evaluate(() => document.body.innerText.substring(0, 400));
  console.log('Sayfa:', body);
}

process.exit(0);
