/**
 * Angular'ın CheckIsSlotAvailable isteği ile benim manuel fetch'imi karşılaştır
 */
import { chromium } from 'playwright';

const browser = await chromium.connectOverCDP('http://localhost:9222');
const context = browser.contexts()[0];
const page = context.pages()[0];

console.log('URL:', page.url());

const capturedRequests = {};
const client = await context.newCDPSession(page);
await client.send('Network.enable');

client.on('Network.requestWillBeSent', (evt) => {
  const url = evt.request.url;
  if (url.includes('/appointment/CheckIsSlotAvailable')) {
    const id = evt.requestId;
    console.log('\n=== REQUEST YAKALANDI ===');
    console.log('Initiator:', JSON.stringify(evt.initiator).slice(0, 100));
    console.log('Headers:');
    Object.entries(evt.request.headers).sort(([a],[b]) => a.localeCompare(b)).forEach(([k,v]) => {
      console.log(`  ${k}: ${String(v).slice(0, 100)}`);
    });
    capturedRequests[id] = { headers: evt.request.headers, initiator: evt.initiator };
  }
});

client.on('Network.responseReceived', (evt) => {
  const url = evt.response.url;
  if (url.includes('/appointment/CheckIsSlotAvailable')) {
    const req = capturedRequests[evt.requestId];
    if (req) {
      req.responseStatus = evt.response.status;
      console.log(`\nRESPONSE: ${evt.response.status} (${evt.initiator?.type ?? 'unknown'})`);
    }
  }
});

const jwt = await page.evaluate(() => sessionStorage.getItem('JWT'));
if (!jwt) { console.error('JWT yok'); process.exit(1); }
console.log('JWT:', jwt.slice(0, 20) + '...');

// 1. Angular'ı tetikle — dropdown tıkla
console.log('\n--- 1. ANGULAR İSTEĞİ TETİKLENİYOR ---');
const drops = page.locator('mat-select');
const cnt = await drops.count();
console.log('mat-select sayısı:', cnt);

if (cnt > 0) {
  try {
    await drops.first().click({ timeout: 5000 });
    await new Promise(r => setTimeout(r, 1000));
    const opts = page.locator('mat-option');
    if (await opts.count() > 0) {
      await opts.first().click({ timeout: 3000 });
      await new Promise(r => setTimeout(r, 3000));
    } else {
      await page.keyboard.press('Escape');
    }
    // Son dropdown — visa category seç (bu CheckIsSlotAvailable tetikler)
    if (cnt >= 3) {
      const lastDrop = drops.nth(2);
      await lastDrop.click({ timeout: 5000 });
      await new Promise(r => setTimeout(r, 1000));
      const lastOpts = page.locator('mat-option');
      if (await lastOpts.count() > 0) {
        await lastOpts.first().click({ timeout: 3000 });
        await new Promise(r => setTimeout(r, 3000));
      }
    }
  } catch (e) {
    console.log('Dropdown hatası:', e.message);
  }
}

await new Promise(r => setTimeout(r, 2000));

// 2. Manuel fetch dene (headers karşılaştırma için)
console.log('\n--- 2. MANUEL FETCH ---');
const csFromAngular = Object.values(capturedRequests)[0]?.headers?.['clientsource'] ?? null;
console.log('Angular clientsource alındı:', !!csFromAngular, csFromAngular?.length);

await page.evaluate(
  async ({ jwt, cs }) => {
    const headers = {
      'Authorization': `Bearer ${jwt}`,
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'Origin': 'https://visa.vfsglobal.com',
      'Referer': 'https://visa.vfsglobal.com/',
      'route': 'tur/tr/che',
    };
    if (cs) headers['clientsource'] = cs;
    await fetch('https://lift-api.vfsglobal.com/appointment/CheckIsSlotAvailable', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        countryCode: 'tur', missionCode: 'che', vacCode: 'ESB',
        visaCategoryCode: 'TOR', roleName: 'Individual',
        loginUser: 'kadiraltmis@gmail.com', payCode: ''
      }),
      credentials: 'include',
    });
    // Response'u yakalamak için önce göndermek yeterli
  },
  { jwt, cs: csFromAngular }
);

await new Promise(r => setTimeout(r, 2000));

// Karşılaştır
const reqs = Object.values(capturedRequests);
console.log('\n=== TOPLAM YAKALANAN İSTEK:', reqs.length, '===');
reqs.forEach((req, i) => {
  console.log(`\n[${i+1}] Status: ${req.responseStatus} | Initiator: ${req.initiator?.type}`);
  const keys = Object.keys(req.headers).sort();
  keys.forEach(k => console.log(`  ${k}: ${String(req.headers[k]).slice(0, 80)}`));
});

process.exit(0);
