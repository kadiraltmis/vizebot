import { chromium } from 'playwright';

const browser = await chromium.connectOverCDP('http://localhost:9222');
const contexts = browser.contexts();
const context = contexts[0];
const pages = context.pages();
const page = pages[0];

// Şu an hangi sayfadayız?
console.log('URL:', page.url());

// Tüm input'ları listele
const inputs = await page.evaluate(() => {
  return Array.from(document.querySelectorAll('input')).map(inp => ({
    type: inp.type,
    id: inp.id,
    name: inp.name,
    placeholder: inp.placeholder,
    class: inp.className,
    formcontrolname: inp.getAttribute('formcontrolname'),
    tabindex: inp.tabIndex,
    hidden: inp.offsetParent === null,
    value: inp.value ? inp.value.substring(0, 20) : ''
  }));
});

console.log('Tüm input\'lar:');
inputs.forEach((inp, i) => console.log(i, JSON.stringify(inp)));

// Görünür butonlar
const buttons = await page.evaluate(() => {
  return Array.from(document.querySelectorAll('button')).map(btn => ({
    text: btn.innerText.trim().substring(0, 50),
    class: btn.className,
    disabled: btn.disabled,
    type: btn.type
  }));
});
console.log('\nButonlar:');
buttons.forEach((b, i) => console.log(i, JSON.stringify(b)));

process.exit(0);
