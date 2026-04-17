import { chromium } from 'playwright';

const email    = process.env.VFS_EMAIL ?? '';
const password = process.env.VFS_PASSWORD ?? '';
const tgToken  = process.env.TELEGRAM_BOT_TOKEN ?? '';
const tgChat   = process.env.TELEGRAM_CHAT_ID ?? '';

console.log('Email:', email);
console.log('Telegram token:', tgToken ? '✅ var' : '❌ yok');

const browser = await chromium.connectOverCDP('http://localhost:9222');
const contexts = browser.contexts();
const context = contexts[0] ?? await browser.newContext();
const pages = context.pages();
const page = pages.length > 0 ? pages[0] : await context.newPage();

// JWT değişkeni dışarıda tanımla
let capturedJwt = null;

// Network response interceptor — JWT'yi yakala
page.on('response', async (response) => {
  try {
    const ct = response.headers()['content-type'] ?? '';
    if (ct.includes('json')) {
      const text = await response.text().catch(() => '');
      if (text.includes('EAAAA') || text.includes('"JWT"')) {
        const m = text.match(/EAAAA[A-Za-z0-9+/=]{20,}/);
        if (m) {
          capturedJwt = m[0];
          console.log('🎯 JWT yakalandı:', capturedJwt.substring(0, 30) + '...');
        }
      }
    }
  } catch {}
});

console.log('Login sayfasına gidiliyor...');
await page.goto('https://visa.vfsglobal.com/tur/tr/che/login', {
  waitUntil: 'domcontentloaded',
  timeout: 30000
});

// Cloudflare bekle
console.log('Cloudflare bekleniyor...');
await page.waitForTimeout(5000);

// Cookie banner
try {
  const btn = page.locator('button:has-text("Tümüne İzin Ver"), button:has-text("Accept All")').first();
  if (await btn.count() > 0) {
    await btn.click({ timeout: 3000 });
    await page.waitForTimeout(1000);
    console.log('Cookie banner kapatıldı');
  }
} catch {}

// Email alanı
console.log('Email dolduruluyor...');
try {
  const emailInput = page.locator('input[type="email"], input[formcontrolname="username"], mat-form-field input').first();
  await emailInput.waitFor({ state: 'visible', timeout: 10000 });
  await emailInput.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Delete');
  await page.keyboard.type(email, { delay: 80 });
  console.log('Email girildi');
} catch (e) {
  console.log('Email alanı bulunamadı:', e.message);
}

// Password alanı
console.log('Şifre dolduruluyor...');
try {
  const pwInput = page.locator('input[type="password"]').first();
  await pwInput.waitFor({ state: 'visible', timeout: 5000 });
  await pwInput.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Delete');
  await page.keyboard.type(password, { delay: 80 });
  console.log('Şifre girildi');
} catch (e) {
  console.log('Şifre alanı bulunamadı:', e.message);
}

// Turnstile bekle
console.log('Turnstile çözülmesi bekleniyor (30s)...');
await page.waitForTimeout(30000);

// Submit butonu
console.log('Submit butonu aranıyor...');
const btn = await page.$('button.btn-brand-orange, button[type="submit"]');
if (btn) {
  const disabled = await btn.getAttribute('disabled');
  console.log('Buton disabled:', disabled);
  console.log('Force-click deneniyor...');
  await page.evaluate((b) => b.click(), btn);
  console.log('Tıklandı');
} else {
  console.log('❌ Submit butonu bulunamadı');
}

// JWT bekle (30s)
console.log('JWT bekleniyor...');
for (let i = 0; i < 30; i++) {
  await page.waitForTimeout(1000);
  const sessionJwt = await page.evaluate(() => sessionStorage.getItem('JWT'));
  if (sessionJwt) {
    capturedJwt = sessionJwt;
    console.log('✅ sessionStorage JWT alındı');
    break;
  }
  if (capturedJwt) break;
  process.stdout.write('.');
}

if (capturedJwt) {
  console.log('\n✅ JWT başarıyla alındı:', capturedJwt.substring(0, 40) + '...');
} else {
  const currentUrl = page.url();
  console.log('\nŞu an URL:', currentUrl);
  // OTP sayfasında mı?
  const otpField = await page.$('input[placeholder*="OTP"], input[formcontrolname="otp"], input[maxlength="6"]');
  if (otpField) {
    console.log('📱 OTP alanı bulundu! Telegram\'dan /otp XXXXXX komutunu gönderin.');
  } else {
    console.log('❌ JWT alınamadı ve OTP alanı da yok');
    // Sayfa içeriği
    const bodyText = await page.evaluate(() => document.body.innerText.substring(0, 500));
    console.log('Sayfa içeriği:', bodyText);
  }
}

process.exit(0);
