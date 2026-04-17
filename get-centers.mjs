import { chromium } from 'playwright';
import fs from 'fs';
const browser = await chromium.connectOverCDP('http://localhost:9222');
const page = browser.contexts()[0].pages()[0];
const jwt = fs.readFileSync('d:/cloudecode/visa-monitor/artifacts/sessions/vfs-jwt.txt','utf-8').trim();
const result = await page.evaluate(async ({jwt}) => {
  const r = await fetch('https://lift-api.vfsglobal.com/master/center/che/tur/tr-TR', {
    headers: { Authorization: 'Bearer '+jwt, Accept: 'application/json', route: 'tur/tr/che', Origin: 'https://visa.vfsglobal.com' }
  });
  return { status: r.status, body: await r.text() };
}, {jwt});
console.log('Status:', result.status);
const centers = JSON.parse(result.body);
centers.forEach(c => console.log(c.isoCode, '|', c.centerName, '|', c.city));
process.exit(0);
