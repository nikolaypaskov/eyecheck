import { chromium, type Browser, type Page } from "playwright";
import type { Viewport } from "../config.js";

let browser: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (browser && browser.isConnected()) {
    return browser;
  }
  browser = await chromium.launch({ headless: true });
  return browser;
}

export async function screenshotUrl(
  url: string,
  outputPath: string,
  options?: {
    viewport?: Viewport;
    selector?: string;
  },
): Promise<{ width: number; height: number }> {
  const b = await getBrowser();
  const page = await b.newPage({
    viewport: options?.viewport ?? { width: 1280, height: 720 },
  });

  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });
    // Wait for animations to settle
    await page.waitForTimeout(500);

    if (options?.selector) {
      const element = await page.waitForSelector(options.selector, {
        timeout: 10_000,
      });
      if (!element) {
        throw new Error(`Selector "${options.selector}" not found on page`);
      }
      await element.screenshot({ path: outputPath });
      const box = await element.boundingBox();
      return {
        width: Math.round(box?.width ?? 0),
        height: Math.round(box?.height ?? 0),
      };
    }

    await page.screenshot({ path: outputPath, fullPage: false });
    const viewport = page.viewportSize();
    return {
      width: viewport?.width ?? 1280,
      height: viewport?.height ?? 720,
    };
  } finally {
    await page.close();
  }
}

export async function closeBrowser(): Promise<void> {
  if (browser) {
    await browser.close();
    browser = null;
  }
}
