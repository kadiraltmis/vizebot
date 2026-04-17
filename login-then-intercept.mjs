/**
 * VFS Login + Angular Router + API Intercept
 *
 * Login olduktan sonra sayfa geçişi YAPMA — Angular router ile
 * booking formuna git ve API çağrılarını yakala.
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

  // Intercept BAŞLAT — sayfa navigasyonundan önce
  page.on('request', req => {
    const url = req.url();
    if (url.includes('lift-api') || url.includes('litf-api')) {
      const path = (() => { try { return new URL(url).pathname + new URL(url).search; } catch { return url; } })();
      console.log(`[REQ] ${req.method()} ${path}`);
      captured.push({ method: req.method(), url, path, postData: req.postData()?.slice(0, 300) ?? null, ts: Date.now() });
    }
  });

  page.on('response', async resp => {
    const url = resp.url();
    if (url.includes('lift-api') || url.includes('litf-api')) {
      const status = resp.status();
      const path = (() => { try { return new URL(url).pathname + new URL(url).search; } catch { return url; } })();
      let body = '';
      try { body = (await resp.text()).slice(0, 800); } catch {}
      const entry = captured.findLast(e => e.url === url && !e.resp);
      if (entry) entry.resp = { status, body };
      const ok = status === 200;
      console.log(`[RES] ${ok ? '✅' : '❌'} ${status} ${path}`);
      if (ok) console.log('  BODY:', body.slice(0, 300));
    }
  });

  // Angular login sayfasına git
  console.log('VFS login sayfasına gidiliyor...');
  await page.goto('https://visa.vfsglobal.com/tur/tr/che/login', {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });

  // Cloudflare
  for (let i = 0; i < 15; i++) {
    const t = await page.title().catch(() => '');
    if (!t.includes('Just a moment')) break;
    process.stdout.write('cf.');
    await new Promise(r => setTimeout(r, 1000));
  }
  console.log('');
  await new Promise(r => setTimeout(r, 3000));

  console.log('URL:', page.url());

  // Mevcut oturum var mı kontrol et
  let jwt = await page.evaluate(() => {
    return sessionStorage.getItem('JWT') || localStorage.getItem('JWT') ||
      (() => {
        for (let i = 0; i < sessionStorage.length; i++) {
          const k = sessionStorage.key(i) ?? '';
          const v = sessionStorage.getItem(k) ?? '';
          if (v.startsWith('EAAAA')) return v;
        }
        return null;
      })();
  }).catch(() => null);

  if (!jwt) {
    console.log('\n================================================');
    console.log('LÜTFEN CHROME PENCERESİNDE GİRİŞ YAPIN:');
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

      if (jwt) { console.log('\nJWT alındı!'); break; }
      process.stdout.write('.');
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  if (!jwt) { console.error('JWT alınamadı'); process.exit(1); }

  // JWT kaydet
  fs.mkdirSync('d:/cloudecode/visa-monitor/artifacts/sessions', { recursive: true });
  fs.writeFileSync('d:/cloudecode/visa-monitor/artifacts/sessions/vfs-jwt.txt', jwt, 'utf-8');
  let env = fs.readFileSync('d:/cloudecode/visa-monitor/.env', 'utf-8');
  env = env.replace(/VFS_JWT=.*(\r?\n|$)/, `VFS_JWT=${jwt}\n`);
  fs.writeFileSync('d:/cloudecode/visa-monitor/.env', env, 'utf-8');
  console.log('JWT kaydedildi. İlk 30:', jwt.slice(0, 30) + '...');

  // SAYFA GEÇİŞİ YAPMA — Angular router kullan
  console.log('\nAngular router state alınıyor...');
  const routerState = await page.evaluate(() => {
    // Angular Router'ı bul
    const appRoot = document.querySelector('app-root') || document.querySelector('[ng-version]');
    if (!appRoot) return { error: 'app-root yok' };

    // URL'den anlayabileceğimiz şeyleri topla
    return {
      url: location.href,
      hash: location.hash,
      angularVersion: appRoot?.getAttribute('ng-version'),
      appRootHTML: appRoot?.innerHTML?.slice(0, 500),
    };
  });

  console.log('Router state:', JSON.stringify(routerState, null, 2));

  // Angular router ile navigate — birkaç yol dene
  console.log('\nAngular router navigation deneniyor...');

  // Yöntem 1: ng global API
  const navResult = await page.evaluate(() => {
    try {
      const appRoot = document.querySelector('app-root');
      if (!appRoot) return 'no app-root';

      // Angular 13+ ng globals
      if (window.getAllAngularRootElements) {
        const roots = window.getAllAngularRootElements();
        return 'roots: ' + roots.length;
      }

      // Angular internal
      const ngProbe = window.ng;
      if (ngProbe) {
        const comp = ngProbe.getComponent?.(appRoot);
        const inj = ngProbe.getInjector?.(appRoot);
        if (inj) {
          // Router token'ı bul
          return 'injector found';
        }
      }
      return 'ng probe: ' + typeof window.ng;
    } catch (e) {
      return 'error: ' + e.message;
    }
  });
  console.log('Nav result:', navResult);

  // Yöntem 2: Linke tıkla
  const links = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('a, button, [routerlink], [routerLink], mat-list-item'))
      .map(el => ({
        tag: el.tagName,
        text: el.textContent?.trim().slice(0, 40),
        href: el.getAttribute('href'),
        rl: el.getAttribute('routerLink') || el.getAttribute('routerlink'),
        class: el.className?.slice(0, 40),
      }))
      .filter(l => l.text && (l.text.toLowerCase().includes('book') || l.text.toLowerCase().includes('appoint') || l.text.toLowerCase().includes('randev') || l.text.toLowerCase().includes('al ') || l.rl))
      .slice(0, 15);
  });

  console.log('\nBulunan linkler:', JSON.stringify(links, null, 2));

  if (links.length > 0) {
    for (const link of links) {
      console.log(`Tıklanıyor: "${link.text}"`);
      try {
        const el = page.locator(`text="${link.text}"`).first();
        if (await el.count() > 0) {
          await el.click({ timeout: 3000 });
          await new Promise(r => setTimeout(r, 2000));
          console.log('URL şimdi:', page.url());
        }
      } catch {}
    }
  }

  // Tüm DOM'u incele
  const domSummary = await page.evaluate(() => {
    const all = Array.from(document.querySelectorAll('*'));
    const components = all.filter(el => el.tagName.toLowerCase().startsWith('app-')).map(el => el.tagName).slice(0, 20);
    const matEls = all.filter(el => el.tagName.toLowerCase().startsWith('mat-')).map(el => el.tagName + (el.getAttribute('formcontrolname') ? `[${el.getAttribute('formcontrolname')}]` : '')).slice(0, 20);
    const bodyText = document.body.innerText.slice(0, 300);
    return { components, matEls, bodyText, url: location.href };
  });

  console.log('\nDOM Özeti:');
  console.log('URL:', domSummary.url);
  console.log('App bileşenler:', domSummary.components);
  console.log('Mat elementler:', domSummary.matEls);
  console.log('Sayfa metni:', domSummary.bodyText.slice(0, 200));

  // 10 saniye bekle — daha fazla API çağrısı gelebilir
  console.log('\n10 saniye bekleniyor...');
  await new Promise(r => setTimeout(r, 10000));

  // Sonuçları kaydet
  const outFile = 'd:/cloudecode/visa-monitor/artifacts/login-intercept.json';
  fs.writeFileSync(outFile, JSON.stringify(captured, null, 2));
  console.log(`\n${captured.length} API çağrısı → ${outFile}`);

  const unique = [...new Set(captured.map(e => `${e.method} ${e.path?.split('?')[0]}`))];
  console.log('Benzersiz endpoint\'ler:');
  unique.forEach(u => console.log(' ', u));

  process.exit(0);
}

main().catch(e => {
  console.error('HATA:', e.message);
  console.error(e.stack);
  process.exit(1);
});
