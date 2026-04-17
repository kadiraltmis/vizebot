/**
 * VfsGlobalProvider'ı doğrudan test eder
 */

import 'dotenv/config';
import { VfsGlobalProvider } from './dist/providers/vfs-global.provider.js';
import { loadConfig } from './dist/config/loader.js';

const config = loadConfig();
const providerConfig = config.providers.find(p => p.id === 'vfs-global-tur-che');
if (!providerConfig) throw new Error('Provider config bulunamadı');

console.log('Provider config:', JSON.stringify(providerConfig, null, 2));

const provider = new VfsGlobalProvider(providerConfig);

console.log('\n=== SLOT KONTROLÜ BAŞLADI ===\n');
const slots = await provider.checkAvailability();

if (slots.length === 0) {
  console.log('\n❌ Slot bulunamadı (şu an müsait randevu yok)');
} else {
  console.log(`\n✅ ${slots.length} SLOT BULUNDU!`);
  slots.forEach(s => console.log(' ', s.date, s.time, s.city, s.consulate));
}

process.exit(0);
