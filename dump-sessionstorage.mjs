import { chromium } from 'playwright';
const browser = await chromium.connectOverCDP('http://localhost:9222');
const page = browser.contexts()[0].pages()[0];
console.log('URL:', page.url());
const storage = await page.evaluate(() => {
  const r = {};
  for (let i = 0; i < sessionStorage.length; i++) {
    const k = sessionStorage.key(i);
    r[k] = sessionStorage.getItem(k);
  }
  return r;
});
Object.entries(storage).forEach(([k,v]) => console.log(k, '=', String(v).slice(0,80)));
process.exit(0);
