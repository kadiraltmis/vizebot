/**
 * VFS — Giriş bekle + Endpoint keşfet
 * Chrome'da VFS'e giriş yapıldığında JWT'yi yakalar ve
 * tüm appointment endpoint'lerini test eder.
 */

import { chromium } from 'playwright';
import fs from 'fs';

const CDP_URL = 'http://localhost:9222';
const LIFT_API = 'https://lift-api.vfsglobal.com';

// Appointment endpoint adayları — daha kapsamlı liste
const APPOINTMENT_CANDIDATES = [
  // VAC / Centre listesi
  'GET /appointment/vac/che/tur',
  'GET /appointment/vacs/che/tur',
  'GET /appointment/centres/che/tur',
  'GET /appointment/center/che/tur',
  'GET /appointment/locations/che/tur',
  'GET /vac/che/tur',
  'GET /vac/list/che/tur',
  'GET /vaccentre/list/che/tur',

  // Slot sorgulama
  'GET /appointment/slots/che/tur',
  'GET /appointment/slot/che/tur',
  'GET /appointment/available/che/tur',
  'GET /appointment/availability/che/tur',
  'GET /appointment/availableslots/che/tur',
  'GET /appointment/calendar/che/tur',
  'GET /appointment/earliestslot/che/tur',
  'GET /appointment/che/tur',
  'GET /appointment/list/che/tur',

  // VFS Angular kaynak kodundan bulunan pattern'ler
  'GET /master/centre/che/tur',
  'GET /master/vac/che/tur',
  'GET /master/appointmentcenter/che/tur',

  // Bilinen çalışan endpoint'lerin türevleri
  'GET /configuration/appointmentcenter/che/tur',
  'GET /configuration/vac/che/tur',

  // Alternatif parametreli sorgular
  'GET /appointment?missionCountry=che&nationalityCountry=tur',
  'GET /vac?missionCountry=che&nationalityCountry=tur',
  'GET /appointment/centre?missionCountry=che&nationalityCountry=tur',
];

async function main() {
  console.log('CDP bağlantısı kuruluyor...');
  const browser = await chromium.connectOverCDP(CDP_URL);
  const contexts = browser.contexts();
  const context = contexts[0] ?? await browser.newContext();
  const pages = context.pages();
  const page = pages[0] ?? await context.newPage();

  // VFS'te değilsek git
  const currentUrl = page.url();
  if (!currentUrl.includes('vfsglobal.com')) {
    console.log('VFS login sayfasına yönlendiriliyor...');
    await page.goto('https://visa.vfsglobal.com/tur/tr/che/login', {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    for (let i = 0; i < 15; i++) {
      const title = await page.title().catch(() => '');
      if (!title.includes('Just a moment')) break;
      process.stdout.write('.');
      await new Promise(r => setTimeout(r, 1000));
    }
    console.log('');
  }

  console.log('Mevcut URL:', page.url());
  console.log('\n================================================');
  console.log('CHROME PENCERESİNDE GİRİŞ YAPIN:');
  console.log('  Email   : kadiraltmis@gmail.com');
  console.log('  Şifre   : psiko260TITO@');
  console.log('  CAPTCHA : Manuel çözün');
  console.log('================================================');
  console.log('Giriş tespit edilince otomatik devam edilecek...\n');

  // JWT için 15 dakika bekle
  let jwt = null;
  const deadline = Date.now() + 15 * 60_000;

  while (Date.now() < deadline) {
    // SessionStorage'da JWT ara
    jwt = await page.evaluate(() => {
      const ss = sessionStorage.getItem('JWT');
      if (ss) return ss;
      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i) ?? '';
        if (key.toLowerCase().includes('jwt') || key.toLowerCase().includes('token')) {
          const val = sessionStorage.getItem(key);
          if (val && val.startsWith('EAAAA')) return val;
        }
      }
      return null;
    }).catch(() => null);

    if (jwt) {
      console.log('\nJWT ALINDI!', jwt.slice(0, 30) + '...');

      // Kaydet
      fs.mkdirSync('d:/cloudecode/visa-monitor/artifacts/sessions', { recursive: true });
      fs.writeFileSync('d:/cloudecode/visa-monitor/artifacts/sessions/vfs-jwt.txt', jwt, 'utf-8');

      let env = fs.readFileSync('d:/cloudecode/visa-monitor/.env', 'utf-8');
      env = env.replace(/VFS_JWT=.*(\r?\n|$)/, `VFS_JWT=${jwt}\n`);
      fs.writeFileSync('d:/cloudecode/visa-monitor/.env', env, 'utf-8');
      console.log('JWT .env ve cache dosyasına kaydedildi.\n');
      break;
    }

    // URL değişimini de kontrol et (dashboard/booking'e gelindiyse JWT'yi farklı bul)
    const url = page.url();
    if (url.includes('/dashboard') || url.includes('/book-an-appointment')) {
      console.log('\nGiriş URL\'si tespit edildi:', url);
      // Birkaç saniye bekle JWT'nin oluşması için
      await new Promise(r => setTimeout(r, 2000));
      continue;
    }

    process.stdout.write('.');
    await new Promise(r => setTimeout(r, 2000));
  }

  if (!jwt) {
    console.error('\n15 dakika geçti, giriş yapılamadı.');
    process.exit(1);
  }

  // Booking sayfasına git — daha fazla context için
  console.log('Booking sayfasına gidiliyor...');
  await page.goto('https://visa.vfsglobal.com/tur/tr/che/book-an-appointment', {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });
  await new Promise(r => setTimeout(r, 3000));

  // Endpoint'leri test et
  console.log('\n=== APPOINTMENT ENDPOINT TEST ===\n');
  const results = [];

  for (const candidate of APPOINTMENT_CANDIDATES) {
    const spaceIdx = candidate.indexOf(' ');
    const method = candidate.slice(0, spaceIdx);
    const path = candidate.slice(spaceIdx + 1);
    const url = path.startsWith('/') ? LIFT_API + path : LIFT_API + '/' + path;

    const result = await page.evaluate(
      async ({ url, jwt }) => {
        try {
          const resp = await fetch(url, {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${jwt}`,
              'Accept': 'application/json',
              'Origin': 'https://visa.vfsglobal.com',
              'Referer': 'https://visa.vfsglobal.com/',
              'route': 'tur/tr/che',
            },
          });
          const text = await resp.text();
          return { status: resp.status, body: text.slice(0, 500) };
        } catch (e) {
          return { status: 0, body: String(e) };
        }
      },
      { url, jwt }
    );

    const icon = result.status === 200 ? '✅' : result.status === 404 ? '❌' : result.status === 401 ? '🔒' : `⚠️${result.status}`;
    console.log(`${icon} GET ${path}`);
    if (result.status === 200) {
      console.log('   YANIT:', result.body.slice(0, 200));
      console.log();
    } else if (result.status !== 404) {
      console.log('   →', result.body.slice(0, 100));
    }

    results.push({ method, path, status: result.status, body: result.body });
    await new Promise(r => setTimeout(r, 300));
  }

  // Sonuçları kaydet
  const outFile = 'd:/cloudecode/visa-monitor/artifacts/appointment-endpoints.json';
  fs.writeFileSync(outFile, JSON.stringify(results, null, 2));
  console.log('\nSonuçlar:', outFile);

  const ok = results.filter(r => r.status === 200);
  const notFound = results.filter(r => r.status === 404);
  const other = results.filter(r => r.status !== 200 && r.status !== 404);

  console.log(`\n✅ 200 OK: ${ok.length}`);
  ok.forEach(r => console.log(`   ${r.path}`));
  console.log(`\n⚠️ Diğer yanıtlar: ${other.length}`);
  other.forEach(r => console.log(`   ${r.status} ${r.path} — ${r.body.slice(0, 60)}`));

  process.exit(0);
}

main().catch(e => {
  console.error('HATA:', e.message);
  console.error(e.stack);
  process.exit(1);
});
