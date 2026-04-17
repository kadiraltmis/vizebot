/**
 * Angular app içindeki booking formunu bul + API çağrılarını yakala
 */

import { chromium } from 'playwright';
import fs from 'fs';

const CDP_URL = 'http://localhost:9222';
const captured = [];

async function main() {
  const browser = await chromium.connectOverCDP(CDP_URL);
  const contexts = browser.contexts();
  const context = contexts[0];
  const pages = context.pages();
  const page = pages[0] ?? await context.newPage();

  // lift-api trafiği izle
  page.on('request', req => {
    const url = req.url();
    if (url.includes('lift-api') || url.includes('litf-api')) {
      const path = (() => { try { const u = new URL(url); return u.pathname + u.search; } catch { return url; } })();
      console.log(`[REQ] ${req.method()} ${path}`);
      captured.push({ method: req.method(), url, path, postData: req.postData()?.slice(0, 300) ?? null });
    }
  });

  page.on('response', async resp => {
    const url = resp.url();
    if (url.includes('lift-api') || url.includes('litf-api')) {
      const status = resp.status();
      const path = (() => { try { const u = new URL(url); return u.pathname + u.search; } catch { return url; } })();
      let body = '';
      try { body = (await resp.text()).slice(0, 600); } catch {}
      const entry = captured.findLast(e => e.url === url && !e.resp);
      if (entry) entry.resp = { status, body };
      console.log(`[RES] ${status} ${path}`);
      if (status === 200) console.log('  →', body.slice(0, 200));
    }
  });

  // Angular app'e git — login URL'si Angular SPA'nın entry point'i
  console.log('Angular login sayfasına gidiliyor...');
  await page.goto('https://visa.vfsglobal.com/tur/tr/che/login', {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });

  // Cloudflare bekle
  for (let i = 0; i < 15; i++) {
    const t = await page.title().catch(() => '');
    if (!t.includes('Just a moment')) break;
    process.stdout.write('.');
    await new Promise(r => setTimeout(r, 1000));
  }
  console.log('');

  // Angular init + API calls başlasın
  await new Promise(r => setTimeout(r, 4000));

  // Oturum durumunu kontrol et
  const state = await page.evaluate(() => {
    const jwt = sessionStorage.getItem('JWT') || localStorage.getItem('JWT');
    const url = location.href;
    const hasAngular = !!window['ng'] || !!document.querySelector('app-root');
    const matSelects = document.querySelectorAll('mat-select').length;
    const appRoots = Array.from(document.querySelectorAll('[class*="app-"]')).map(el => el.tagName + '.' + el.className.slice(0, 30)).slice(0, 5);
    return { jwt: jwt ? jwt.slice(0, 20) + '...' : null, url, hasAngular, matSelects, appRoots };
  });

  console.log('Durum:', JSON.stringify(state, null, 2));

  // Eğer JWT varsa ve Angular app çalışıyorsa, router navigate et
  if (state.jwt) {
    console.log('\nOturum aktif — Angular router üzerinden book-appointment\'a gidiliyor...');

    // Angular router ile navigate et (hard refresh olmadan)
    await page.evaluate(() => {
      // Angular router injection
      try {
        const appRef = window['ng']?.getComponent(document.querySelector('app-root'));
        if (appRef) {
          const injector = window['ng']?.getInjector(document.querySelector('app-root'));
          const router = injector?.get(window['Router'] || window['ng']?.core?.Router);
          if (router) {
            router.navigate(['/book-an-appointment']);
            return 'Router navigation';
          }
        }
      } catch {}
      // Fallback: link tıkla
      const links = Array.from(document.querySelectorAll('a[routerLink*="book"], a[href*="book"]'));
      if (links.length > 0) { links[0].click(); return 'Link click'; }
      return 'No router found';
    });

    await new Promise(r => setTimeout(r, 3000));
    console.log('URL şimdi:', page.url());

    // Sayfadaki mat-select'leri bul
    const els = await page.evaluate(() => {
      const selects = document.querySelectorAll('mat-select, select, [formcontrolname]');
      return Array.from(selects).map(el => ({
        tag: el.tagName,
        formControl: el.getAttribute('formcontrolname'),
        id: el.id,
        placeholder: el.getAttribute('placeholder') || el.querySelector('[placeholder]')?.getAttribute('placeholder'),
      }));
    });
    console.log('Form elementler:', JSON.stringify(els, null, 2));
  } else {
    console.log('\nJWT yok — giriş sayfasındayız, giriş yapılması gerekiyor.');
  }

  // Tüm nav linkleri bul
  const navLinks = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('a[routerlink], a[routerLink], nav a, .menu a'))
      .map(el => ({ text: el.textContent?.trim().slice(0, 30), href: el.getAttribute('href'), routerlink: el.getAttribute('routerLink') || el.getAttribute('routerlink') }))
      .filter(l => l.text || l.href)
      .slice(0, 15);
  });
  console.log('\nNav linkleri:', JSON.stringify(navLinks, null, 2));

  // Dropdown'ları bulmayı dene
  const dropdowns = page.locator('mat-select');
  const cnt = await dropdowns.count();
  console.log(`\nmat-select sayısı: ${cnt}`);

  if (cnt > 0) {
    console.log('İlk dropdown tıklanıyor...');
    await dropdowns.first().click({ timeout: 5000 });
    await new Promise(r => setTimeout(r, 2000));

    const opts = await page.evaluate(() =>
      Array.from(document.querySelectorAll('mat-option')).map(o => o.textContent?.trim()).slice(0, 10)
    );
    console.log('Seçenekler:', opts);

    if (opts.length > 0) {
      await page.locator('mat-option').first().click();
      await new Promise(r => setTimeout(r, 3000));
    }
  }

  // 5 saniye daha bekle
  await new Promise(r => setTimeout(r, 5000));

  const outFile = 'd:/cloudecode/visa-monitor/artifacts/angular-booking-calls.json';
  fs.mkdirSync('d:/cloudecode/visa-monitor/artifacts', { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(captured, null, 2));
  console.log(`\n${captured.length} lift-api çağrısı yakalandı → ${outFile}`);

  const unique = [...new Set(captured.map(e => `${e.method} ${e.path?.split('?')[0]}`))];
  console.log('\nEndpoint\'ler:');
  unique.forEach(u => console.log(' ', u));

  process.exit(0);
}

main().catch(e => {
  console.error('HATA:', e.message, e.stack);
  process.exit(1);
});
