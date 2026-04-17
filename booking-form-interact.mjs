/**
 * Cookie onayla → Yeni Rezervasyon Başlat → Dropdown'ları doldur → Slot endpoint yakala
 */

import { chromium } from 'playwright';
import fs from 'fs';

const CDP_URL = 'http://localhost:9222';
const captured = [];

async function main() {
  const browser = await chromium.connectOverCDP(CDP_URL);
  const context = browser.contexts()[0];
  const page = context.pages()[0] ?? await context.newPage();

  // Intercept
  page.on('request', req => {
    const url = req.url();
    if (url.includes('lift-api') || url.includes('litf-api')) {
      const path = (() => { try { return new URL(url).pathname + new URL(url).search; } catch { return url; } })();
      console.log(`[REQ] ${req.method()} ${path}`);
      captured.push({ method: req.method(), url, path, postData: req.postData()?.slice(0, 500) ?? null });
    }
  });

  page.on('response', async resp => {
    const url = resp.url();
    if (url.includes('lift-api') || url.includes('litf-api')) {
      const status = resp.status();
      const path = (() => { try { return new URL(url).pathname + new URL(url).search; } catch { return url; } })();
      let body = '';
      try { body = (await resp.text()).slice(0, 1200); } catch {}
      const entry = captured.findLast(e => e.url === url && !e.resp);
      if (entry) entry.resp = { status, body };
      console.log(`[RES] ${status === 200 ? '✅' : '❌'} ${status} ${path}`);
      if (status === 200 && body.length > 2) console.log('  →', body.slice(0, 400));
    }
  });

  console.log('URL:', page.url());

  // 1. Cookie consent'i kapat
  console.log('\n1. Cookie consent kapatılıyor...');
  try {
    const cookieBtn = page.locator('button:has-text("Tümüne İzin Ver"), button:has-text("Accept"), button:has-text("Kabul")').first();
    if (await cookieBtn.count() > 0) {
      await cookieBtn.click({ timeout: 3000 });
      console.log('Cookie onaylandı');
      await new Promise(r => setTimeout(r, 1000));
    }
  } catch {}

  try {
    const confirmBtn = page.locator('button:has-text("Seçimlerimi Onayla")').first();
    if (await confirmBtn.count() > 0) {
      await confirmBtn.click({ timeout: 3000 });
      console.log('Seçimler onaylandı');
      await new Promise(r => setTimeout(r, 1000));
    }
  } catch {}

  // 2. Dashboard kontrol
  console.log('\n2. Dashboard durumu:');
  const bodyText = await page.evaluate(() => document.body.innerText.slice(0, 300));
  console.log(bodyText.slice(0, 200));

  // 3. "Yeni Rezervasyon Başlat" — direkt JavaScript ile tıkla
  console.log('\n3. "Yeni Rezervasyon Başlat" tıklanıyor...');
  const clicked = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button, a, span, div'));
    const btn = btns.find(el => el.textContent?.trim() === 'Yeni Rezervasyon Başlat');
    if (btn) {
      btn.click();
      return btn.tagName + ' | ' + btn.className.slice(0, 50);
    }
    return null;
  });
  console.log('Tıklanan element:', clicked);
  await new Promise(r => setTimeout(r, 3000));
  console.log('URL:', page.url());

  // 4. Booking formu var mı?
  let attempts = 0;
  while (attempts < 5) {
    const cnt = await page.locator('mat-select').count();
    const url = page.url();
    console.log(`\nDenem ${attempts + 1}: URL=${url}, mat-select=${cnt}`);
    if (cnt > 0) break;

    // URL değişimi yoksa başka şeyler dene
    if (attempts === 1) {
      // Direkt URL ile git
      console.log('Angular navigate deneniyor...');
      await page.evaluate(() => {
        // Angular Router'ı bul
        try {
          const roots = window.getAllAngularRootElements?.() ?? [];
          if (roots.length > 0) {
            const ng = window.ng;
            const inj = ng?.getInjector?.(roots[0]);
            // router token
            const routerToken = { toString: () => 'Router' };
            return 'injector: ' + !!inj;
          }
        } catch {}
        return 'no router';
      });
    }

    if (attempts === 2) {
      // "Yeni Rezervasyon" linkini bul
      const linkClicked = await page.evaluate(() => {
        const all = Array.from(document.querySelectorAll('*'));
        for (const el of all) {
          const text = el.textContent?.trim();
          if (text === 'Yeni Rezervasyon Başlat' && el.children.length === 0) {
            el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            return 'dispatched on: ' + el.tagName;
          }
        }
        return null;
      });
      console.log('Event dispatch:', linkClicked);
    }

    await new Promise(r => setTimeout(r, 2000));
    attempts++;
  }

  // 5. Sayfadaki tüm form elementleri
  const formEls = await page.evaluate(() => {
    const items = [];
    document.querySelectorAll('mat-select, select, [formcontrolname], mat-form-field').forEach(el => {
      items.push({
        tag: el.tagName,
        fc: el.getAttribute('formcontrolname'),
        id: el.id,
        placeholder: el.querySelector('mat-placeholder, mat-label')?.textContent?.trim(),
        html: el.outerHTML.slice(0, 100),
      });
    });
    return items;
  });
  console.log('\nForm elementler:', JSON.stringify(formEls, null, 2));

  // 6. Dropdown'larla etkileşim
  const dropdowns = page.locator('mat-select');
  const dCnt = await dropdowns.count();
  console.log(`\nmat-select sayısı: ${dCnt}`);

  for (let i = 0; i < dCnt; i++) {
    try {
      console.log(`\nDropdown ${i + 1} tıklanıyor...`);
      await dropdowns.nth(i).scrollIntoViewIfNeeded();
      await dropdowns.nth(i).click({ timeout: 5000 });
      await new Promise(r => setTimeout(r, 2000));

      const opts = await page.evaluate(() =>
        Array.from(document.querySelectorAll('mat-option')).map(o => ({
          text: o.textContent?.trim(),
          value: o.getAttribute('value') || o.getAttribute('ng-reflect-value'),
        })).slice(0, 15)
      );
      console.log('Seçenekler:', opts);

      if (opts.length > 0) {
        const pref = opts.find(o =>
          o.text?.toLowerCase().includes('turistik') ||
          o.text?.toLowerCase().includes('tourist') ||
          o.text?.toLowerCase().includes('ankara') ||
          o.text?.toLowerCase().includes('schengen')
        ) ?? opts[0];

        console.log('Seçiliyor:', pref.text);
        await page.locator('mat-option').filter({ hasText: pref.text }).first().click({ timeout: 3000 });
        await new Promise(r => setTimeout(r, 3000)); // API çağrısı için bekle
      } else {
        await page.keyboard.press('Escape');
      }
    } catch (e) {
      console.log(`Dropdown ${i + 1} hatası:`, e.message.slice(0, 100));
      try { await page.keyboard.press('Escape'); } catch {}
    }
  }

  // 7. Takvim/calendar yüklendiyse bekle
  await new Promise(r => setTimeout(r, 5000));

  // Sonuçları kaydet
  const outFile = 'd:/cloudecode/visa-monitor/artifacts/slot-endpoint-capture.json';
  fs.writeFileSync(outFile, JSON.stringify(captured, null, 2));
  console.log(`\n${captured.length} API çağrısı → ${outFile}`);

  const unique = [...new Set(captured.map(e => `${e.method} ${e.path?.split('?')[0]}`))];
  console.log('\nTüm endpoint\'ler:');
  unique.forEach(u => console.log(' ', u));

  process.exit(0);
}

main().catch(e => {
  console.error('HATA:', e.message, '\n', e.stack);
  process.exit(1);
});
