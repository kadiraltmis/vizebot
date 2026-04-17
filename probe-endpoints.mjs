/**
 * VFS Endpoint Probe — Mevcut Chrome oturumundan JWT alıp
 * tüm olası appointment endpoint'lerini test eder.
 */

import { chromium } from 'playwright';
import fs from 'fs';

const CDP_URL = 'http://localhost:9222';
const LIFT_API = 'https://lift-api.vfsglobal.com';

// Test edilecek endpoint kalıpları
const CANDIDATES = [
  // Appointment centers
  'GET /appointment/centres/che/tur',
  'GET /appointment/center/che/tur',
  'GET /appointment/centers/che/tur',
  'GET /appointment/centre/che/tur',
  'GET /vac/list/che/tur',
  'GET /vac/centres/che/tur',
  'GET /centre/list/che/tur',
  'GET /centers/che/tur',
  'GET /appointment/vac/che/tur',
  'GET /appointment/slots/che/tur',

  // Slot availability
  'GET /appointment/slot/che/tur',
  'GET /appointment/available/che/tur',
  'GET /appointment/availability/che/tur',
  'GET /slot/che/tur',
  'GET /slots/che/tur',

  // Common VFS patterns
  'GET /appointmentcenter/list/che/tur',
  'GET /appointmentcenter/centres/che/tur',
  'GET /appointmentslot/list/che/tur',
  'GET /appointment/list/che/tur',
];

async function main() {
  console.log('CDP bağlantısı...');
  const browser = await chromium.connectOverCDP(CDP_URL);
  const contexts = browser.contexts();
  const context = contexts[0] ?? await browser.newContext();
  const pages = context.pages();
  const page = pages[0] ?? await context.newPage();

  // Önce VFS'e git (Cloudflare cookie için)
  const currentUrl = page.url();
  console.log('Mevcut URL:', currentUrl);

  if (!currentUrl.includes('visa.vfsglobal.com')) {
    console.log('VFS login sayfasına gidiliyor...');
    await page.goto('https://visa.vfsglobal.com/tur/tr/che/login', {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    // Cloudflare bekle
    for (let i = 0; i < 15; i++) {
      const title = await page.title().catch(() => '');
      if (!title.includes('Just a moment')) break;
      process.stdout.write('.');
      await new Promise(r => setTimeout(r, 1000));
    }
    console.log('\nSayfa yüklendi.');
    // Angular initialize olsun
    await new Promise(r => setTimeout(r, 3000));
  }

  // JWT al — önce sessionStorage, sonra env
  let jwt = await page.evaluate(() => {
    const ss = sessionStorage.getItem('JWT');
    if (ss) return ss;
    const ls = localStorage.getItem('JWT');
    if (ls) return ls;
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i) ?? '';
      if (key.toLowerCase().includes('jwt') || key.toLowerCase().includes('token')) {
        return sessionStorage.getItem(key);
      }
    }
    return null;
  });

  if (!jwt) {
    // .env'den oku
    const env = fs.readFileSync('d:/cloudecode/visa-monitor/.env', 'utf-8');
    const match = env.match(/VFS_JWT=(.+)/);
    jwt = match?.[1]?.trim() ?? null;
    console.log('JWT sessionStorage\'da yok, .env\'den alındı');
  } else {
    console.log('JWT sessionStorage\'dan alındı');
    // Kaydet
    fs.mkdirSync('d:/cloudecode/visa-monitor/artifacts/sessions', { recursive: true });
    fs.writeFileSync('d:/cloudecode/visa-monitor/artifacts/sessions/vfs-jwt.txt', jwt, 'utf-8');
    // .env güncelle
    let env = fs.readFileSync('d:/cloudecode/visa-monitor/.env', 'utf-8');
    env = env.replace(/VFS_JWT=.*/, `VFS_JWT=${jwt}`);
    fs.writeFileSync('d:/cloudecode/visa-monitor/.env', env, 'utf-8');
    console.log('JWT .env\'e kaydedildi');
  }

  if (!jwt) {
    console.error('JWT bulunamadı! Önce VFS\'e giriş yapın.');
    process.exit(1);
  }

  console.log('JWT (ilk 20):', jwt.slice(0, 20) + '...');

  // Clientsource header'ı al (Angular'dan)
  const clientsource = await page.evaluate(() => {
    // Angular servislerinden clientsource token bul
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i) ?? '';
      const val = sessionStorage.getItem(key) ?? '';
      if (val.length > 50 && (key.includes('source') || key.includes('client'))) {
        return val;
      }
    }
    return null;
  });

  if (clientsource) {
    console.log('ClientSource bulundu (ilk 20):', clientsource.slice(0, 20) + '...');
  }

  // Endpoint'leri test et
  console.log('\n=== ENDPOINT TEST ===');
  const results = [];

  for (const candidate of CANDIDATES) {
    const [method, path] = candidate.split(' ');
    const url = LIFT_API + path;

    const result = await page.evaluate(
      async ({ url, jwt, method }) => {
        try {
          const resp = await fetch(url, {
            method,
            headers: {
              'Authorization': `Bearer ${jwt}`,
              'Accept': 'application/json',
              'Origin': 'https://visa.vfsglobal.com',
              'Referer': 'https://visa.vfsglobal.com/',
              'route': 'tur/tr/che',
            },
          });
          const text = await resp.text();
          return { status: resp.status, body: text.slice(0, 300) };
        } catch (e) {
          return { status: 0, body: String(e) };
        }
      },
      { url, jwt, method }
    );

    const icon = result.status === 200 ? '✅' : result.status === 404 ? '❌' : `⚠️ ${result.status}`;
    console.log(`${icon} ${method} ${path}`);
    if (result.status === 200) {
      console.log('   →', result.body.slice(0, 150));
    }

    results.push({ method, path, ...result });

    // 500ms bekle (rate limit önlemi)
    await new Promise(r => setTimeout(r, 500));
  }

  // Sonuçları kaydet
  const outFile = 'd:/cloudecode/visa-monitor/artifacts/endpoint-probe.json';
  fs.writeFileSync(outFile, JSON.stringify(results, null, 2));
  console.log('\nSonuçlar kaydedildi:', outFile);

  const ok = results.filter(r => r.status === 200);
  console.log(`\n✅ Çalışan endpoint'ler (${ok.length}):`);
  ok.forEach(r => console.log(' ', r.method, r.path, '—', r.body.slice(0, 80)));

  process.exit(0);
}

main().catch(e => {
  console.error('HATA:', e.message);
  process.exit(1);
});
