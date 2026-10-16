import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { chromium, type Browser } from "playwright";
import { startTestApp } from "../app/server.js";
import { executeAction, type ExecCtx } from "../../src/runner/execute.js";

let browser: Browser;
let app: { url: string; close(): Promise<void> };
beforeAll(async () => {
  browser = await chromium.launch();
  app = await startTestApp();
});
afterAll(async () => {
  await browser.close();
  await app.close();
});

const ctx = (baseUrl: string): ExecCtx => ({
  timeoutMs: 2000,
  allowedHosts: ["127.0.0.1"],
  baseUrl,
  env: {},
  secrets: new Set(),
  blocked: [],
});

describe("goto relativo à URL base", () => {
  it.each([
    ["/", "/QA-Playwright/"],
    ["/inventory.html", "/QA-Playwright/inventory.html"],
    ["inventory.html", "/QA-Playwright/inventory.html"],
  ])("goto %s com base numa subpasta vai para %s", async (target, expected) => {
    const page = await browser.newPage();
    await executeAction(page, { kind: "goto", url: target, description: "ir" }, ctx(`${app.url}/QA-Playwright`));
    expect(page.url()).toBe(app.url + expected);
    await page.close();
  });

  it("URL absoluta é respeitada", async () => {
    const page = await browser.newPage();
    await executeAction(page, { kind: "goto", url: `${app.url}/style.css`, description: "ir" }, ctx(`${app.url}/QA-Playwright/`));
    expect(page.url()).toBe(`${app.url}/style.css`);
    await page.close();
  });

  it("base na raiz continua igual", async () => {
    const page = await browser.newPage();
    await executeAction(page, { kind: "goto", url: "/", description: "ir" }, ctx(app.url));
    expect(page.url()).toBe(`${app.url}/`);
    await page.close();
  });
});
