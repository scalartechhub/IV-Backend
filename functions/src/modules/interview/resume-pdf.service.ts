import { existsSync } from "fs";
import puppeteer, { Browser, Page } from "puppeteer-core";
import chromium from "@sparticuz/chromium";
import { logger } from "../../shared/logger";
import { isCloudRuntime } from "../../shared/runtime";
import { AppError } from "../../shared/utils";

let browserPromise: Promise<Browser> | null = null;

const getLocalChromeExecutablePath = (): string | null => {
  const candidates = [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
};

const serializeError = (error: unknown): Record<string, unknown> => {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }

  return { error };
};

const launchBrowser = async (): Promise<Browser> => {
  const localExecutablePath = !isCloudRuntime() ? getLocalChromeExecutablePath() : null;
  const headless = "shell" as const;
  const executablePath = localExecutablePath ?? (await chromium.executablePath());
  const launchArgs = localExecutablePath
    ? await puppeteer.defaultArgs({ headless })
    : await puppeteer.defaultArgs({ args: chromium.args, headless });

  return puppeteer.launch({
    args: launchArgs,
    executablePath,
    headless,
  });
};

const getBrowser = (): Promise<Browser> => {
  if (!browserPromise) {
    browserPromise = launchBrowser().catch((err) => {
      browserPromise = null;
      throw err;
    });
  }
  return browserPromise;
};

export const generateResumePdf = async (html: string): Promise<Buffer> => {
  let page: Page | undefined;

  try {
    const browser = await getBrowser();
    page = await browser.newPage();
    await page.setContent(html, { waitUntil: "load" });
    const pdfBytes = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "0", bottom: "0", left: "0", right: "0" },
    });
    return Buffer.from(pdfBytes);
  } catch (err) {
    logger.error("resume-pdf generation failed", serializeError(err));
    throw new AppError(500, "Failed to generate PDF.");
  } finally {
    if (page) {
      await page.close().catch(() => undefined);
    }
  }
};
