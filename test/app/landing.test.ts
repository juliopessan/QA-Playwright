import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser, type Page, type Route } from "playwright";
import { startTestApp } from "./server.js";
import { buildSite } from "../../scripts/build-web.js";

/** O site como é publicado: landing na raiz, app de teste em /demo/; a API da Vercel é simulada. */
const creds = { user: "qa_landing", pass: "S3nha-landing-XYZ", lockedUser: "qa_landing_bloqueado" };
let browser: Browser;
let app: Awaited<ReturnType<typeof startTestApp>>;

beforeAll(async () => {
  const out = mkdtempSync(join(tmpdir(), "qa-landing-"));
  buildSite({ outDir: out, creds, landing: "landing/index.html" });
  app = await startTestApp(0, out);
  browser = await chromium.launch();
});
afterAll(async () => {
  await browser?.close();
  await app?.close();
});

/** Fontes do Google podem não carregar sem rede; o resto não pode dar erro. */
const isExternalFont = (s: string) => /fonts\.(googleapis|gstatic)\.com/.test(s);

async function open(opts: { width?: number; scheme?: "light" | "dark"; reducedMotion?: "reduce" | "no-preference"; api?: (route: Route) => unknown } = {}) {
  const page = await browser.newPage({ viewport: { width: opts.width ?? 1280, height: 900 }, colorScheme: opts.scheme ?? "light", reducedMotion: opts.reducedMotion ?? "no-preference" });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error" && !isExternalFont(m.text() + m.location().url)) errors.push(m.text());
  });
  if (opts.api) await page.route("**/api/**", opts.api);
  await page.goto(`${app.url}/`);
  return { page, errors };
}
const overflowX = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
const json = (route: Route, status: number, body: unknown) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

async function fillForm(page: Page, over: { url?: string; code?: string; authorized?: boolean } = {}) {
  await page.getByLabel("URL do site").fill(over.url ?? "https://app.exemplo.com");
  await page.getByLabel("Usuário do site").fill("qa@empresa.com");
  await page.getByLabel("Senha do site").fill("s3gr3do!");
  await page.getByLabel("Código de acesso").fill(over.code ?? "TIME-QA-2026");
  if (over.authorized !== false) await page.getByLabel("Tenho autorização para testar este site.").check({ force: true });
}

describe("landing page publicada", () => {
  it("abre na raiz com o título e o argumento principal, sem erros de script", async () => {
    const { page, errors } = await open();
    await expect(page.title()).resolves.toBe("QA Agent");
    await expect(page.locator("h1").innerText()).resolves.toMatch(/seu SaaS inteiro, sem alterar um único dado/);
    await page.waitForTimeout(800);
    expect(errors).toEqual([]);
    await page.close();
  });

  for (const [width, scheme] of [[1280, "light"], [390, "dark"]] as const) {
    it(`não tem rolagem lateral em ${width}px (tema ${scheme})`, async () => {
      const { page } = await open({ width, scheme });
      await page.waitForTimeout(500);
      expect(await overflowX(page)).toBeLessThanOrEqual(0);
      await page.close();
    });
  }

  it("todo link interno (#seção) aponta para uma seção que existe", async () => {
    const { page } = await open();
    const missing = await page.evaluate(() =>
      [...document.querySelectorAll('a[href^="#"]')].map((a) => a.getAttribute("href")!.slice(1)).filter((id) => id && !document.getElementById(id)),
    );
    expect(missing).toEqual([]);
    await page.close();
  });

  it("o link 'App de teste' leva ao login em /demo/, que funciona", async () => {
    const { page } = await open();
    await page.getByRole("link", { name: "App de teste" }).first().click();
    await page.waitForURL("**/demo/");
    await page.getByRole("textbox", { name: "Username" }).fill(creds.user);
    await page.getByRole("textbox", { name: "Password" }).fill(creds.pass);
    await page.getByRole("button", { name: "Login" }).click();
    await page.waitForURL("**/demo/inventory.html");
    await page.close();
  });

  it("na troca de palavras do título, a palavra que entra cobre a anterior", async () => {
    for (const scheme of ["light", "dark"] as const) {
      const { page } = await open({ scheme });
      const c = await page.evaluate(() => ({
        words: [...document.querySelectorAll(".roll__w")].map((w) => getComputedStyle(w).backgroundColor),
        body: getComputedStyle(document.body).backgroundColor,
      }));
      expect(c.words.length).toBeGreaterThan(1);
      for (const w of c.words) expect(w, scheme).toBe(c.body);
      await page.close();
    }
  });

  it("com movimento reduzido, todo o conteúdo fica visível sem rolar", async () => {
    const { page } = await open({ reducedMotion: "reduce" });
    const hidden = await page.evaluate(() =>
      [...document.querySelectorAll(".reveal, [data-reveal], [data-reveal-group] > *")].filter((el) => Number(getComputedStyle(el).opacity) < 1).length,
    );
    expect(hidden).toBe(0);
    await page.close();
  });
});

describe("análise pela landing", () => {
  it("valida no envio: aponta os campos e não chama a API", async () => {
    let called = 0;
    const { page } = await open({ api: (r) => { called++; return json(r, 500, {}); } });
    await page.getByRole("button", { name: "Analisar o site" }).click();
    await expect(page.locator("#az-form-err").innerText()).resolves.toMatch(/Corrija 3 campos/);
    await expect(page.locator("#az-url").getAttribute("aria-invalid")).resolves.toBe("true");
    await expect(page.evaluate(() => document.activeElement?.id)).resolves.toBe("az-url");
    expect(called).toBe(0);
    await page.close();
  });

  it("envia, acompanha fila → execução → pronto e mostra o resumo e o link do relatório", async () => {
    let sent: any;
    let polls = 0;
    const { page, errors } = await open({
      api: (route) => {
        const u = new URL(route.request().url());
        if (u.pathname === "/api/analyze") {
          sent = route.request().postDataJSON();
          return json(route, 202, { id: "3f2b8c1e-9a4d-4e6f-8b2a-1c3d5e7f9a0b", token: "1.sig", url: "https://app.exemplo.com/" });
        }
        polls++;
        if (polls === 1) return json(route, 200, { state: "running" });
        return json(route, 200, { state: "done", summary: { screens: 8, findings: 41, blocked: 1 }, reportUrl: "/api/report?id=x&t=1.sig" });
      },
    });
    await page.clock.install();
    await fillForm(page);
    await page.getByRole("button", { name: "Analisar o site" }).click();
    await expect.poll(() => sent).toBeTruthy();
    expect(sent).toEqual({ url: "https://app.exemplo.com", user: "qa@empresa.com", pass: "s3gr3do!", code: "TIME-QA-2026", authorized: true });
    await expect.poll(() => page.locator("#az-host").innerText()).toBe("app.exemplo.com");
    await expect(page.getByLabel("Senha do site").inputValue()).resolves.toBe("");
    await page.clock.runFor(5000);
    await expect.poll(() => page.locator('#az-steps li[data-step="running"]').getAttribute("class")).toContain("is-on");
    await page.clock.runFor(11000);
    await expect.poll(() => page.locator("#az-actions").isVisible()).toBe(true);
    await expect(page.getByRole("link", { name: "Abrir o relatório" }).getAttribute("href")).resolves.toBe("/api/report?id=x&t=1.sig");
    await expect(page.locator("#az-findings").innerText()).resolves.toBe("41");
    expect(errors).toEqual([]);
    await page.close();
  });

  it("erro da API marca o campo certo e mostra a mensagem", async () => {
    const { page } = await open({ api: (r) => json(r, 401, { error: "Código de acesso inválido. Confira o código que você recebeu.", field: "code" }) });
    await fillForm(page, { code: "ERRADO-123" });
    await page.getByRole("button", { name: "Analisar o site" }).click();
    await expect.poll(() => page.locator("#az-form-err").innerText()).toMatch(/Código de acesso inválido/);
    await expect(page.locator("#az-code").getAttribute("aria-invalid")).resolves.toBe("true");
    await expect(page.locator("#az-idle").isVisible()).resolves.toBe(true);
    await page.close();
  });

  it("falha da análise aparece no painel com o motivo", async () => {
    const { page } = await open({
      api: (route) =>
        new URL(route.request().url()).pathname === "/api/analyze"
          ? json(route, 202, { id: "3f2b8c1e-9a4d-4e6f-8b2a-1c3d5e7f9a0b", token: "1.sig", url: "https://app.exemplo.com/" })
          : json(route, 200, { state: "failed", error: "Login falhou: credenciais recusadas" }),
    });
    await page.clock.install();
    await fillForm(page);
    await page.getByRole("button", { name: "Analisar o site" }).click();
    await expect.poll(() => page.locator("#az-host").innerText()).toBe("app.exemplo.com");
    await page.clock.runFor(5000);
    await expect.poll(() => page.locator("#az-status").innerText()).toMatch(/Login falhou/);
    await expect(page.locator("#az-actions").isVisible()).resolves.toBe(false);
    await page.close();
  });
});

describe("landing/index.html", () => {
  it("está regenerado a partir de index.src.html", () => {
    const body = (html: string) => html.slice(html.indexOf('<div class="wrap">'), html.indexOf("</footer>"));
    const src = body(readFileSync("landing/index.src.html", "utf8"));
    expect(src.length).toBeGreaterThan(1000);
    expect(body(readFileSync("landing/index.html", "utf8")), "rode o build da landing depois de editar index.src.html").toBe(src);
  });
});
