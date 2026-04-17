/**
 * Mevcut application-detail sayfasında Angular'ı tetikle,
 * clientsource header'ını yakala, sonra POST'ta kullan.
 */
import { chromium } from 'playwright';

const browser = await chromium.connectOverCDP('http://localhost:9222');
const context = browser.contexts()[0];
const page = context.pages()[0];

console.log('URL:', page.url());

// JWT hâlâ var mı?
const jwt = await page.evaluate(() => sessionStorage.getItem('JWT'));
console.log('JWT:', jwt?.slice(0, 20) + '...');

if (!jwt) {
  console.error('JWT yok — önce giriş yapın (login-then-intercept.mjs)');
  process.exit(1);
}

// Playwright request intercept — clientsource yakala
let capturedClientSource = null;

page.on('request', (req) => {
  const url = req.url();
  if (url.includes('lift-api') || url.includes('litf-api')) {
    const headers = req.headers();
    const cs = headers['clientsource'];
    if (cs && !capturedClientSource) {
      capturedClientSource = cs;
      console.log('\nClientsource yakalandı! İlk 40:', cs.slice(0, 40) + '...');
    }
  }
});

// Angular'ı tetikle — mevcut sayfada dropdown'ları tıkla
console.log('\nAngular dropdown\'ları aranıyor...');
const dropdowns = page.locator('mat-select');
const cnt = await dropdowns.count();
console.log('mat-select sayısı:', cnt);

if (cnt > 0) {
  console.log('İlk dropdown tıklanıyor...');
  await dropdowns.first().click({ timeout: 5000 }).catch(e => console.log('Dropdown hatası:', e.message));
  await new Promise(r => setTimeout(r, 1000));

  // Seçenek seç
  const opts = page.locator('mat-option');
  const optCnt = await opts.count();
  if (optCnt > 0) {
    await opts.first().click({ timeout: 3000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 2000));
  } else {
    await page.keyboard.press('Escape');
  }
}

// Hâlâ yoksa sayfa içeriğini kontrol et
if (!capturedClientSource) {
  console.log('\nDropdown clientsource üretmedi. Sayfa içeriği:');
  const text = await page.evaluate(() => document.body.innerText.slice(0, 200));
  console.log(text);

  // Farklı elementler dene
  const buttons = await page.evaluate(() =>
    Array.from(document.querySelectorAll('button')).map(b => b.textContent?.trim()).filter(Boolean).slice(0, 10)
  );
  console.log('Butonlar:', buttons);

  // Tüm tıklanabilir elementleri dene
  for (const btn of ['Güncelle', 'Kontrol Et', 'Devam', 'Next', 'Continue', 'Submit']) {
    try {
      const el = page.locator(`button:has-text("${btn}")`).first();
      if (await el.count() > 0) {
        console.log(`"${btn}" tıklanıyor...`);
        await el.click({ timeout: 3000 });
        await new Promise(r => setTimeout(r, 2000));
        if (capturedClientSource) break;
      }
    } catch {}
  }
}

// 3 saniye daha bekle
await new Promise(r => setTimeout(r, 3000));

if (!capturedClientSource) {
  console.log('\nClientsource yakalanamadı.');

  // Son çare: cached clientsource kullan (angular-booking-calls.json'dan)
  import('fs').then(({ default: fs }) => {
    try {
      const data = JSON.parse(fs.readFileSync('d:/cloudecode/visa-monitor/artifacts/angular-booking-calls.json', 'utf-8'));
      const entry = data.find(e => e.headers?.clientsource);
      if (entry) {
        capturedClientSource = entry.headers.clientsource;
        // Truncated değer — gerçek değeri angular-endpoints.txt'den bul
        console.log('Cached clientsource:', capturedClientSource);
      }
    } catch {}
  });

  await new Promise(r => setTimeout(r, 1000));
}

if (!capturedClientSource) {
  console.error('Clientsource elde edilemedi.');
  process.exit(1);
}

// Şimdi bu clientsource ile POST dene
console.log('\n=== ESB (Ankara) — POST with clientsource ===');
const r1 = await page.evaluate(async ({ jwt, cs }) => {
  const resp = await fetch('https://lift-api.vfsglobal.com/appointment/CheckIsSlotAvailable', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${jwt}`,
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'Origin': 'https://visa.vfsglobal.com',
      'Referer': 'https://visa.vfsglobal.com/',
      'route': 'tur/tr/che',
      'clientsource': cs,
    },
    body: JSON.stringify({
      countryCode: 'tur', missionCode: 'che', vacCode: 'ESB',
      visaCategoryCode: 'TOR', roleName: 'Individual',
      loginUser: 'kadiraltmis@gmail.com', payCode: ''
    }),
  });
  return { status: resp.status, body: (await resp.text()).slice(0, 400) };
}, { jwt, cs: capturedClientSource });

console.log('Status:', r1.status);
console.log('Body:', r1.body.slice(0, 300));

process.exit(r1.status === 200 ? 0 : 1);
