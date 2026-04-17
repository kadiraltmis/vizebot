/**
 * Angular UI dropdown etkileşimiyle CheckIsSlotAvailable tetikle.
 * Manuel fetch YOK — sadece Angular'ın kendi isteği.
 */
import { chromium } from 'playwright';

const browser = await chromium.connectOverCDP('http://localhost:9222');
const context = browser.contexts()[0];
const page = context.pages()[0];

// Response intercept
let slotResult = null;
page.on('response', async (resp) => {
  if (resp.url().includes('/appointment/CheckIsSlotAvailable')) {
    const status = resp.status();
    const body = await resp.text().catch(() => '');
    console.log(`[Angular RES] ${status} CheckIsSlotAvailable`);
    console.log('  Body:', body.slice(0, 300));
    if (status === 200) {
      slotResult = { status, body };
    }
  }
});

console.log('URL:', page.url());
const jwt = await page.evaluate(() => sessionStorage.getItem('JWT'));
console.log('JWT:', jwt?.slice(0,20) + '...');

// mat-select'leri bul
const drops = page.locator('mat-select');
const cnt = await drops.count();
console.log('mat-select sayısı:', cnt);

if (cnt < 3) {
  console.log('Yeterli dropdown yok — application-detail değil mi?');
  const text = await page.evaluate(() => document.body.innerText.slice(0,200));
  console.log('Sayfa:', text);
  process.exit(1);
}

// Dropdown 1: Center code (ESB)
console.log('\n[1] Center dropdown tıklanıyor...');
await drops.first().click({ timeout: 5000 });
await new Promise(r => setTimeout(r, 1500));
const opts1 = page.locator('mat-option');
const opts1texts = await opts1.allTextContents();
console.log('Merkezler:', opts1texts);
if (opts1texts.length > 0) {
  const ankara = opts1.filter({ hasText: 'Ankara' }).first();
  if (await ankara.count() > 0) {
    await ankara.click();
  } else {
    await opts1.first().click();
  }
  await new Promise(r => setTimeout(r, 2000));
}

// Dropdown 2: Visa category (parent)
console.log('\n[2] Visa category dropdown tıklanıyor...');
await drops.nth(1).click({ timeout: 5000 });
await new Promise(r => setTimeout(r, 1500));
const opts2 = page.locator('mat-option');
const opts2texts = await opts2.allTextContents();
console.log('Kategoriler:', opts2texts);
if (opts2texts.length > 0) {
  const turizm = opts2.filter({ hasText: /Turizm|Schengen/i }).first();
  if (await turizm.count() > 0) {
    await turizm.click();
  } else {
    await opts2.first().click();
  }
  await new Promise(r => setTimeout(r, 2000));
}

// Dropdown 3: Sub visa category — bu CheckIsSlotAvailable'ı tetikler
console.log('\n[3] Sub-visa category dropdown tıklanıyor...');
await drops.nth(2).click({ timeout: 5000 });
await new Promise(r => setTimeout(r, 1500));
const opts3 = page.locator('mat-option');
const opts3texts = await opts3.allTextContents();
console.log('Alt kategoriler:', opts3texts);
if (opts3texts.length > 0) {
  const turistik = opts3.filter({ hasText: /Turistik|Tourist/i }).first();
  if (await turistik.count() > 0) {
    await turistik.click();
  } else {
    await opts3.first().click();
  }
}

// CheckIsSlotAvailable için bekle
console.log('\nCheckIsSlotAvailable bekleniyor (5s)...');
await new Promise(r => setTimeout(r, 5000));

if (slotResult) {
  console.log('\n✅ Angular isteği başarılı!');
  const data = JSON.parse(slotResult.body);
  if (data.earliestDate) {
    console.log('🎉 SLOT BULUNDU:', data.earliestDate);
  } else {
    console.log('Slot yok:', data.error?.description);
    console.log('(Bu NORMAL — endpoint çalışıyor, slot şu an müsait değil)');
  }
} else {
  console.log('\n❌ CheckIsSlotAvailable tetiklenmedi');
}

process.exit(0);
