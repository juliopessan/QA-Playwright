import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, readFileSync, statSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser } from "playwright";
import { saveStorageState, loadStorageStatePath, isSessionExpired } from "../../src/auth/index.js";

let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch();
});
afterAll(async () => {
  await browser.close();
});

describe("auth", () => {
  it("saveStorageState grava state.json com modo 0600", async () => {
    const root = mkdtempSync(join(tmpdir(), "qa-auth-"));
    const dir = join(root, ".qa-auth");
    const ctx = await browser.newContext();
    const file = await saveStorageState(ctx, dir);
    expect(file).toBe(join(dir, "state.json"));
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(file, "utf8"))).toHaveProperty("cookies");
    await ctx.close();
  });

  it("adiciona .qa-auth/ ao .gitignore sem duplicar em chamadas repetidas", async () => {
    const root = mkdtempSync(join(tmpdir(), "qa-auth-"));
    const dir = join(root, ".qa-auth");
    const ctx = await browser.newContext();
    await saveStorageState(ctx, dir);
    await saveStorageState(ctx, dir);
    const gi = readFileSync(join(root, ".gitignore"), "utf8");
    expect(gi.split("\n").filter((l) => l.trim() === ".qa-auth/")).toHaveLength(1);
    await ctx.close();
  });

  it("loginUrlPattern: loadStorageStatePath devolve undefined sem arquivo e o caminho com arquivo", async () => {
    const root = mkdtempSync(join(tmpdir(), "qa-auth-"));
    const dir = join(root, ".qa-auth");
    expect(loadStorageStatePath(dir)).toBeUndefined();
    const ctx = await browser.newContext();
    await saveStorageState(ctx, dir);
    expect(existsSync(loadStorageStatePath(dir)!)).toBe(true);
    await ctx.close();
  });

  it("isSessionExpired verdadeiro quando a URL casa com o padrão de login", async () => {
    const page = await browser.newPage();
    await page.route("**/*", (r) => r.fulfill({ body: "<html></html>", contentType: "text/html" }));
    await page.goto("https://login.microsoftonline.com/abc");
    expect(isSessionExpired(page, /login\.microsoftonline\.com/)).toBe(true);
    await page.goto("https://app.interna.local/home");
    expect(isSessionExpired(page, /login\.microsoftonline\.com/)).toBe(false);
    await page.close();
  });
});
