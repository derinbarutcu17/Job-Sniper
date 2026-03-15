import fs from "node:fs";
import type { Dependencies, HttpResponseLike } from "../types.js";
import { withTimeout } from "./async.js";

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36";

function adaptResponse(response: Response): HttpResponseLike {
  return {
    ok: response.ok,
    status: response.status,
    text: () => response.text(),
    json: () => response.json(),
  };
}

function challengeDetected(status: number, body: string, url: string): boolean {
  const lower = body.toLowerCase();
  return (
    status === 403 ||
    (/wellfound\.com/i.test(url) &&
      (lower.includes("please enable js") ||
        lower.includes("disable any ad blocker") ||
        lower.includes("cf-chl") ||
        lower.includes("challenge-platform") ||
        lower.includes("datadome") ||
        lower.includes("captcha-delivery.com") ||
        lower.includes("geo.captcha-delivery.com") ||
        lower.includes("dd={'rt':'c'") ||
        lower.includes('dd={"rt":"c"') ||
        lower.includes("datadome captcha")))
  );
}

async function browserFetch(input: string): Promise<HttpResponseLike | null> {
  const chromeCandidates = [
    process.env.CHROME_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  ].filter((v): v is string => Boolean(v));
  const executablePath = chromeCandidates.find((p) => fs.existsSync(p));
  if (!executablePath) return null;

  try {
    return await withTimeout(
      (async () => {
        const { chromium } = await import("playwright-core");
        const browser = await chromium.launch({ headless: true, executablePath });
        try {
          const page = await browser.newPage({ userAgent: USER_AGENT });
          page.setDefaultNavigationTimeout(20000);
          page.setDefaultTimeout(20000);
          await page.goto(input, { waitUntil: "domcontentloaded", timeout: 20000 });
          await page.waitForTimeout(1200);
          const html = await page.content();
          return {
            ok: true,
            status: 200,
            text: async () => html,
            json: async () => JSON.parse(html),
          };
        } finally {
          await browser.close();
        }
      })(),
      25000,
      `browserFetch(${input})`,
    );
  } catch {
    return null;
  }
}

export function createDefaultDependencies(): Dependencies {
  return {
    fetch: async (input, init) => {
      const response = await withTimeout(
        fetch(input, {
          ...init,
          headers: {
            "user-agent": USER_AGENT,
            accept: "text/html,application/json,application/xml;q=0.9,*/*;q=0.8",
            "accept-language": "en-US,en;q=0.9,tr-TR;q=0.8,tr;q=0.7",
            ...(init?.headers ?? {}),
          },
        }),
        15000,
        `fetch(${input})`,
      );
      const body = await response.text();
      if (challengeDetected(response.status, body, input)) {
        const fallback = await browserFetch(input);
        if (fallback) return fallback;
      }
      return {
        ok: response.ok,
        status: response.status,
        text: async () => body,
        json: async () => JSON.parse(body),
      };
    },
    now: () => new Date(),
  };
}
