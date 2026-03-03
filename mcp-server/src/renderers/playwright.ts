import { chromium, type Browser, type Page } from "playwright";
import path from "node:path";
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

export interface ViewportScreenshot {
  viewport: { width: number; height: number; label?: string };
  outputPath: string;
  dimensions: { width: number; height: number };
}

export async function screenshotMultipleViewports(
  url: string,
  outputDir: string,
  viewports: Array<{ width: number; height: number; label?: string }>,
  options?: { selector?: string },
): Promise<ViewportScreenshot[]> {
  const b = await getBrowser();

  const results = await Promise.all(
    viewports.map(async (vp) => {
      const context = await b.newContext({
        viewport: { width: vp.width, height: vp.height },
      });
      const page = await context.newPage();
      const label = vp.label ?? `${vp.width}x${vp.height}`;
      const outputPath = path.join(outputDir, `viewport-${label}-${Date.now()}.png`);

      try {
        await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });
        await page.waitForTimeout(500);

        if (options?.selector) {
          const element = await page.waitForSelector(options.selector, {
            timeout: 10_000,
          });
          if (!element) {
            throw new Error(`Selector "${options.selector}" not found`);
          }
          await element.screenshot({ path: outputPath });
          const box = await element.boundingBox();
          return {
            viewport: vp,
            outputPath,
            dimensions: {
              width: Math.round(box?.width ?? 0),
              height: Math.round(box?.height ?? 0),
            },
          };
        }

        await page.screenshot({ path: outputPath, fullPage: false });
        return {
          viewport: vp,
          outputPath,
          dimensions: { width: vp.width, height: vp.height },
        };
      } finally {
        await page.close();
        await context.close();
      }
    }),
  );

  return results;
}

export async function closeBrowser(): Promise<void> {
  if (browser) {
    await browser.close();
    browser = null;
  }
}
