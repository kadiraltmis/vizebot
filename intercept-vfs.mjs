/**
 * VFS API Endpoint Discovery Script
 * CDP üzerinden Chrome'a bağlanır, tüm lift-api çağrılarını yakalar.
 * Kullanım: node intercept-vfs.mjs
 */

import { chromium } from 'playwright';
import fs from 'fs';

const CDP_URL = 'http://localhost:9222';
const LOG_FILE = 'artifacts/vfs-api-intercept.json';
const apiCalls = [];

async function main() {
  console.log('CDP bağlantısı kuruluyor...');
  const browser = await chromium.connectOverCDP(CDP_URL);
  const contexts = browser.contexts();
  const context = contexts[0] ?? await browser.newContext();
  const pages = context.pages();
  const page = pages.length > 0 ? pages[0] : await context.newPage();

  console.log('Mevcut URL:', page.url());

  // Tüm ağ isteklerini dinle
  page.on('request', (req) => {
    const url = req.url();
    if (url.includes('lift-api.vfsglobal.com') || url.includes('litf-api.vfsglobal.com')) {
      const entry = {
        ts: new Date().toISOString(),
        method: req.method(),
        url: url,
        path: new URL(url).pathname + new URL(url).search,
        headers: req.headers(),
        postData: req.postData() ?? null,
      };
      apiCalls.push(entry);
      console.log(`[REQ] ${entry.method} ${entry.path}`);
    }
  });

  page.on('response', async (resp) => {
    const url = resp.url();
    if (url.includes('lift-api.vfsglobal.com') || url.includes('litf-api.vfsglobal.com')) {
      const status = resp.status();
      const path = new URL(url).pathname + new URL(url).search;
      let body = '';
      try {
        body = await resp.text();
        if (body.length > 500) body = body.slice(0, 500) + '...[truncated]';
      } catch {}

      // Find matching request entry and add response
      const entry = apiCalls.findLast(e => e.url === url && !e.response);
      if (entry) {
        entry.response = { status, body };
      }
      console.log(`[RES] ${status} ${path} — ${body.slice(0, 100)}`);
    }
  });

  // VFS login sayfasına git
  console.log('\nVFS login sayfasına gidiliyor...');
  await page.goto('https://visa.vfsglobal.com/tur/tr/che/login', {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });

  // Cloudflare bekle
  for (let i = 0; i < 15; i++) {
    const title = await page.title().catch(() => '');
    if (!title.includes('Just a moment')) break;
    console.log('Cloudflare bekleniyor...');
    await page.waitForTimeout(1000);
  }

  console.log('\n=== LÜTFEN GİRİŞ YAPIN ===');
  console.log('Email: kadiraltmis@gmail.com');
  console.log('Şifre: psiko260TITO@');
  console.log('CAPTCHA\'yı çözerek giriş yapın.\n');
  console.log('Giriş tespit edilince otomatik devam edecek...\n');

  // Giriş bekle (10 dakika)
  const deadline = Date.now() + 10 * 60_000;
  let loggedIn = false;
  while (Date.now() < deadline) {
    const url = page.url();
    if (url.includes('/dashboard') || url.includes('/book-an-appointment')) {
      loggedIn = true;
      console.log('Giriş tespit edildi! URL:', url);
      break;
    }
    // sessionStorage'da JWT var mı?
    const jwt = await page.evaluate(() => {
      return sessionStorage.getItem('JWT') || localStorage.getItem('JWT');
    }).catch(() => null);
    if (jwt) {
      loggedIn = true;
      console.log('JWT tespit edildi!');
      // JWT'yi kaydet
      fs.writeFileSync('artifacts/sessions/vfs-jwt.txt', jwt, 'utf-8');
      console.log('JWT kaydedildi: artifacts/sessions/vfs-jwt.txt');

      // .env dosyasını da güncelle
      let envContent = fs.readFileSync('.env', 'utf-8');
      envContent = envContent.replace(/VFS_JWT=.*/, `VFS_JWT=${jwt}`);
      fs.writeFileSync('.env', envContent, 'utf-8');
      console.log('.env güncellendi');
      break;
    }
    await page.waitForTimeout(2000);
  }

  if (!loggedIn) {
    console.log('10 dakika içinde giriş yapılamadı, çıkılıyor...');
    saveResults();
    process.exit(1);
  }

  // Booking sayfasına git ve API çağrılarını yakala
  console.log('\n=== BOOKING SAYFASI KEŞFEDİLİYOR ===');
  await page.goto('https://visa.vfsglobal.com/tur/tr/che/book-an-appointment', {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });
  await page.waitForTimeout(3000);

  // Visa kategori dropdown'ına bak
  console.log('Booking sayfası yüklendi, dropdown\'lar bekleniyor...');

  // Dropdown'ları bul ve tıkla
  try {
    // İlk dropdown — visa category
    const dropdowns = page.locator('mat-select, select, ng-select');
    const count = await dropdowns.count();
    console.log(`Dropdown sayısı: ${count}`);

    if (count > 0) {
      console.log('İlk dropdown tıklanıyor (visa category)...');
      await dropdowns.first().click();
      await page.waitForTimeout(2000);

      // Seçeneklere tıkla
      const options = page.locator('mat-option, option');
      const optCount = await options.count();
      console.log(`Seçenek sayısı: ${optCount}`);

      if (optCount > 0) {
        await options.first().click();
        await page.waitForTimeout(2000);
      }
    }
  } catch (e) {
    console.log('Dropdown etkileşimi başarısız:', e.message);
  }

  // 15 saniye daha bekle — kullanıcı manuel de etkileşebilir
  console.log('\n15 saniye daha bekleniyor — booking dropdown\'larıyla etkileşin...');
  console.log('Visa kategori seçin → appointment merkezi seçin → tarih görünümüne bakın\n');
  await page.waitForTimeout(15000);

  // Sonuçları kaydet
  saveResults();

  // Tüm sessionStorage içeriğini de kaydet
  const storage = await page.evaluate(() => {
    const result = {};
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      result[key] = sessionStorage.getItem(key);
    }
    return result;
  }).catch(() => ({}));

  console.log('\nSessionStorage anahtarları:', Object.keys(storage));
  fs.writeFileSync('artifacts/vfs-session-storage.json', JSON.stringify(storage, null, 2));

  console.log('\nBitti! artifacts/vfs-api-intercept.json inceleniyor...');
  process.exit(0);
}

function saveResults() {
  fs.mkdirSync('artifacts', { recursive: true });
  fs.writeFileSync(LOG_FILE, JSON.stringify(apiCalls, null, 2));
  console.log(`\n${apiCalls.length} API çağrısı kaydedildi: ${LOG_FILE}`);

  // Özet
  const unique = [...new Set(apiCalls.map(e => `${e.method} ${e.path?.split('?')[0]}`))];
  console.log('\nBulunan endpoint\'ler:');
  unique.forEach(u => console.log(' ', u));
}

main().catch(e => {
  console.error('Hata:', e.message);
  saveResults();
  process.exit(1);
});
