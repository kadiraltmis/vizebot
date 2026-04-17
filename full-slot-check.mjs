/**
 * Tam slot kontrol scripti:
 * Giriş → JWT → Angular nav → clientsource yakalama → CheckIsSlotAvailable
 */
import { chromium } from 'playwright';
import fs from 'fs';

const CDP_URL = 'http://localhost:9222';
const LIFT_API = 'https://lift-api.vfsglobal.com';
const ENV_FILE = 'd:/cloudecode/visa-monitor/.env';

async function main() {
  const browser = await chromium.connectOverCDP(CDP_URL);
  const context = browser.contexts()[0];
  const page = context.pages()[0] ?? await context.newPage();

  // clientsource yakalama
  let clientsource = null;
  page.on('request', req => {
    const url = req.url();
    if ((url.includes('lift-api') || url.includes('litf-api')) && !clientsource) {
      const cs = req.headers()['clientsource'];
      if (cs) {
        clientsource = cs;
        console.log('clientsource yakalandı (' + cs.length + ' chars)');
      }
    }
  });

  // Mevcut oturum kontrolü
  let jwt = await page.evaluate(() => sessionStorage.getItem('JWT')).catch(() => null);

  if (!jwt) {
    // Login gerekli
    console.log('Login sayfasına gidiliyor...');
    await page.goto('https://visa.vfsglobal.com/tur/tr/che/login', {
      waitUntil: 'domcontentloaded', timeout: 30000,
    });

    // Cloudflare
    for (let i = 0; i < 20; i++) {
      const t = await page.title().catch(() => '');
      if (!t.includes('Just a moment')) break;
      await new Promise(r => setTimeout(r, 1000));
    }

    console.log('\n================================================');
    console.log('CHROME\'DA GİRİŞ YAPIN:');
    console.log('  Email : kadiraltmis@gmail.com');
    console.log('  Şifre : psiko260TITO@');
    console.log('================================================\n');

    const deadline = Date.now() + 15 * 60_000;
    while (Date.now() < deadline) {
      jwt = await page.evaluate(() => {
        const ss = sessionStorage.getItem('JWT');
        if (ss) return ss;
        for (let i = 0; i < sessionStorage.length; i++) {
          const v = sessionStorage.getItem(sessionStorage.key(i) ?? '') ?? '';
          if (v.startsWith('EAAAA')) return v;
        }
        return null;
      }).catch(() => null);
      if (jwt) { console.log('JWT alındı!'); break; }
      process.stdout.write('.');
      await new Promise(r => setTimeout(r, 2000));
    }

    if (!jwt) { console.error('JWT alınamadı'); process.exit(1); }

    // Kaydet
    fs.mkdirSync('d:/cloudecode/visa-monitor/artifacts/sessions', { recursive: true });
    fs.writeFileSync('d:/cloudecode/visa-monitor/artifacts/sessions/vfs-jwt.txt', jwt, 'utf-8');
    let env = fs.readFileSync(ENV_FILE, 'utf-8');
    env = env.replace(/VFS_JWT=.*(\r?\n|$)/, `VFS_JWT=${jwt}\n`);
    fs.writeFileSync(ENV_FILE, env, 'utf-8');
    console.log('JWT kaydedildi');
  } else {
    console.log('Mevcut oturum kullanılıyor. JWT:', jwt.slice(0, 20) + '...');
  }

  // Angular router ile application-detail'e git (SPA nav — no reload)
  console.log('Angular router ile application-detail\'e gidiliyor...');

  // Dashboard'a git önce (Angular SPA nav)
  const url = page.url();
  if (!url.includes('/dashboard') && !url.includes('/application-detail')) {
    await page.evaluate(() => {
      // Angular SPA içinde navigate — history.pushState ile
      window.history.pushState({}, '', '/tur/tr/che/application-detail');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await new Promise(r => setTimeout(r, 3000));
  }

  // Booking formu açmak için buton tıkla
  let clicked = false;
  const selectors = [
    'text=Yeni Rezervasyon Başlat',
    'button:has-text("Yeni")',
    '[routerlink*="application"]',
  ];
  for (const sel of selectors) {
    try {
      const el = page.locator(sel).first();
      if (await el.count() > 0) {
        await el.click({ timeout: 4000 });
        clicked = true;
        await new Promise(r => setTimeout(r, 3000));
        break;
      }
    } catch {}
  }

  if (!clicked) {
    // Direkt navigate
    await page.evaluate(() => {
      window.history.pushState({}, '', '/tur/tr/che/application-detail');
      window.dispatchEvent(new PopStateEvent('popstate', { state: {} }));
    });
    await new Promise(r => setTimeout(r, 3000));
  }

  console.log('URL:', page.url());

  // Dropdown'ları bul ve tıkla (Angular API çağrılarını tetikler)
  const drops = page.locator('mat-select');
  const dCnt = await drops.count();
  console.log('mat-select sayısı:', dCnt);

  for (let i = 0; i < dCnt; i++) {
    if (clientsource) break; // Yeterli
    try {
      await drops.nth(i).click({ timeout: 5000 });
      await new Promise(r => setTimeout(r, 1500));
      const opts = page.locator('mat-option');
      const oc = await opts.count();
      if (oc > 0) {
        await opts.first().click({ timeout: 3000 });
        await new Promise(r => setTimeout(r, 2000));
      } else {
        await page.keyboard.press('Escape');
      }
    } catch {}
  }

  // 3 saniye daha bekle
  await new Promise(r => setTimeout(r, 3000));

  if (!clientsource) {
    console.warn('clientsource yakalanamadı, header\'sız POST deneniyor...');
  }

  // CheckIsSlotAvailable — ESB ve IST için
  const centers = [
    { code: 'ESB', city: 'Ankara' },
    { code: 'IST', city: 'Istanbul' },
  ];

  console.log('\n=== SLOT KONTROLÜ ===');
  for (const { code, city } of centers) {
    const body = {
      countryCode: 'tur', missionCode: 'che', vacCode: code,
      visaCategoryCode: 'TOR', roleName: 'Individual',
      loginUser: 'kadiraltmis@gmail.com', payCode: '',
    };

    const headers = {
      'Authorization': `Bearer ${jwt}`,
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'Origin': 'https://visa.vfsglobal.com',
      'Referer': 'https://visa.vfsglobal.com/',
      'route': 'tur/tr/che',
    };
    if (clientsource) headers['clientsource'] = clientsource;

    const result = await page.evaluate(
      async ({ url, headers, body }) => {
        try {
          const resp = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), credentials: 'include' });
          return { status: resp.status, body: (await resp.text()).slice(0, 500) };
        } catch (e) { return { status: 0, body: String(e) }; }
      },
      { url: `${LIFT_API}/appointment/CheckIsSlotAvailable`, headers, body }
    );

    const icon = result.status === 200 ? '✅' : '❌';
    console.log(`${icon} ${city} (${code}): ${result.status}`);
    if (result.status === 200) {
      const data = JSON.parse(result.body);
      if (data.earliestDate) {
        console.log(`  🎉 SLOT BULUNDU: ${data.earliestDate}`);
      } else {
        console.log(`  Müsait slot yok. Hata: ${data.error?.description}`);
      }
    } else {
      console.log('  Yanıt:', result.body.slice(0, 100));
    }
  }

  process.exit(0);
}

main().catch(e => { console.error('HATA:', e.message); process.exit(1); });
