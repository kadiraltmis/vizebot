/**
 * Angular'ın bir isteğinden clientsource yakala,
 * sonra CheckIsSlotAvailable POST'unda kullan
 */
import { chromium } from 'playwright';

const browser = await chromium.connectOverCDP('http://localhost:9222');
const context = browser.contexts()[0];
const page = context.pages()[0];

console.log('URL:', page.url());

// CDP Network interception ile Angular request'lerinden header yakala
const client = await context.newCDPSession(page);
await client.send('Network.enable');

let clientsource = null;
let captureResolve;
const capturePromise = new Promise(res => { captureResolve = res; });

client.on('Network.requestWillBeSent', (evt) => {
  const url = evt.request.url;
  if (url.includes('lift-api') && evt.request.headers['clientsource'] && !clientsource) {
    clientsource = evt.request.headers['clientsource'];
    console.log('\nClientsource yakalandı! İlk 30:', clientsource.slice(0, 30) + '...');
    captureResolve(clientsource);
  }
});

// Angular'ı tetikle — sayfayı reload et (Angular init sırasında API çağırıyor)
console.log('Sayfa yenileniyor — Angular init API çağrıları tetiklenecek...');
await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
await new Promise(r => setTimeout(r, 5000));

if (!clientsource) {
  console.log('Clientsource hâlâ alınamadı, 5s daha bekleniyor...');
  await new Promise(r => setTimeout(r, 5000));
}

if (!clientsource) {
  console.error('Clientsource yakalanamadı.');
  process.exit(1);
}

// Şimdi bu clientsource ile POST yap
const jwt = await page.evaluate(() => sessionStorage.getItem('JWT'));
console.log('\nJWT:', jwt?.slice(0, 20) + '...');

console.log('\n=== CheckIsSlotAvailable POST (clientsource ile) ===');
const result = await page.evaluate(async ({ jwt, clientsource }) => {
  const resp = await fetch('https://lift-api.vfsglobal.com/appointment/CheckIsSlotAvailable', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${jwt}`,
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'Origin': 'https://visa.vfsglobal.com',
      'Referer': 'https://visa.vfsglobal.com/',
      'route': 'tur/tr/che',
      'clientsource': clientsource,
    },
    body: JSON.stringify({
      countryCode: 'tur', missionCode: 'che', vacCode: 'ESB',
      visaCategoryCode: 'TOR', roleName: 'Individual',
      loginUser: 'kadiraltmis@gmail.com', payCode: ''
    }),
  });
  return { status: resp.status, body: (await resp.text()).slice(0, 400) };
}, { jwt, clientsource });

console.log('Status:', result.status);
console.log('Body:', result.body.slice(0, 300));

// Istanbul için de dene
if (result.status === 200) {
  console.log('\n=== IST (Istanbul) ===');
  const r2 = await page.evaluate(async ({ jwt, clientsource }) => {
    const resp = await fetch('https://lift-api.vfsglobal.com/appointment/CheckIsSlotAvailable', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${jwt}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Origin': 'https://visa.vfsglobal.com',
        'Referer': 'https://visa.vfsglobal.com/',
        'route': 'tur/tr/che',
        'clientsource': clientsource,
      },
      body: JSON.stringify({
        countryCode: 'tur', missionCode: 'che', vacCode: 'IST',
        visaCategoryCode: 'TOR', roleName: 'Individual',
        loginUser: 'kadiraltmis@gmail.com', payCode: ''
      }),
    });
    return { status: resp.status, body: (await resp.text()).slice(0, 400) };
  }, { jwt, clientsource });
  console.log('Status:', r2.status, '— Body:', r2.body.slice(0, 200));
}

console.log('\nClientsource tam değer (kaydet):', clientsource);
process.exit(0);
