import { chromium } from 'playwright';

const JWT = process.env.VFS_JWT;
const cdpUrl = 'http://localhost:9222';

console.log('CDP bağlanılıyor...');
const browser = await chromium.connectOverCDP(cdpUrl);
const contexts = browser.contexts();
const context = contexts[0] ?? await browser.newContext();
const pages = context.pages();
const page = pages.length > 0 ? pages[0] : await context.newPage();

console.log('VFS Switzerland sayfasına gidiliyor...');
await page.goto('https://visa.vfsglobal.com/tur/tr/che/application-detail', {
  waitUntil: 'domcontentloaded',
  timeout: 30000
});

await page.waitForTimeout(3000);
const url = page.url();
console.log('Şu an URL:', url);

const sessionJwt = await page.evaluate(() => sessionStorage.getItem('JWT'));
console.log('sessionStorage JWT:', sessionJwt ? sessionJwt.substring(0, 20) + '...' : 'YOK');

if (JWT && !sessionJwt) {
  console.log('Env JWT inject ediliyor...');
  await page.evaluate((jwt) => sessionStorage.setItem('JWT', jwt), JWT);
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(3000);
  const newUrl = page.url();
  console.log('JWT inject sonrası URL:', newUrl);
  if (newUrl.includes('application-detail')) {
    console.log('✅ JWT GEÇERLİ');
  } else {
    console.log('❌ JWT GEÇERSİZ — yeni login gerekiyor');
  }
} else if (sessionJwt) {
  console.log('sessionStorage JWT zaten var — sayfa kontrol ediliyor');
  if (url.includes('application-detail')) {
    console.log('✅ Oturum aktif');
  } else {
    console.log('❌ Oturum yok — login gerekiyor');
  }
}

process.exit(0);
