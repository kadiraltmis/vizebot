import { chromium } from 'playwright';

const email    = process.env.VFS_EMAIL ?? '';
const password = process.env.VFS_PASSWORD ?? '';
const tgToken  = process.env.TELEGRAM_BOT_TOKEN ?? '';
const tgChat   = process.env.TELEGRAM_CHAT_ID ?? '';

const browser = await chromium.connectOverCDP('http://localhost:9222');
const contexts = browser.contexts();
const context = contexts[0];
const pages = context.pages();
const page = pages[0];

console.log('URL:', page.url());

let capturedJwt = null;
page.on('response', async (response) => {
  try {
    const ct = response.headers()['content-type'] ?? '';
    if (ct.includes('json')) {
      const text = await response.text().catch(() => '');
      const m = text.match(/EAAAA[A-Za-z0-9+/=]{20,}/);
      if (m) { capturedJwt = m[0]; console.log('🎯 Response JWT:', capturedJwt.substring(0,30)+'...'); }
    }
  } catch {}
});

// Email alanını doldur
console.log('input#email dolduruluyor...');
const emailInput = page.locator('input#email');
await emailInput.waitFor({ state: 'visible', timeout: 5000 });
await emailInput.click();
await page.keyboard.press('Control+a');
await page.keyboard.press('Delete');
await page.keyboard.type(email, { delay: 80 });
console.log('Email girildi');
await page.waitForTimeout(500);

// Şifre kontrol
const pwVal = await page.$eval('input#password', el => el.value).catch(() => '');
console.log('Şifre alanı:', pwVal ? '✅ dolu' : '❌ boş');
if (!pwVal) {
  const pwInput = page.locator('input#password');
  await pwInput.click();
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Delete');
  await page.keyboard.type(password, { delay: 80 });
  console.log('Şifre girildi');
}

// Turnstile durumu
const cfVal = await page.$eval('input[name="cf-turnstile-response"]', el => el.value).catch(() => '');
console.log('Turnstile token:', cfVal ? '✅ ' + cfVal.substring(0,20) : '❌ yok — 20s bekleniyor');

if (!cfVal) {
  // Turnstile bekle
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(1000);
    const v = await page.$eval('input[name="cf-turnstile-response"]', el => el.value).catch(() => '');
    if (v) { console.log('✅ Turnstile çözüldü'); break; }
    process.stdout.write('.');
  }
}

// Buton durumu
const btnDisabled = await page.evaluate(() => {
  const btn = document.querySelector('button.btn-brand-orange');
  return btn ? btn.disabled : 'yok';
});
console.log('\nButon disabled:', btnDisabled);

// Submit
console.log('Form gönderiliyor...');
await page.evaluate(() => {
  const btn = document.querySelector('button.btn-brand-orange');
  if (btn) btn.click();
});

// JWT bekle
console.log('JWT bekleniyor (60s)...');
for (let i = 0; i < 60; i++) {
  await page.waitForTimeout(1000);
  const s = await page.evaluate(() => sessionStorage.getItem('JWT'));
  if (s) { capturedJwt = s; console.log('\n✅ sessionStorage JWT alındı'); break; }
  if (capturedJwt) break;
  process.stdout.write('.');
  
  // OTP var mı?
  if (i === 15) {
    const otp = await page.$('input[maxlength="6"], input[formcontrolname="otp"]');
    if (otp) {
      console.log('\n📱 OTP alanı bulundu!');
      // Telegram'a bildir
      await fetch(`https://api.telegram.org/bot${tgToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: tgChat, text: '📱 VFS OTP kodu isteniyor!\n/otp XXXXXX komutunu gönderin.' })
      });
      console.log('Telegram\'a OTP bildirimi gönderildi. Lütfen /otp XXXXXX gönderin.');
      // OTP bekle
      break;
    }
  }
}

if (capturedJwt) {
  console.log('\n✅ BAŞARILI! JWT:', capturedJwt.substring(0, 50) + '...');
  console.log('\nBu JWT\'yi .env dosyasına ekleyin:');
  console.log('VFS_JWT=' + capturedJwt);
} else {
  const url = page.url();
  console.log('\nSon URL:', url);
  const bodyText = await page.evaluate(() => document.body.innerText.substring(0, 300));
  console.log('Sayfa:', bodyText);
}

process.exit(0);
