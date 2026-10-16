import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, readFileSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { startTestApp } from "./server.js";
import { buildWeb, generateCredentials, writeEnvWeb } from "../../scripts/build-web.js";

let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch();
});
afterAll(async () => {
  await browser.close();
});

const creds = { user: "qa_abc123", pass: "S3nha-de-teste-XYZ", lockedUser: "qa_bloqueado_abc123" };

async function login(page: Page, url: string, user: string, pass: string) {
  await page.goto(url);
  await page.getByRole("textbox", { name: "Username" }).fill(user);
  await page.getByRole("textbox", { name: "Password" }).fill(pass);
  await page.getByRole("button", { name: "Login" }).click();
}

describe("generateCredentials", () => {
  it("gera usuário qa_<hex>, senha longa e usuário bloqueado; duas chamadas diferem", () => {
    const a = generateCredentials();
    const b = generateCredentials();
    expect(a.user).toMatch(/^qa_[0-9a-f]{6}$/);
    expect(a.lockedUser).toMatch(/^qa_bloqueado_[0-9a-f]{6}$/);
    expect(a.pass.length).toBeGreaterThanOrEqual(16);
    expect(a.pass).not.toEqual(b.pass);
  });
});

describe("buildWeb", () => {
  it("gera o site com config.js contendo só as credenciais novas", () => {
    const out = mkdtempSync(join(tmpdir(), "qa-web-"));
    buildWeb({ outDir: out, creds });
    for (const f of ["index.html", "inventory.html", "app.js", "config.js", "style.css"]) {
      expect(existsSync(join(out, f)), f).toBe(true);
    }
    const cfg = readFileSync(join(out, "config.js"), "utf8");
    expect(cfg).toContain("qa_abc123");
    expect(cfg).toContain("qa_bloqueado_abc123");
    expect(cfg).not.toContain("standard_user");
    expect(cfg).not.toContain("secret_sauce");
  });

  it("usa a marca QA Agent, avisa que é site de teste e não usa caminhos absolutos", () => {
    const out = mkdtempSync(join(tmpdir(), "qa-web-"));
    buildWeb({ outDir: out, creds });
    const index = readFileSync(join(out, "index.html"), "utf8");
    expect(index).toContain("<h1>QA Agent</h1>");
    expect(index).toMatch(/site de teste do QA Agent/i);
    expect(index).not.toContain("Swag Labs");
    for (const f of ["index.html", "inventory.html", "cart.html", "checkout-step-one.html", "checkout-step-two.html", "checkout-complete.html", "app.js"]) {
      const txt = readFileSync(join(out, f), "utf8");
      expect(txt, f).not.toMatch(/(href|src)="\//);
      expect(txt, f).not.toMatch(/location\.(href|replace)\s*[=(]\s*["']\//);
    }
    expect(existsSync(join(out, ".nojekyll"))).toBe(true);
  });

  it("o site gerado funciona servido numa subpasta (como no GitHub Pages)", async () => {
    const root = mkdtempSync(join(tmpdir(), "qa-web-root-"));
    buildWeb({ outDir: join(root, "QA-Playwright"), creds });
    const app = await startTestApp(0, root);
    try {
      const page = await browser.newPage();
      await login(page, `${app.url}/QA-Playwright/index.html`, creds.user, creds.pass);
      await page.waitForURL("**/QA-Playwright/inventory.html");
      await page.getByRole("button", { name: "Open Menu" }).click();
      await page.getByRole("link", { name: "Logout" }).click();
      await page.waitForURL("**/QA-Playwright/index.html");
      await page.close();
    } finally {
      await app.close();
    }
  });

  it("o site gerado aceita as credenciais novas e recusa as antigas", async () => {
    const out = mkdtempSync(join(tmpdir(), "qa-web-"));
    buildWeb({ outDir: out, creds });
    const app = await startTestApp(0, out);
    try {
      const ok = await browser.newPage();
      await login(ok, app.url, creds.user, creds.pass);
      await ok.waitForURL("**/inventory.html");
      await ok.close();

      const old = await browser.newPage();
      await login(old, app.url, "standard_user", "secret_sauce");
      expect(await old.getByRole("alert").innerText()).toContain("do not match");
      await old.close();

      const locked = await browser.newPage();
      await login(locked, app.url, creds.lockedUser, creds.pass);
      expect(await locked.getByRole("alert").innerText()).toBe("Epic sadface: Sorry, this user has been locked out.");
      await locked.close();
    } finally {
      await app.close();
    }
  });
});

describe("writeEnvWeb", () => {
  it("grava APP_USER/APP_PASS/LOCKED_USER com modo 0600 e copia a chave quando informada", () => {
    const f = join(mkdtempSync(join(tmpdir(), "qa-env-")), ".env.web");
    writeEnvWeb(f, creds, "sk-ant-teste");
    const txt = readFileSync(f, "utf8");
    expect(txt).toContain("APP_USER=qa_abc123");
    expect(txt).toContain("APP_PASS=S3nha-de-teste-XYZ");
    expect(txt).toContain("LOCKED_USER=qa_bloqueado_abc123");
    expect(txt).toContain("ANTHROPIC_API_KEY=sk-ant-teste");
    expect(statSync(f).mode & 0o777).toBe(0o600);
  });
});
