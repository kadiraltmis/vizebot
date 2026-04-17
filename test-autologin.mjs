/**
 * VFS auto-login testi — login POST response'u yakalar
 */
import 'dotenv/config';
import { chromium } from 'playwright';

const browser = await chromium.connectOverCDP('http://localhost:9222');
const context = browser.contexts()[0];
const page = context.pages()[0];

const email = process.env.VFS_EMAIL;
const password = process.env.VFS_PASSWORD;

// Tüm API response'larını yakala
page.on('response', async (resp) => {
  const url = resp.url();
  if (url.includes('vfsglobal') || url.includes('lift-api')) {
    const status = resp.status();
    let body = '';
    try { body = await resp.text(); } catch {}
    console.log(`[${status}] ${url.replace('https://','').slice(0,80)}`);
    if (body && !url.includes('assets') && !url.includes('.js') && !url.includes('.css')) {
      console.log('  Body:', body.slice(0, 150));
    }
  }
});

console.log('Login sayfasına gidiliyor...');
await page.goto('https://visa.vfsglobal.com/tur/tr/che/login', { waitUntil: 'domcontentloaded', timeout: 30_000 });

// Cloudflare bekle
for (let i = 0; i < 10; i++) {
  const title = await page.title();
  if (!title.includes('Just a moment')) break;
  await page.waitForTimeout(1000);
}

// Cookie banner kapat
try {
  const acceptBtn = page.locator('button:has-text("Tümüne İzin Ver")').first();
  if (await acceptBtn.count() > 0) {
    await acceptBtn.click({ timeout: 3000 });
    await page.waitForTimeout(800);
  }
} catch {}

// Turnstile bekle (5s)
await page.waitForTimeout(5000);

// Turnstile iframe içindeki durum
const frames = page.frames();
console.log('\nFrames:', frames.map(f => f.url().slice(0,60)));

// Email doldur
const emailInput = page.locator('input#email').first();
await emailInput.waitFor({ timeout: 10_000 });
await emailInput.click();
await page.keyboard.press('Control+a');
await page.keyboard.press('Delete');
await page.keyboard.type(email, { delay: 60 });

// Şifre doldur
const pwInput = page.locator('input#password').first();
await pwInput.click();
await page.keyboard.press('Control+a');
await page.keyboard.press('Delete');
await page.keyboard.type(password, { delay: 60 });

await page.waitForTimeout(1000);

// Buton durumu
const disabled = await page.evaluate(() => document.querySelector('button.btn-brand-orange')?.disabled);
console.log('\nButon disabled:', disabled);

console.log('\n--- Oturum Aç tıklanıyor ---');
await page.locator('button.btn-brand-orange').first().click({ timeout: 5000, force: true });

// Sonucu bekle
await page.waitForTimeout(8000);
console.log('\nSon URL:', page.url());

// Başarılı mı?
const jwt = await page.evaluate(() => sessionStorage.getItem('JWT')).catch(() => null);
console.log('JWT:', jwt ? jwt.slice(0,20) + '...' : 'yok');

const otpInputs = await page.evaluate(() =>
  Array.from(document.querySelectorAll('input')).filter(el => el.offsetParent !== null).map(el => ({
    id: el.id, type: el.type, placeholder: el.placeholder,
    formControlName: el.getAttribute('formcontrolname'), maxlength: el.maxLength,
  }))
);
console.log('\nGörünür input\'lar:', JSON.stringify(otpInputs, null, 2));

process.exit(0);
