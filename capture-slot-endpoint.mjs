/**
 * Dashboard'daki "Yeni Rezervasyon Başlat" butonuna tıkla,
 * booking form dropdown'larını doldur, slot API çağrısını yakala.
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
      captured.push({ method: req.method(), url, path, postData: req.postData()?.slice(0, 400) ?? null });
    }
  });

  page.on('response', async resp => {
    const url = resp.url();
    if (url.includes('lift-api') || url.includes('litf-api')) {
      const status = resp.status();
      const path = (() => { try { return new URL(url).pathname + new URL(url).search; } catch { return url; } })();
      let body = '';
      try { body = (await resp.text()).slice(0, 1000); } catch {}
      const entry = captured.findLast(e => e.url === url && !e.resp);
      if (entry) entry.resp = { status, body };
      console.log(`[RES] ${status === 200 ? '✅' : '❌'} ${status} ${path}`);
      if (status === 200 && body.length > 2) console.log('  →', body.slice(0, 300));
    }
  });

  // Mevcut URL — login-then-intercept sonrası dashboard'dayız
  const currentUrl = page.url();
  console.log('Mevcut URL:', currentUrl);

  // Dashboard değilsek dashboard'a git
  if (!currentUrl.includes('/dashboard')) {
    console.log('Dashboard\'a yönlendiriliyor...');
    // Angular router ile git — sayfa reload olmadan
    await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('a'));
      const dashLink = links.find(l => l.href?.includes('dashboard') || l.textContent?.includes('Dashboard') || l.textContent?.includes('Kontrol'));
      if (dashLink) dashLink.click();
    });
    await new Promise(r => setTimeout(r, 2000));
  }

  // "Yeni Rezervasyon Başlat" butonunu bul ve tıkla
  console.log('\nSayfa içeriği taranıyor...');
  const pageText = await page.evaluate(() => document.body.innerText.slice(0, 500));
  console.log('Sayfa metni:', pageText.slice(0, 200));

  // Butonu bul
  console.log('\n"Yeni Rezervasyon" butonu aranıyor...');
  const btnSelectors = [
    'text=Yeni Rezervasyon Başlat',
    'text=Yeni Randevu',
    'text=New Appointment',
    'text=Book Appointment',
    'button:has-text("Yeni")',
    'a:has-text("Yeni")',
    '[routerlink*="appointment"]',
    '[routerlink*="book"]',
  ];

  let clicked = false;
  for (const sel of btnSelectors) {
    try {
      const el = page.locator(sel).first();
      const cnt = await el.count();
      if (cnt > 0) {
        console.log(`Buton bulundu: "${sel}" — tıklanıyor...`);
        await el.click({ timeout: 5000 });
        clicked = true;
        await new Promise(r => setTimeout(r, 3000));
        console.log('URL şimdi:', page.url());
        break;
      }
    } catch (e) {
      // devam et
    }
  }

  if (!clicked) {
    console.log('Buton bulunamadı, tüm butonlar:');
    const allBtns = await page.evaluate(() =>
      Array.from(document.querySelectorAll('button, a[routerlink], a[routerLink], mat-list-item'))
        .map(el => el.textContent?.trim().slice(0, 50) + ' | ' + (el.getAttribute('href') || el.getAttribute('routerlink') || el.getAttribute('routerLink') || ''))
        .filter(Boolean)
        .slice(0, 20)
    );
    console.log(allBtns.join('\n'));
  }

  await new Promise(r => setTimeout(r, 2000));

  // Booking form elementleri
  console.log('\nBooking form elementleri:');
  const formEls = await page.evaluate(() => {
    const selects = Array.from(document.querySelectorAll('mat-select, select, ng-select'));
    return selects.map(el => ({
      tag: el.tagName,
      id: el.id,
      formControl: el.getAttribute('formcontrolname'),
      placeholder: el.getAttribute('placeholder'),
    }));
  });
  console.log(JSON.stringify(formEls, null, 2));

  // Dropdownları doldur
  const dropdowns = page.locator('mat-select');
  const cnt = await dropdowns.count();
  console.log(`\nmat-select sayısı: ${cnt}`);

  for (let i = 0; i < Math.min(cnt, 3); i++) {
    try {
      console.log(`\nDropdown ${i + 1} tıklanıyor...`);
      await dropdowns.nth(i).click({ timeout: 5000 });
      await new Promise(r => setTimeout(r, 1500));

      const opts = await page.evaluate(() =>
        Array.from(document.querySelectorAll('mat-option')).map(o => o.textContent?.trim()).filter(Boolean).slice(0, 10)
      );
      console.log('Seçenekler:', opts);

      if (opts.length > 0) {
        // Schengen / Turistik / ilk seçenek
        const preferred = opts.find(o => o.toLowerCase().includes('turistik') || o.toLowerCase().includes('tourist') || o.toLowerCase().includes('schengen')) ?? opts[0];
        console.log(`Seçiliyor: "${preferred}"`);
        const optEl = page.locator('mat-option').filter({ hasText: preferred }).first();
        await optEl.click({ timeout: 3000 });
        await new Promise(r => setTimeout(r, 2000));
      } else {
        // Escape ile kapat
        await page.keyboard.press('Escape');
      }
    } catch (e) {
      console.log(`Dropdown ${i + 1} hatası:`, e.message);
    }
  }

  // 10 saniye daha izle
  console.log('\n10 saniye izleniyor...');
  await new Promise(r => setTimeout(r, 10000));

  // Sonuçları kaydet
  const outFile = 'd:/cloudecode/visa-monitor/artifacts/slot-endpoint-capture.json';
  fs.mkdirSync('d:/cloudecode/visa-monitor/artifacts', { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(captured, null, 2));
  console.log(`\n${captured.length} API çağrısı → ${outFile}`);

  const unique = [...new Set(captured.map(e => `${e.method} ${e.path?.split('?')[0]}`))];
  console.log('\nEndpoint\'ler:');
  unique.forEach(u => console.log(' ', u));

  process.exit(0);
}

main().catch(e => {
  console.error('HATA:', e.message, '\n', e.stack);
  process.exit(1);
});
