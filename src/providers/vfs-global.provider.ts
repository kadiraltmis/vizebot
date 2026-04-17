/**
 * VFS Global Generic Provider
 *
 * Tüm VFS Global ülke kombinasyonları için temel sınıf.
 * Ülkeye özgü subclass'lar:
 *   - VfsGlobalCheProvider  (Turkey → Switzerland)
 *   - VfsGlobalMltProvider  (Turkey → Malta)
 *
 * Strateji:
 *   1. CDP üzerinden Chrome'a bağlanılır (yoksa headless Chrome açılır).
 *   2. JWT env/cache'den alınır; yoksa otomatik login + Telegram OTP akışı.
 *   3. Angular UI dropdown etkileşimiyle CheckIsSlotAvailable tetiklenir
 *      (page.evaluate(fetch) Cloudflare tarafından bloklandığı için).
 *   4. Bulunan slotlar döndürülür; Telegram alarmı engine tarafından gönderilir.
 *
 * JWT yenileme:
 *   artifacts/sessions/vfs-jwt.txt dosyasını silerek zorla.
 */

import fs from 'fs';
import path from 'path';
import { BaseProvider } from './base.provider.js';
import type { Slot } from '../types/slot.types.js';
import { buildSlotId } from '../utils/hash.js';
import { waitForOtp, sendTelegramMessage } from '../utils/telegram-otp.js';
import { waitForEmailOtp } from '../utils/email-otp.js';
import { withBrowserLock } from '../utils/browser-mutex.js';

// ── JWT cache — tüm VFS ülkeleri aynı hesabı kullanıyor ───────────────────────

const JWT_CACHE_FILE = path.resolve(process.cwd(), 'artifacts', 'sessions', 'vfs-jwt.txt');

// ── Paylaşılan login promise — aynı anda sadece 1 login ───────────────────────
// Tüm provider instance'ları bu module-level değişkeni paylaşır.

let sharedLoginPromise: Promise<string> | null = null;

// ── Tip tanımları ─────────────────────────────────────────────────────────────

interface VfsSlotResult {
  earliestDate?: string | null;
  earliestSlotLists?: unknown[];
  error?: { code: number; description: string; type: string };
  [key: string]: unknown;
}

interface VfsCentre {
  code: string;
  city: string;
  label: string; // Angular mat-option'daki metin
}

// ── Generic base ──────────────────────────────────────────────────────────────

export abstract class VfsGlobalBaseProvider extends BaseProvider {
  /** Hedef ülke kodu (URL'de kullanılır): 'che', 'mlt', … */
  protected abstract readonly missionCountry: string;
  /** Hedef ülke adı (Slot.country): 'Switzerland', 'Malta', … */
  protected abstract readonly countryName: string;
  /** ISO 2 harfli ülke kodu (slot ID için): 'CH', 'MT', … */
  protected abstract readonly countryCode: string;
  /** VFS merkezleri — /master/center/{mission}/{origin}/{locale} API'sinden öğrenilir */
  protected abstract readonly centres: VfsCentre[];

  private get urls() {
    const base = `https://visa.vfsglobal.com/tur/tr/${this.missionCountry}`;
    return {
      login:    `${base}/login`,
      bookAppt: `${base}/application-detail`,
      dashboard: `${base}/dashboard`,
    };
  }

  // ── Giriş noktası ─────────────────────────────────────────────────────────

  async checkAvailability(): Promise<Slot[]> {
    try {
      return await this._checkAvailabilityInner();
    } catch (e) {
      const msg = String(e);
      // CDP bağlantısı kopmuşsa session sıfırla ve bir kez daha dene
      if (msg.includes('TargetClosedError') || msg.includes('Target page') || msg.includes('browser has been closed')) {
        this.log.warn('CDP bağlantısı kopmuş — session sıfırlanıyor');
        this.session = null;
        try {
          return await this._checkAvailabilityInner();
        } catch {
          // Tekrar deneme de başarısız olduysa boş döndür
          return [];
        }
      }
      // Chrome henüz açık değil → boş döndür, bir sonraki döngüde tekrar denenecek
      if (msg.includes('CDP bağlantısı kurulamadı') || msg.includes('connectOverCDP')) {
        this.log.warn('Chrome CDP bağlantısı yok — bu döngü atlanıyor');
        return [];
      }
      throw e;
    }
  }

  private async _checkAvailabilityInner(): Promise<Slot[]> {
    let jwt = await this.resolveJwt();

    // fetchSlotsWithJwt browser mutex içinde çalışır
    let slots = await withBrowserLock(() => this.fetchSlotsWithJwt(jwt));

    if (slots === null) {
      this.log.warn('JWT geçersiz — yeniden giriş yapılıyor');
      jwt = await this.getSharedLogin();
      slots = await withBrowserLock(() => this.fetchSlotsWithJwt(jwt));
    }

    return slots ?? [];
  }

  // ── JWT Çözümleme (browser lock gerektirmez) ──────────────────────────────

  private async resolveJwt(): Promise<string> {
    const envJwt = process.env.VFS_JWT;
    if (envJwt?.trim()) return envJwt.trim();

    if (fs.existsSync(JWT_CACHE_FILE)) {
      const cached = fs.readFileSync(JWT_CACHE_FILE, 'utf-8').trim();
      if (cached) return cached;
    }

    return await this.getSharedLogin();
  }

  // ── Paylaşılan login — aynı anda sadece 1 login ───────────────────────────

  private async getSharedLogin(): Promise<string> {
    if (!sharedLoginPromise) {
      this.log.info('Login başlatılıyor...');
      sharedLoginPromise = this.loginAndExtractJwt().finally(() => {
        sharedLoginPromise = null;
      });
    } else {
      this.log.info('Başka bir login devam ediyor — bekleniyor...');
    }
    return sharedLoginPromise;
  }

  // ── Otomatik Login + OTP ──────────────────────────────────────────────────
  // Browser mutex DIŞINDA çalışır — içinde kısa browser lock'lar kullanılır.

  private async loginAndExtractJwt(): Promise<string> {
    const email    = process.env.VFS_EMAIL ?? '';
    const password = process.env.VFS_PASSWORD ?? '';
    const tgToken  = process.env.TELEGRAM_BOT_TOKEN ?? '';
    const tgChat   = process.env.TELEGRAM_CHAT_ID ?? '';

    // Faz 1: Login sayfasına git ve formu doldur (browser lock gerekli)
    let formSubmitted = false;
    await withBrowserLock(async () => {
      await this.ensureSession(false);
      this.log.info('VFS login sayfasına gidiliyor...');
      await this.page.goto(this.urls.login, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await this.waitForCloudflare();

      // "Oturum süresi doldu" / session expired dialog'unu kapat
      try {
        const sessionExpiredOk = this.page.locator('button:has-text("Tamam"), button:has-text("OK"), button:has-text("Close"), .mat-dialog-container button').first();
        if (await sessionExpiredOk.count() > 0) {
          await sessionExpiredOk.click({ timeout: 2_000 });
          await this.page.waitForTimeout(500);
        }
      } catch { /* yok */ }

      // Cookie banner kapat
      try {
        const acceptAll = this.page.locator('button:has-text("Tümüne İzin Ver"), button:has-text("Accept All")').first();
        if (await acceptAll.count() > 0) {
          await acceptAll.click({ timeout: 3_000 });
          await this.page.waitForTimeout(800);
        }
      } catch { /* yok */ }

      if (!email || !password) return;

      this.log.info('Credentials otomatik dolduruluyor...');
      try {
        // Angular SPA için ekstra bekleme — domcontentloaded yetmeyebilir
        await this.page.waitForTimeout(2_000);

        const currentUrl = this.page.url();
        this.log.info({ url: currentUrl }, 'Login sayfası yüklendi');

        // Sayfadaki tüm input'ları logla (debug)
        const inputIds = await this.page.evaluate(() =>
          Array.from(document.querySelectorAll('input')).map(i => i.id + '/' + i.type + '/' + (i.offsetParent !== null ? 'visible' : 'hidden'))
        );
        this.log.debug({ inputs: inputIds }, 'Sayfadaki input alanları');

        const emailInput = this.page.locator('input#email').first();
        await emailInput.waitFor({ state: 'visible', timeout: 15_000 });
        await emailInput.click();
        await this.page.keyboard.press('Control+a');
        await this.page.keyboard.press('Delete');
        await this.page.keyboard.type(email, { delay: 50 });
        this.log.info('Email girildi');
        await this.page.waitForTimeout(600);

        const pwInput = this.page.locator('input#password').first();
        await pwInput.waitFor({ state: 'visible', timeout: 5_000 });
        await pwInput.click();
        await this.page.keyboard.press('Control+a');
        await this.page.keyboard.press('Delete');
        await this.page.keyboard.type(password, { delay: 50 });
        this.log.info('Şifre girildi');
        await this.page.waitForTimeout(600);

        // Turnstile çözülmesini bekle — max 45s
        this.log.info('Turnstile bekleniyor...');
        for (let i = 0; i < 45; i++) {
          const disabled = await this.page.evaluate(() => {
            const btn = document.querySelector('button.btn-brand-orange') as HTMLButtonElement | null;
            return btn ? btn.disabled : true;
          });
          if (!disabled) { this.log.info('Turnstile çözüldü'); break; }
          await this.page.waitForTimeout(1_000);
        }

        // Force-click: disabled olsa bile dene
        await this.page.evaluate(() => {
          const btn = document.querySelector('button.btn-brand-orange') as HTMLButtonElement | null;
          if (btn) btn.click();
        });
        this.log.info('Form gönderildi');
        formSubmitted = true;
      } catch (e) {
        this.log.warn({ error: String(e) }, 'Credential auto-fill başarısız');
      }
    });

    if (!formSubmitted) {
      this.log.warn('Otomatik form doldurma başarısız — JWT ve OTP bekleniyor');
    }

    // Faz 2: Yönlendirmeyi bekle — JWT sessionStorage'a düşene kadar (mutex dışı)
    // Önce 30s hızlı bekle (başarılı login sonrası anında gelir)
    const fastDeadline = Date.now() + 30_000;
    while (Date.now() < fastDeadline) {
      const jwt = await withBrowserLock(() => this.extractJwtFromBrowser()).catch(() => null);
      if (jwt) return this.cacheAndReturn(jwt, tgToken, tgChat);
      await new Promise(r => setTimeout(r, 2_000));
    }

    // Faz 3: OTP alanı bekleniyor — mutex dışında bekle, gelince lock al
    this.log.info('OTP alanı bekleniyor...');
    const otpSelector = 'input[formcontrolname="otpEmail"], input[maxlength="6"], input[maxlength="1"], input[placeholder*="OTP" i], input[placeholder*="kod" i]';
    let otpFieldFound = false;

    // 60 saniye OTP alanı için bekle
    for (let i = 0; i < 30; i++) {
      otpFieldFound = await withBrowserLock(async () => {
        const count = await this.page.locator(otpSelector).count().catch(() => 0);
        return count > 0;
      });
      if (otpFieldFound) break;
      await new Promise(r => setTimeout(r, 2_000));
    }

    if (otpFieldFound) {
      this.log.info('OTP ekranı geldi — email ve Telegram paralel bekleniyor');
      if (tgToken && tgChat) {
        await sendTelegramMessage(tgToken, tgChat,
          `🔐 VFS OTP bekleniyor\nEmail otomatik kontrol ediliyor...\n\nOtomatik alınamazsa: /otp 123456`
        );
      }

      // Email OTP ve Telegram OTP paralel çalışır — hangisi önce gelirse o kullanılır
      // null dönen promise reject sayılır, böylece diğerine geçilir
      const wrapOtp = (p: Promise<string | null>): Promise<string> =>
        p.then(v => { if (!v) throw new Error('otp null'); return v; });

      try {
        const otp = await Promise.any([
          wrapOtp(waitForEmailOtp(5 * 60_000)),
          wrapOtp(waitForOtp(tgToken, tgChat, 10 * 60_000)),
        ]);

        this.log.info({ otp }, 'OTP alındı');

        // OTP'yi doldur — mutex içinde
        await withBrowserLock(async () => {
          const otpInput = this.page.locator(otpSelector).first();
          await otpInput.fill(otp);
          await this.page.waitForTimeout(500);
          await this.page.evaluate(() => {
            const btn = document.querySelector('button[type="submit"]') as HTMLButtonElement | null;
            if (btn) btn.click();
          });
        });
      } catch (e) {
        this.log.warn({ error: String(e) }, 'OTP akışı başarısız');
      }
    }

    // Faz 4: JWT için son kez bekle (manuel login dahil) — 15 dakika
    this.log.info('JWT bekleniyor (manuel giriş de kabul edilir)...');
    const deadline = Date.now() + 15 * 60_000;
    while (Date.now() < deadline) {
      const jwt = await withBrowserLock(() => this.extractJwtFromBrowser()).catch(() => null);
      if (jwt) return this.cacheAndReturn(jwt, tgToken, tgChat);
      await new Promise(r => setTimeout(r, 3_000));
    }

    throw new Error('Giriş tamamlanamadı — JWT alınamadı.');
  }

  private async cacheAndReturn(jwt: string, tgToken: string, tgChat: string): Promise<string> {
    fs.mkdirSync(path.dirname(JWT_CACHE_FILE), { recursive: true });
    fs.writeFileSync(JWT_CACHE_FILE, jwt, 'utf-8');
    this.log.info('JWT cache dosyasına kaydedildi');
    if (tgToken && tgChat) {
      await sendTelegramMessage(tgToken, tgChat, '✅ VFS giriş başarılı — slot izleme devam ediyor');
    }
    return jwt;
  }

  private async extractJwtFromBrowser(): Promise<string | null> {
    return await this.page.evaluate(() => {
      const ss = sessionStorage.getItem('JWT');
      if (ss) return ss;
      const ls = localStorage.getItem('JWT');
      if (ls) return ls;
      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i) ?? '';
        const val = sessionStorage.getItem(key) ?? '';
        if (val.startsWith('EAAAA')) return val;
      }
      return null;
    });
  }

  // ── Cloudflare bekle ─────────────────────────────────────────────────────

  private async waitForCloudflare(): Promise<void> {
    for (let i = 0; i < 20; i++) {
      const title = await this.page.title().catch(() => '');
      if (!title.includes('Just a moment')) return;
      await this.page.waitForTimeout(1_000);
    }
  }

  // ── Slot sorgulama — Angular UI üzerinden ────────────────────────────────

  private async fetchSlotsWithJwt(_jwt: string): Promise<Slot[] | null> {
    this.log.info('Angular UI üzerinden slot kontrolü başlıyor...');

    await this.ensureSession(true);

    const currentUrl = this.page.url();
    if (!currentUrl.includes('/application-detail') && !currentUrl.includes('/dashboard')) {
      if (!currentUrl.includes('vfsglobal.com')) {
        await this.page.goto(this.urls.dashboard, { waitUntil: 'domcontentloaded', timeout: 30_000 });
        await this.waitForCloudflare();
      }
    }

    const liveJwt = await this.page.evaluate(() => sessionStorage.getItem('JWT')).catch(() => null);
    if (!liveJwt) {
      this.log.warn('SessionStorage\'da JWT yok — oturum sona ermiş');
      return null;
    }

    // Doğru ülkenin dashboard'unda mıyız?
    if (!this.page.url().includes(`/${this.missionCountry}/`)) {
      await this.page.goto(this.urls.dashboard, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await this.waitForCloudflare();
      await this.page.waitForTimeout(2_000);
    }

    if (!this.page.url().includes('/application-detail')) {
      const clicked = await this.page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button, span, div'));
        const btn = btns.find(el => el.textContent?.trim() === 'Yeni Rezervasyon Başlat');
        if (btn) { (btn as HTMLElement).click(); return true; }
        return false;
      });
      if (!clicked) {
        this.log.warn('Yeni Rezervasyon butonu bulunamadı');
        return [];
      }
      await this.page.waitForTimeout(3_000);
    }

    const dropCount = await this.page.locator('mat-select').count();
    if (dropCount < 2) {
      this.log.warn({ dropCount }, 'Booking formu yüklenmedi');
      return [];
    }

    const slots: Slot[] = [];
    const preferredCity = this.config.preferredCities[0];

    for (const centre of this.centres) {
      if (preferredCity && !centre.city.toLowerCase().includes(preferredCity.toLowerCase())) continue;

      const result = await this.checkSlotViaUI(centre.city, centre.label);
      if (result === null) return null;

      this.log.debug({ city: centre.city, result }, 'Slot kontrolü');

      if (result.earliestDate) {
        const date = result.earliestDate.slice(0, 10);
        const time = result.earliestDate.slice(11, 16) || '09:00';

        if (this.isInRange(date)) {
          slots.push(this.buildSlot(date, time, centre.city, 1));
          this.log.info({ city: centre.city, date, time }, 'SLOT BULUNDU');
        } else {
          this.log.debug({ city: centre.city, date }, 'Tarih aralığı dışında');
        }
      }
    }

    this.log.info({ count: slots.length }, 'Toplam slot');
    return slots;
  }

  // Angular dropdown → CheckIsSlotAvailable intercept
  private async checkSlotViaUI(city: string, cityLabel: string): Promise<VfsSlotResult | null> {
    this.log.debug({ city }, 'Angular UI slot kontrolü');

    let resolveSlot!: (v: VfsSlotResult | null) => void;
    const slotPromise = new Promise<VfsSlotResult | null>((res) => { resolveSlot = res; });

    const onResponse = async (resp: import('playwright').Response) => {
      if (resp.url().includes('/appointment/CheckIsSlotAvailable')) {
        const status = resp.status();
        if (status === 401) { resolveSlot(null); return; }
        if (status === 429) {
          this.log.warn({ city }, 'CheckIsSlotAvailable rate limited (429)');
          resolveSlot({ error: { code: 429, description: 'Rate limited', type: 'Error' } });
          return;
        }
        try {
          resolveSlot(JSON.parse(await resp.text()) as VfsSlotResult);
        } catch {
          resolveSlot({});
        }
      }
    };

    this.page.on('response', onResponse);

    try {
      const drops = this.page.locator('mat-select');

      // [1] Merkez
      await drops.first().click({ timeout: 8_000 });
      await this.page.waitForTimeout(1_500);
      const centerOpt = this.page.locator('mat-option').filter({ hasText: cityLabel }).first();
      if (await centerOpt.count() > 0) {
        await centerOpt.click({ timeout: 5_000 });
      } else {
        await this.page.locator('mat-option').first().click({ timeout: 5_000 });
      }
      await this.page.waitForTimeout(2_000);

      // [2] Visa category
      if (await drops.count() >= 2) {
        await drops.nth(1).click({ timeout: 8_000 });
        await this.page.waitForTimeout(1_500);
        const catOpt = this.page.locator('mat-option').filter({ hasText: /Turizm|N\/A/i }).first();
        if (await catOpt.count() > 0) {
          await catOpt.click({ timeout: 5_000 });
        } else {
          await this.page.locator('mat-option').first().click({ timeout: 5_000 });
        }
        await this.page.waitForTimeout(2_000);
      }

      // [3] Sub-category → CheckIsSlotAvailable tetikler
      if (await drops.count() >= 3) {
        await drops.nth(2).click({ timeout: 8_000 });
        await this.page.waitForTimeout(1_500);
        const subOpt = this.page.locator('mat-option').filter({ hasText: /Turistik|Tourist/i }).first();
        if (await subOpt.count() > 0) {
          await subOpt.click({ timeout: 5_000 });
        } else {
          await this.page.locator('mat-option').first().click({ timeout: 5_000 });
        }
        await this.page.waitForTimeout(1_000);
      }

      return await Promise.race([
        slotPromise,
        new Promise<VfsSlotResult>((res) => setTimeout(() => res({}), 8_000)),
      ]);
    } catch (e) {
      this.log.warn({ city, error: String(e) }, 'UI slot kontrolü başarısız');
      return {};
    } finally {
      this.page.off('response', onResponse);
    }
  }

  // ── Yardımcı ──────────────────────────────────────────────────────────────

  private isInRange(date: string): boolean {
    const { earliest, latest } = this.config.dateRange;
    const today = new Date().toISOString().slice(0, 10);
    const lower = earliest > today ? earliest : today;
    return date >= lower && date <= latest;
  }

  private buildSlot(date: string, time: string, city: string, seats: number): Slot {
    return {
      id: buildSlotId(this.providerId, this.countryCode, city, date, time, this.config.visaCategory),
      providerId: this.providerId,
      country: this.countryName,
      city,
      consulate: `VFS Global ${city}`,
      date,
      time,
      visaCategory: this.config.visaCategory,
      availableSeats: seats,
      bookingUrl: this.urls.bookAppt,
      rawData: { source: `vfs-global-${this.missionCountry}`, date, time, centre: city },
      detectedAt: new Date().toISOString(),
    };
  }
}

// ── Turkey → Switzerland ──────────────────────────────────────────────────────

export class VfsGlobalProvider extends VfsGlobalBaseProvider {
  readonly providerId = 'vfs-global-tur-che';
  protected readonly missionCountry = 'che';
  protected readonly countryName    = 'Switzerland';
  protected readonly countryCode    = 'CH';
  // Keşfedilen merkezler — GET /master/center/che/tur/tr-TR (2026-04-15)
  protected readonly centres = [
    { code: 'ESB', city: 'Ankara',   label: 'Ankara' },
    { code: 'IST', city: 'Istanbul', label: 'Istanbul' },
  ];
}

// ── Turkey → Austria ──────────────────────────────────────────────────────────

export class VfsGlobalAutProvider extends VfsGlobalBaseProvider {
  readonly providerId = 'vfs-global-tur-aut';
  protected readonly missionCountry = 'aut';
  protected readonly countryName    = 'Austria';
  protected readonly countryCode    = 'AT';
  protected readonly centres = [
    { code: 'AUT-ANKARA', city: 'Ankara',    label: 'Ankara' },
    { code: 'AUIA',       city: 'Istanbul',  label: 'Istanbul' },
    { code: 'IBY',        city: 'Beyoglu',   label: 'Beyoglu' },
    { code: 'ALT-EDR',   city: 'Edirne',    label: 'Edirne' },
    { code: 'BSA',        city: 'Bursa',     label: 'Bursa' },
    { code: 'ALT-IZM',   city: 'Izmir',     label: 'Izmir' },
    { code: 'ANTA',       city: 'Antalya',   label: 'Antalya' },
    { code: 'AUT-GAZI',  city: 'Gaziantep', label: 'Gaziantep' },
    { code: 'AUT-TRAB',  city: 'Trabzon',   label: 'Trabzon' },
  ];
}

// ── Turkey → Belgium ──────────────────────────────────────────────────────────

export class VfsGlobalBelProvider extends VfsGlobalBaseProvider {
  readonly providerId = 'vfs-global-tur-bel';
  protected readonly missionCountry = 'bel';
  protected readonly countryName    = 'Belgium';
  protected readonly countryCode    = 'BE';
  protected readonly centres = [
    { code: 'HAREMB', city: 'Istanbul',   label: 'Istanbul' },
    { code: 'DIY',    city: 'Diyarbakir', label: 'Diyarbakir' },
    { code: 'SAW',    city: 'Altunizade', label: 'Altunizade' },
    { code: 'ANK',    city: 'Ankara',     label: 'Ankara' },
    { code: 'ANT',    city: 'Antalya',    label: 'Antalya' },
    { code: 'IST',    city: 'Harbiye',    label: 'Harbiye' },
    { code: 'ABD',    city: 'Izmir',      label: 'Izmir' },
    { code: 'GAZ',    city: 'Gaziantep',  label: 'Gaziantep' },
  ];
}

// ── Turkey → Croatia ──────────────────────────────────────────────────────────

export class VfsGlobalHrvProvider extends VfsGlobalBaseProvider {
  readonly providerId = 'vfs-global-tur-hrv';
  protected readonly missionCountry = 'hrv';
  protected readonly countryName    = 'Croatia';
  protected readonly countryCode    = 'HR';
  protected readonly centres = [
    { code: 'BTNR',    city: 'Bursa',           label: 'Bursa' },
    { code: 'ESB',     city: 'Ankara',           label: 'Ankara' },
    { code: 'HRV-GAZ', city: 'Gaziantep',        label: 'Gaziantep' },
    { code: 'IBNR',    city: 'Istanbul-Beyoglu', label: 'Istanbul-Beyoglu' },
    { code: 'IANR',    city: 'Istanbul',         label: 'Istanbul' },
    { code: 'IIANR',   city: 'Izmir',            label: 'Izmir' },
    { code: 'AANR',    city: 'Antalya',          label: 'Antalya' },
  ];
}

// ── Turkey → Czech Republic ───────────────────────────────────────────────────

export class VfsGlobalCzeProvider extends VfsGlobalBaseProvider {
  readonly providerId = 'vfs-global-tur-cze';
  protected readonly missionCountry = 'cze';
  protected readonly countryName    = 'Czech Republic';
  protected readonly countryCode    = 'CZ';
  protected readonly centres = [
    { code: 'ANKARA',  city: 'Ankara',             label: 'Ankara' },
    { code: 'Beyoglu', city: 'Istanbul Harbiye',    label: 'Istanbul Harbiye' },
    { code: 'CR-ALT',  city: 'Istanbul Altunizade', label: 'Istanbul Altunizade' },
    { code: 'CR-IZM',  city: 'Izmir',              label: 'Izmir' },
    { code: 'CR-ANT',  city: 'Antalya',            label: 'Antalya' },
  ];
}

// ── Turkey → Denmark ──────────────────────────────────────────────────────────

export class VfsGlobalDnkProvider extends VfsGlobalBaseProvider {
  readonly providerId = 'vfs-global-tur-dnk';
  protected readonly missionCountry = 'dnk';
  protected readonly countryName    = 'Denmark';
  protected readonly countryCode    = 'DK';
  protected readonly centres = [
    { code: 'DEANK', city: 'Ankara',    label: 'Ankara' },
    { code: 'DEIT',  city: 'Beyoglu',   label: 'Beyoglu' },
    { code: 'DEIZ',  city: 'Izmir',     label: 'Izmir' },
    { code: 'DEANT', city: 'Antalya',   label: 'Antalya' },
    { code: 'GAZ',   city: 'Gaziantep', label: 'Gaziantep' },
  ];
}

// ── Turkey → Estonia ──────────────────────────────────────────────────────────

export class VfsGlobalEstProvider extends VfsGlobalBaseProvider {
  readonly providerId = 'vfs-global-tur-est';
  protected readonly missionCountry = 'est';
  protected readonly countryName    = 'Estonia';
  protected readonly countryCode    = 'EE';
  protected readonly centres = [
    { code: 'EEMB',  city: 'Ankara',            label: 'Ankara' },
    { code: 'EBGLU', city: 'Istanbul',           label: 'Istanbul' },
    { code: 'AYT',   city: 'Istanbul-Altunizade', label: 'Istanbul-Altunizade' },
    { code: 'ADB',   city: 'Izmir',              label: 'Izmir' },
    { code: 'ESTRAT',city: 'Antalya',            label: 'Antalya' },
    { code: 'GAZ',   city: 'Gaziantep',          label: 'Gaziantep' },
    { code: 'ETRA',  city: 'Trabzon',            label: 'Trabzon' },
    { code: 'BUR',   city: 'Bursa',              label: 'Bursa' },
    { code: 'EDR',   city: 'Edirne',             label: 'Edirne' },
    { code: 'BJV',   city: 'Bodrum',             label: 'Bodrum' },
    { code: 'EVACD', city: 'Diyarbakir',         label: 'Diyarbakir' },
  ];
}

// ── Turkey → Finland ──────────────────────────────────────────────────────────

export class VfsGlobalFinProvider extends VfsGlobalBaseProvider {
  readonly providerId = 'vfs-global-tur-fin';
  protected readonly missionCountry = 'fin';
  protected readonly countryName    = 'Finland';
  protected readonly countryCode    = 'FI';
  protected readonly centres = [
    { code: 'ANKA13',  city: 'Ankara',   label: 'Ankara' },
    { code: 'Beyoglu2',city: 'Istanbul', label: 'Istanbul' },
    { code: 'IZMR',    city: 'Izmir',    label: 'Izmir' },
    { code: 'Anta2',   city: 'Antalya',  label: 'Antalya' },
  ];
}

// ── Turkey → France ───────────────────────────────────────────────────────────

export class VfsGlobalFraProvider extends VfsGlobalBaseProvider {
  readonly providerId = 'vfs-global-tur-fra';
  protected readonly missionCountry = 'fra';
  protected readonly countryName    = 'France';
  protected readonly countryCode    = 'FR';
  protected readonly centres = [
    { code: 'ESB', city: 'Ankara',          label: 'Ankara' },
    { code: 'IBY', city: 'Istanbul Beyoglu', label: 'Istanbul Beyoglu' },
    { code: 'ADB', city: 'Izmir',           label: 'Izmir' },
    { code: 'GAZ', city: 'Gaziantep',       label: 'Gaziantep' },
  ];
}

// ── Turkey → Latvia ───────────────────────────────────────────────────────────

export class VfsGlobalLvaProvider extends VfsGlobalBaseProvider {
  readonly providerId = 'vfs-global-tur-lva';
  protected readonly missionCountry = 'lva';
  protected readonly countryName    = 'Latvia';
  protected readonly countryCode    = 'LV';
  protected readonly centres = [
    { code: 'ANK-',  city: 'Ankara',    label: 'Ankara' },
    { code: 'harb',  city: 'Istanbul',  label: 'Istanbul' },
    { code: 'ALT',   city: 'Altunizade',label: 'Altunizade' },
    { code: 'IZM',   city: 'Izmir',     label: 'Izmir' },
    { code: 'ANT',   city: 'Antalya',   label: 'Antalya' },
    { code: 'GAZI',  city: 'Gaziantep', label: 'Gaziantep' },
    { code: 'BURS',  city: 'Bursa',     label: 'Bursa' },
    { code: 'TRA',   city: 'Trabzon',   label: 'Trabzon' },
    { code: 'EDR',   city: 'Edirne',    label: 'Edirne' },
    { code: 'BODR',  city: 'Bodrum',    label: 'Bodrum' },
  ];
}

// ── Turkey → Lithuania ────────────────────────────────────────────────────────

export class VfsGlobalLtuProvider extends VfsGlobalBaseProvider {
  readonly providerId = 'vfs-global-tur-ltu';
  protected readonly missionCountry = 'ltu';
  protected readonly countryName    = 'Lithuania';
  protected readonly countryCode    = 'LT';
  protected readonly centres = [
    { code: 'ANK',      city: 'Ankara',    label: 'Ankara' },
    { code: 'LTU-BEY',  city: 'Istanbul',  label: 'Istanbul' },
    { code: 'LTU-ALTU', city: 'Altunizade',label: 'Altunizade' },
    { code: 'IZM',      city: 'Izmir',     label: 'Izmir' },
    { code: 'ANT',      city: 'Antalya',   label: 'Antalya' },
    { code: 'GAZ',      city: 'Gaziantep', label: 'Gaziantep' },
    { code: 'TRA',      city: 'Trabzon',   label: 'Trabzon' },
    { code: 'LTU-EDIN', city: 'Edirne',    label: 'Edirne' },
    { code: 'BUR',      city: 'Bursa',     label: 'Bursa' },
  ];
}

// ── Turkey → Luxembourg ───────────────────────────────────────────────────────

export class VfsGlobalLuxProvider extends VfsGlobalBaseProvider {
  readonly providerId = 'vfs-global-tur-lux';
  protected readonly missionCountry = 'lux';
  protected readonly countryName    = 'Luxembourg';
  protected readonly countryCode    = 'LU';
  protected readonly centres = [
    { code: 'ESB',     city: 'Ankara',    label: 'Ankara' },
    { code: 'IST',     city: 'Istanbul',  label: 'Istanbul' },
    { code: 'ADB',     city: 'Izmir',     label: 'Izmir' },
    { code: 'AYT',     city: 'Antalya',   label: 'Antalya' },
    { code: 'LUX-GAZ', city: 'Gaziantep', label: 'Gaziantep' },
  ];
}

// ── Turkey → Netherlands ──────────────────────────────────────────────────────

export class VfsGlobalNldProvider extends VfsGlobalBaseProvider {
  readonly providerId = 'vfs-global-tur-nld';
  protected readonly missionCountry = 'nld';
  protected readonly countryName    = 'Netherlands';
  protected readonly countryCode    = 'NL';
  protected readonly centres = [
    { code: 'NANKA', city: 'Ankara',     label: 'Ankara' },
    { code: 'NISTA', city: 'Istanbul',   label: 'Istanbul' },
    { code: 'NALT',  city: 'Altunizade', label: 'Altunizade' },
    { code: 'ADB',   city: 'Izmir',      label: 'Izmir' },
    { code: 'NANT',  city: 'Antalya',    label: 'Antalya' },
    { code: 'NGAZ',  city: 'Gaziantep',  label: 'Gaziantep' },
    { code: 'NBUR',  city: 'Bursa',      label: 'Bursa' },
    { code: 'NEDIE', city: 'Edirne',     label: 'Edirne' },
  ];
}

// ── Turkey → Norway ───────────────────────────────────────────────────────────

export class VfsGlobalNorProvider extends VfsGlobalBaseProvider {
  readonly providerId = 'vfs-global-tur-nor';
  protected readonly missionCountry = 'nor';
  protected readonly countryName    = 'Norway';
  protected readonly countryCode    = 'NO';
  protected readonly centres = [
    { code: 'NORANKA', city: 'Ankara',  label: 'Ankara' },
    { code: 'NIST',    city: 'Beyoglu', label: 'Beyoglu' },
    { code: 'NIZM',    city: 'Izmir',   label: 'Izmir' },
    { code: 'NANTA',   city: 'Antalya', label: 'Antalya' },
  ];
}

// ── Turkey → Slovakia ─────────────────────────────────────────────────────────

export class VfsGlobalSvkProvider extends VfsGlobalBaseProvider {
  readonly providerId = 'vfs-global-tur-svk';
  protected readonly missionCountry = 'svk';
  protected readonly countryName    = 'Slovakia';
  protected readonly countryCode    = 'SK';
  protected readonly centres = [
    { code: 'ESB', city: 'Ankara',   label: 'Ankara' },
    { code: 'IST', city: 'Istanbul', label: 'Istanbul' },
    { code: 'ADB', city: 'Izmir',    label: 'Izmir' },
    { code: 'AYT', city: 'Antalya',  label: 'Antalya' },
  ];
}

// ── Turkey → Slovenia ─────────────────────────────────────────────────────────

export class VfsGlobalSvnProvider extends VfsGlobalBaseProvider {
  readonly providerId = 'vfs-global-tur-svn';
  protected readonly missionCountry = 'svn';
  protected readonly countryName    = 'Slovenia';
  protected readonly countryCode    = 'SI';
  protected readonly centres = [
    { code: 'ANK',      city: 'Ankara',    label: 'Ankara' },
    { code: 'SVN-IST',  city: 'Istanbul',  label: 'Istanbul' },
    { code: 'SLVALTU',  city: 'Altunizade',label: 'Altunizade' },
    { code: 'Slovizm',  city: 'Izmir',     label: 'Izmir' },
    { code: 'Slovant',  city: 'Antalya',   label: 'Antalya' },
    { code: 'Slovgazi', city: 'Gaziantep', label: 'Gaziantep' },
    { code: 'SLTRBR',   city: 'Bursa',     label: 'Bursa' },
    { code: 'TRA',      city: 'Trabzon',   label: 'Trabzon' },
  ];
}

// ── Turkey → Sweden ───────────────────────────────────────────────────────────

export class VfsGlobalSweProvider extends VfsGlobalBaseProvider {
  readonly providerId = 'vfs-global-tur-swe';
  protected readonly missionCountry = 'swe';
  protected readonly countryName    = 'Sweden';
  protected readonly countryCode    = 'SE';
  protected readonly centres = [
    { code: 'SWANK', city: 'Ankara',  label: 'Ankara' },
    { code: 'SWBYO', city: 'Beyoglu', label: 'Beyoglu' },
    { code: 'SWIZM', city: 'Izmir',   label: 'Izmir' },
    { code: 'SWANT', city: 'Antalya', label: 'Antalya' },
  ];
}

// ── Turkey → Poland ───────────────────────────────────────────────────────────

export class VfsGlobalPolProvider extends VfsGlobalBaseProvider {
  readonly providerId = 'vfs-global-tur-pol';
  protected readonly missionCountry = 'pol';
  protected readonly countryName    = 'Poland';
  protected readonly countryCode    = 'PL';
  // Keşfedilen merkezler — GET /master/center/pol/tur/tr-TR (2026-04-15)
  protected readonly centres = [
    { code: 'PHARB',  city: 'Istanbul',           label: 'Istanbul' },
    { code: 'ALTU',   city: 'Istanbul-Altunizade', label: 'Istanbul-Altunizade' },
    { code: 'ANKA',   city: 'Ankara',             label: 'Ankara' },
    { code: 'IZMI',   city: 'Izmir',              label: 'Izmir' },
    { code: 'ANTA',   city: 'Antalya',            label: 'Antalya' },
    { code: 'PGAZI',  city: 'Gaziantep',          label: 'Gaziantep' },
    { code: 'TRAB',   city: 'Trabzon',            label: 'Trabzon' },
  ];
}

// ── Turkey → Malta ────────────────────────────────────────────────────────────

export class VfsGlobalMltProvider extends VfsGlobalBaseProvider {
  readonly providerId = 'vfs-global-tur-mlt';
  protected readonly missionCountry = 'mlt';
  protected readonly countryName    = 'Malta';
  protected readonly countryCode    = 'MT';
  // Keşfedilen merkezler — GET /master/center/mlt/tur/tr-TR (2026-04-15)
  protected readonly centres = [
    { code: 'IST',     city: 'Istanbul',           label: 'Istanbul' },
    { code: 'ESB',     city: 'Ankara',             label: 'Ankara' },
    { code: 'MLT-GAZ', city: 'Gaziantep',          label: 'Gaziantep' },
    { code: 'EDR',     city: 'Edirne',             label: 'Edirne' },
    { code: 'BUR',     city: 'Bursa',              label: 'Bursa' },
    { code: 'ADB',     city: 'Izmir',              label: 'Izmir' },
    { code: 'TZX',     city: 'Trabzon',            label: 'Trabzon' },
    { code: 'MAAN',    city: 'Antalya',            label: 'Antalya' },
    { code: 'ML',      city: 'Istanbul-Altunizade', label: 'Istanbul-Altunizade' },
  ];
}
