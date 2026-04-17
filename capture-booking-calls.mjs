/**
 * Booking sayfası dropdown etkileşimlerini izle
 * Tüm lift-api çağrılarını yakalar.
 */

import { chromium } from 'playwright';
import fs from 'fs';

const CDP_URL = 'http://localhost:9222';
const captured = [];

async function main() {
  const browser = await chromium.connectOverCDP(CDP_URL);
  const contexts = browser.contexts();
  const context = contexts[0] ?? await browser.newContext();
  const pages = context.pages();
  const page = pages[0] ?? await context.newPage();

  // TÜM API isteklerini dinle
  page.on('request', req => {
    const url = req.url();
    if (url.includes('lift-api') || url.includes('litf-api') || url.includes('vfsglobal')) {
      const entry = {
        t: new Date().toISOString(),
        method: req.method(),
        url,
        path: (() => { try { const u = new URL(url); return u.pathname + u.search; } catch { return url; } })(),
        postData: req.postData()?.slice(0, 200) ?? null,
        headers: {
          authorization: req.headers()['authorization']?.slice(0, 30) + '...',
          route: req.headers()['route'],
          clientsource: req.headers()['clientsource']?.slice(0, 30) + '...',
        },
      };
      captured.push(entry);
      console.log(`[REQ] ${entry.method} ${entry.path}`);
    }
  });

  page.on('response', async resp => {
    const url = resp.url();
    if (url.includes('lift-api') || url.includes('litf-api')) {
      const status = resp.status();
      const path = (() => { try { const u = new URL(url); return u.pathname + u.search; } catch { return url; } })();
      let body = '';
      try { body = (await resp.text()).slice(0, 400); } catch {}
      const entry = captured.findLast(e => e.url === url && !e.resp);
      if (entry) entry.resp = { status, body };
      console.log(`[RES] ${status} ${path}`);
      if (status === 200) console.log('      →', body.slice(0, 120));
    }
  });

  // Booking sayfasına git
  console.log('Booking sayfasına gidiliyor...');
  await page.goto('https://visa.vfsglobal.com/tur/tr/che/book-an-appointment', {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });

  // Cloudflare kontrolü
  for (let i = 0; i < 10; i++) {
    const t = await page.title().catch(() => '');
    if (!t.includes('Just a moment')) break;
    process.stdout.write('.');
    await new Promise(r => setTimeout(r, 1000));
  }

  console.log('\nSayfa yüklendi, Angular init bekleniyor...');
  await new Promise(r => setTimeout(r, 4000));

  // Sayfadaki tüm interaktif elementleri bul
  const summary = await page.evaluate(() => {
    const selects = Array.from(document.querySelectorAll('mat-select, select, ng-select, [role="combobox"], [role="listbox"]'));
    const buttons = Array.from(document.querySelectorAll('button')).slice(0, 5);
    return {
      selects: selects.map(el => ({ tag: el.tagName, id: el.id, class: el.className.slice(0, 50), placeholder: el.getAttribute('placeholder') })),
      buttons: buttons.map(el => ({ text: el.textContent?.trim().slice(0, 30), id: el.id })),
      url: location.href,
    };
  });

  console.log('\nMevcut URL:', summary.url);
  console.log('Select elementler:', JSON.stringify(summary.selects, null, 2));
  console.log('Butonlar:', JSON.stringify(summary.buttons, null, 2));

  // İlk dropdown'a tıkla
  if (summary.selects.length > 0) {
    console.log('\nİlk dropdown tıklanıyor...');
    try {
      const el = page.locator('mat-select, select, ng-select, [role="combobox"]').first();
      await el.click({ timeout: 5000 });
      await new Promise(r => setTimeout(r, 2000));

      // Açılan seçenekler
      const opts = await page.evaluate(() => {
        const options = Array.from(document.querySelectorAll('mat-option, option, [role="option"]'));
        return options.map(o => o.textContent?.trim()).filter(Boolean).slice(0, 10);
      });
      console.log('Seçenekler:', opts);

      if (opts.length > 0) {
        console.log('İlk seçenek seçiliyor...');
        await page.locator('mat-option, [role="option"]').first().click({ timeout: 5000 });
        await new Promise(r => setTimeout(r, 2000));
      }
    } catch (e) {
      console.log('Dropdown etkileşimi başarısız:', e.message);
    }

    // İkinci dropdown varsa
    const dropdowns = page.locator('mat-select, [role="combobox"]');
    const count = await dropdowns.count();
    if (count > 1) {
      console.log('\nİkinci dropdown tıklanıyor...');
      try {
        await dropdowns.nth(1).click({ timeout: 5000 });
        await new Promise(r => setTimeout(r, 2000));
        const opts2 = await page.evaluate(() => {
          return Array.from(document.querySelectorAll('mat-option, [role="option"]'))
            .map(o => o.textContent?.trim()).filter(Boolean).slice(0, 10);
        });
        console.log('Seçenekler:', opts2);
        if (opts2.length > 0) {
          await page.locator('mat-option, [role="option"]').first().click({ timeout: 5000 });
          await new Promise(r => setTimeout(r, 2000));
        }
      } catch (e) {
        console.log('İkinci dropdown başarısız:', e.message);
      }
    }
  }

  // 8 saniye daha izle
  console.log('\n8 saniye daha izleniyor...');
  await new Promise(r => setTimeout(r, 8000));

  // Sonuçları kaydet
  const outFile = 'd:/cloudecode/visa-monitor/artifacts/booking-calls.json';
  fs.mkdirSync('d:/cloudecode/visa-monitor/artifacts', { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(captured, null, 2));
  console.log(`\n${captured.length} çağrı kaydedildi: ${outFile}`);

  const unique = [...new Set(captured.map(e => `${e.method} ${e.path?.split('?')[0]}`))];
  console.log('\nBulunan endpoint\'ler:');
  unique.forEach(u => console.log(' ', u));

  process.exit(0);
}

main().catch(e => {
  console.error('HATA:', e.message);
  process.exit(1);
});
