/**
 * lift-api isteğinin tüm header'larını yakala
 * Sonra aynı header'larla manuel fetch dene
 */
import { chromium } from 'playwright';

const browser = await chromium.connectOverCDP('http://localhost:9222');
const context = browser.contexts()[0];
const page = context.pages()[0];

console.log('URL:', page.url());

// Header yakalama için intercept
let capturedHeaders = null;
const client = await page.context().newCDPSession(page);

await client.send('Network.enable');
client.on('Network.requestWillBeSent', (evt) => {
  const url = evt.request.url;
  if (url.includes('lift-api') && capturedHeaders === null) {
    console.log('\nRequest yakalandı:', evt.request.method, new URL(url).pathname);
    console.log('Headers:');
    Object.entries(evt.request.headers).forEach(([k,v]) => console.log(`  ${k}: ${String(v).slice(0,80)}`));
    capturedHeaders = evt.request.headers;
  }
});

// Sayfa üzerinde CheckIsSlotAvailable'ı Angular ile tetikle
// sessionStorage'daki JWT'yi kullanarak
const jwt = await page.evaluate(() => sessionStorage.getItem('JWT'));
console.log('JWT:', jwt?.slice(0,20) + '...');

// page.evaluate ile direkt fetch — Angular headers olmadan
console.log('\n=== FETCH (headers olmadan) ===');
const r1 = await page.evaluate(async (jwt) => {
  const resp = await fetch('https://lift-api.vfsglobal.com/appointment/CheckIsSlotAvailable', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${jwt}`,
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'Origin': 'https://visa.vfsglobal.com',
      'Referer': 'https://visa.vfsglobal.com/',
      'route': 'tur/tr/che',
    },
    body: JSON.stringify({
      countryCode: 'tur', missionCode: 'che', vacCode: 'ESB',
      visaCategoryCode: 'TOR', roleName: 'Individual',
      loginUser: 'kadiraltmis@gmail.com', payCode: ''
    }),
  });
  return { status: resp.status, body: (await resp.text()).slice(0, 200) };
}, jwt);
console.log('Status:', r1.status, '— Body:', r1.body.slice(0, 100));

// Kısa bekle
await new Promise(r => setTimeout(r, 2000));

// clientsource için tüm sessionStorage içeriğini tara
const allStorage = await page.evaluate(() => {
  const r = {};
  for (let i = 0; i < sessionStorage.length; i++) {
    const k = sessionStorage.key(i);
    const v = sessionStorage.getItem(k) ?? '';
    r[k] = v.slice(0, 100);
  }
  return r;
});
console.log('\nSessionStorage anahtarları:', Object.keys(allStorage));

// Angular global objesini bul
const angularInfo = await page.evaluate(() => {
  try {
    // Angular 2+ için getAllAngularRootElements
    const roots = window.getAllAngularRootElements?.() ?? [];
    if (roots.length === 0) return { error: 'no angular roots' };

    const ng = window.ng;
    const inj = ng?.getInjector?.(roots[0]);
    if (!inj) return { error: 'no injector' };

    // HTTP interceptor'ları listele
    return { roots: roots.length, hasInjector: !!inj };
  } catch (e) {
    return { error: e.message };
  }
});
console.log('\nAngular info:', angularInfo);

process.exit(0);
