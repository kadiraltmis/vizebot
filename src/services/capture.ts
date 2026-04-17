import fs from 'fs';
import path from 'path';
import type { Page } from 'playwright';

const SCREENSHOT_DIR = path.resolve(process.cwd(), 'artifacts', 'screenshots');

export async function captureScreenshot(
  page: Page,
  providerId: string,
  label: string
): Promise<string> {
  if (!fs.existsSync(SCREENSHOT_DIR)) {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  }

  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `${ts}_${providerId}_${label}.png`;
  const filePath = path.join(SCREENSHOT_DIR, filename);

  await page.screenshot({ path: filePath, fullPage: false });
  return filePath;
}
