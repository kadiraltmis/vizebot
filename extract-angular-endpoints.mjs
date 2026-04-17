/**
 * VFS Angular bundle'ından API endpoint'lerini çıkar
 * main.js ve diğer chunk'ları indir, lift-api path'lerini ara
 */

import { chromium } from 'playwright';
import fs from 'fs';

const CDP_URL = 'http://localhost:9222';
const OUT = 'd:/cloudecode/visa-monitor/artifacts/angular-endpoints.txt';

async function main() {
  const browser = await chromium.connectOverCDP(CDP_URL);
  const contexts = browser.contexts();
  const context = contexts[0];
  const pages = context.pages();
  const page = pages[0] ?? await context.newPage();

  // Angular asset URL'lerini topla
  const angularAssets = [];
  page.on('response', async resp => {
    const url = resp.url();
    if (url.includes('liftassets.vfsglobal.com') && url.endsWith('.js')) {
      angularAssets.push(url);
    }
  });

  // Angular asset'lerinin yüklendiği URL — liftassets CDN'i
  // Önce login sayfası URL'lerini topla
  console.log('Angular asset URL\'leri toplanıyor...');
  await page.goto('https://visa.vfsglobal.com/tur/tr/che/login', {
    waitUntil: 'networkidle',
    timeout: 40000,
  }).catch(() => {});

  // Cloudflare bekle
  for (let i = 0; i < 10; i++) {
    const t = await page.title().catch(() => '');
    if (!t.includes('Just a moment')) break;
    await new Promise(r => setTimeout(r, 1000));
  }

  // Sayfa kaynaklarından Angular JS dosyalarını bul
  const jsFiles = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('script[src]'))
      .map(s => s.src)
      .filter(s => s.includes('liftassets') || s.includes('angular'));
  });

  console.log('Bulunan JS dosyaları:', jsFiles.length);
  jsFiles.forEach(f => console.log(' ', f));

  // Eğer hiç bulunamadıysa, iframe içinde ara
  const iframeFiles = await page.evaluate(() => {
    const result = [];
    for (const frame of document.querySelectorAll('iframe')) {
      try {
        const scripts = frame.contentDocument?.querySelectorAll('script[src]') ?? [];
        for (const s of scripts) result.push(s.src);
      } catch {}
    }
    return result;
  });
  console.log('Iframe JS dosyaları:', iframeFiles.length);

  // Angular CDN'den direkt bundle URL dene
  const angularBundleUrls = [
    'https://liftassets.vfsglobal.com/_angular/main.js',
    'https://liftassets.vfsglobal.com/_angular/runtime.js',
    'https://liftassets.vfsglobal.com/_angular/polyfills.js',
    ...jsFiles,
    ...iframeFiles,
    ...angularAssets,
  ];

  // Benzersiz URL'ler
  const uniqueUrls = [...new Set(angularBundleUrls)].filter(Boolean);
  console.log('\nİndirilecek dosyalar:', uniqueUrls.length);

  const allEndpoints = new Set();
  const patterns = [
    // Tam URL pattern'leri
    /lift-api\.vfsglobal\.com\/([a-zA-Z\/\-_?=&]+)/g,
    // Relative path pattern'leri (yaygın Angular servis kodu)
    /`\$\{[^}]+\}\/([a-zA-Z\/\-_]+\/che\/tur[^`"']*)`/g,
    /["']\/([a-zA-Z]+\/[a-zA-Z\/\-_]*(?:appointment|centre|center|vac|slot)[a-zA-Z\/\-_?=&]*)["']/gi,
    // API path string'leri
    /["'](\/(?:appointment|vac|centre|center|slot|booking)[^"'\s]{3,60})["']/gi,
  ];

  for (const url of uniqueUrls.slice(0, 20)) {
    try {
      console.log(`\nİndiriliyor: ${url}`);
      const content = await page.evaluate(async (url) => {
        try {
          const resp = await fetch(url, { credentials: 'omit' });
          if (!resp.ok) return null;
          return await resp.text();
        } catch {
          return null;
        }
      }, url);

      if (!content) {
        console.log('  → Alınamadı');
        continue;
      }

      console.log(`  → ${(content.length / 1024).toFixed(1)}KB`);

      // Pattern'leri uygula
      for (const pattern of patterns) {
        pattern.lastIndex = 0;
        let match;
        while ((match = pattern.exec(content)) !== null) {
          const endpoint = match[1];
          if (endpoint && endpoint.length > 5 && endpoint.length < 100) {
            allEndpoints.add(endpoint);
          }
        }
      }

      // lift-api geçen satırları kaydet
      const lines = content.split('\n');
      const relevant = lines
        .filter(l => l.includes('lift-api') || l.includes('appointment') || l.includes('/vac/') || l.includes('/centre/') || l.includes('/slot'))
        .map(l => l.trim().slice(0, 300));

      if (relevant.length > 0) {
        console.log(`  → ${relevant.length} ilgili satır`);
        relevant.slice(0, 10).forEach(l => console.log('    ', l.slice(0, 150)));
      }

    } catch (e) {
      console.log('  → HATA:', e.message);
    }
  }

  // Sonuçları yaz
  const result = [...allEndpoints].sort();
  fs.writeFileSync(OUT, result.join('\n'));
  console.log(`\n${result.length} endpoint bulundu → ${OUT}`);
  result.forEach(e => console.log(' ', e));

  process.exit(0);
}

main().catch(e => {
  console.error('HATA:', e.message);
  process.exit(1);
});
