import { chromium } from 'playwright';
const browser = await chromium.connectOverCDP('http://localhost:9222');
const page = browser.contexts()[0].pages()[0];
const jwt = await page.evaluate(() => sessionStorage.getItem('JWT'));

const result = await page.evaluate(async (jwt) => {
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
    credentials: 'include',
  });
  const headers = {};
  resp.headers.forEach((v, k) => { headers[k] = v; });
  return { status: resp.status, headers, body: (await resp.text()).slice(0, 2000) };
}, jwt);

console.log('Status:', result.status);
console.log('Response Headers:');
Object.entries(result.headers).forEach(([k,v]) => console.log(' ', k, ':', v));
console.log('\nBody excerpt:');
// Extract meaningful text from HTML
const text = result.body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 500);
console.log(text);
process.exit(0);
