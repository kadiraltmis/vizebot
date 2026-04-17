/**
 * Provider'ı verbose modda test eder — CheckIsSlotAvailable cevabını gösterir
 */
import 'dotenv/config';
import { chromium } from 'playwright';

const browser = await chromium.connectOverCDP('http://localhost:9222');
const context = browser.contexts()[0];
const page = context.pages()[0];

// CheckIsSlotAvailable response'larını yakala
page.on('response', async resp => {
  if (resp.url().includes('/appointment/CheckIsSlotAvailable')) {
    const status = resp.status();
    const body = await resp.text().catch(() => '');
    console.log(`\n[CheckIsSlotAvailable] Status: ${status}`);
    try {
      const data = JSON.parse(body);
      console.log('earliestDate:', data.earliestDate);
      console.log('error:', JSON.stringify(data.error));
      if (data.earliestDate) {
        console.log('🎉 SLOT BULUNDU:', data.earliestDate);
      }
    } catch {
      console.log('Body:', body.slice(0, 200));
    }
  }
});

// Provider'ı çalıştır
const { VfsGlobalProvider } = await import('./dist/providers/vfs-global.provider.js');
const { loadConfig } = await import('./dist/config/loader.js');

const config = loadConfig();
const providerConfig = config.providers.find(p => p.id === 'vfs-global-tur-che');
const provider = new VfsGlobalProvider(providerConfig);

console.log('Slot kontrolü başlıyor...\n');
const slots = await provider.checkAvailability();
console.log('\nSonuç:', slots.length, 'slot bulundu');
if (slots.length > 0) {
  slots.forEach(s => console.log(' -', s.date, s.time, s.city));
}
process.exit(0);
