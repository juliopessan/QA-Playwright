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
  buildSite({ outDir: out, creds, landing: "landing/index.html", example: "docs/exemplo-relatorio", analysisExample: "docs/exemplo-analise-web" });
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
    await expect(page.locator("h1").innerText()).resolves.toMatch(/qualquer site só com a URL/);
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
  const report = {
    url: "https://ukodelabs.com.br/", finalUrl: "https://ukodelabs.com.br/", analyzedAt: "2026-10-17T16:00:00Z", durationMs: 31000, status: 200, responseMs: 420,
    pages: [{ url: "https://ukodelabs.com.br/", title: "Ukode" }, { url: "https://ukodelabs.com.br/servicos", title: "Serviços" }],
    summary: "Site claro, mas sem chamada principal.",
    findings: [
      { origin: "measured", category: "seguranca", severity: "medium", title: "Falta o cabeçalho HSTS", evidence: "strict-transport-security ausente", suggestion: "Adicione HSTS.", page: "https://ukodelabs.com.br/" },
      { origin: "agent", category: "ux", severity: "low", title: "CTA vago <b>x</b>", description: "d", evidence: "Fale conosco", suggestion: "Diga o que acontece.", page: "https://ukodelabs.com.br/", confidence: 0.7 },
    ],
    shots: [{ url: "https://ukodelabs.com.br/", title: "UKode Labs", status: 200, loadMs: 1800, desktop: "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=", mobile: "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=" }, { url: "https://ukodelabs.com.br/contato", title: "Contato", status: 200, loadMs: 900, desktop: "javascript:alert(1)" }],
    counts: { high: 0, medium: 1, low: 1 }, notes: ["1 sugestão(ões) do modelo descartada(s) por não citar um trecho real do site."],
  };

  it("o formulário pede só a URL", async () => {
    const { page } = await open();
    const fields = await page.locator("#analyzeForm input").evaluateAll((els) => els.map((e) => (e as HTMLInputElement).name));
    expect(fields).toEqual(["url"]);
    await page.close();
  });

  it("URL vazia ou inválida: aponta o campo e não chama a API", async () => {
    let called = 0;
    const { page } = await open({ api: (r) => { called++; return json(r, 500, {}); } });
    await page.getByRole("button", { name: "Analisar o site" }).click();
    await expect(page.locator("#az-url").getAttribute("aria-invalid")).resolves.toBe("true");
    await expect(page.evaluate(() => document.activeElement?.id)).resolves.toBe("az-url");
    expect(called).toBe(0);
    await page.close();
  });

  it("envia só a URL e monta o relatório: resumo, números, achados medidos e do agente, sem interpretar HTML", async () => {
    let sent: any;
    const { page, errors } = await open({ api: (route) => { sent = route.request().postDataJSON(); return json(route, 200, report); } });
    await page.getByLabel("URL do site").fill("ukodelabs.com.br");
    await page.getByRole("button", { name: "Analisar o site" }).click();
    await expect.poll(() => page.locator("#az-result").isVisible()).toBe(true);
    expect(sent).toEqual({ url: "ukodelabs.com.br" });
    await expect(page.locator("#az-result-h").innerText()).resolves.toBe("Análise de ukodelabs.com.br");
    await expect(page.locator("#az-summary").innerText()).resolves.toBe("Site claro, mas sem chamada principal.");
    await expect(page.locator("#az-kpis").innerText()).resolves.toMatch(/Telas analisadas\s*2[\s\S]*Achados\s*2[\s\S]*0,4 s/);
    const items = page.locator("#az-findings article");
    await expect(items.count()).resolves.toBe(2);
    await expect(items.nth(0).innerText()).resolves.toMatch(/Média[\s\S]*Segurança[\s\S]*medido/);
    await expect(items.nth(1).innerText()).resolves.toMatch(/opinião do agente[\s\S]*CTA vago <b>x<\/b>/);
    await expect(page.locator("#az-findings h4 b").count()).resolves.toBe(0);
    await expect(page.locator("#az-notes").innerText()).resolves.toMatch(/descartada/);
    expect(errors).toEqual([]);
    await page.close();
  });

  it("mostra os prints (desktop e celular) e recusa imagem que não é JPEG em data URL", async () => {
    const { page } = await open({ api: (r) => json(r, 200, report) });
    await page.getByLabel("URL do site").fill("ukodelabs.com.br");
    await page.getByRole("button", { name: "Analisar o site" }).click();
    await expect.poll(() => page.locator("#az-result").isVisible()).toBe(true);
    const imgs = await page.locator("#az-shots img").evaluateAll((els) => els.map((e) => ({ alt: e.getAttribute("alt"), src: (e.getAttribute("src") ?? "").slice(0, 23) })));
    expect(imgs).toEqual([{ alt: "Screenshot de UKode Labs no desktop", src: "data:image/jpeg;base64," }, { alt: "Screenshot de UKode Labs no celular", src: "data:image/jpeg;base64," }]);
    await expect(page.locator("#az-shots figcaption").first().innerText()).resolves.toMatch(/UKode Labs[\s\S]*HTTP 200 · 1,8 s/);
    await page.close();
  });

  it("baixa o relatório como documento: PDF e HTML pedem ao servidor o documento A4 com o resultado da análise", async () => {
    const requests: any[] = [];
    const { page } = await open({
      api: (route) => {
        const u = new URL(route.request().url());
        if (u.pathname === "/api/analyze") return json(route, 200, report);
        const body = route.request().postDataJSON();
        requests.push(body);
        return route.fulfill({ status: 200, headers: { "content-type": body.format === "pdf" ? "application/pdf" : "text/html", "content-disposition": `attachment; filename="relatorio-qa-agent-ukodelabs.com.br.${body.format}"` }, body: body.format === "pdf" ? "%PDF-1.4 fake" : "<html>documento</html>" });
      },
    });
    await page.getByLabel("URL do site").fill("ukodelabs.com.br");
    await page.getByRole("button", { name: "Analisar o site" }).click();
    await expect.poll(() => page.locator("#az-result").isVisible()).toBe(true);

    const [pdf] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Baixar o relatório (PDF)" }).click()]);
    expect(pdf.suggestedFilename()).toBe("relatorio-qa-agent-ukodelabs.com.br.pdf");
    expect(readFileSync((await pdf.path())!, "utf8")).toBe("%PDF-1.4 fake");
    const [html] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Baixar em HTML" }).click()]);
    expect(html.suggestedFilename()).toBe("relatorio-qa-agent-ukodelabs.com.br.html");
    expect(requests.map((r) => r.format)).toEqual(["pdf", "html"]);
    expect(requests[0].report.findings).toHaveLength(2);
    expect(requests[0].report.shots[0].desktop).toMatch(/^data:image\/jpeg/);
    await page.close();
  });

  it("falha ao gerar o documento aparece como aviso legível e o botão volta ao normal", async () => {
    const { page } = await open({
      api: (route) => (new URL(route.request().url()).pathname === "/api/analyze" ? json(route, 200, report) : json(route, 502, { error: "Não foi possível gerar o PDF agora. Baixe o HTML e use Imprimir → Salvar como PDF no navegador." })),
    });
    await page.getByLabel("URL do site").fill("ukodelabs.com.br");
    await page.getByRole("button", { name: "Analisar o site" }).click();
    await expect.poll(() => page.locator("#az-result").isVisible()).toBe(true);
    await page.getByRole("button", { name: "Baixar o relatório (PDF)" }).click();
    await expect.poll(() => page.locator("#toasts").innerText()).toMatch(/Baixe o HTML/);
    await expect.poll(() => page.locator("#az-pdf").getAttribute("aria-busy")).toBeNull();
    await page.close();
  });

  it("erro da API aparece no campo e no painel", async () => {
    const { page } = await open({ api: (r) => json(r, 400, { error: "Só é possível analisar sites públicos, pelo nome de domínio.", field: "url" }) });
    await page.getByLabel("URL do site").fill("http://intranet.local");
    await page.getByRole("button", { name: "Analisar o site" }).click();
    await expect.poll(() => page.locator("#az-url").getAttribute("aria-invalid")).toBe("true");
    await expect(page.locator("#az-url-err").innerText()).resolves.toMatch(/sites públicos/);
    await expect.poll(() => page.locator("#az-live").innerText()).toMatch(/sites públicos/);
    await expect(page.locator("#az-result").isVisible()).resolves.toBe(false);
    await page.close();
  });

  it("o andamento começa no clique: verbo visível já nos primeiros 300 ms, etapas avançam e o relatório aparece no fim", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { page } = await open({ api: async (route) => { await gate; return json(route, 200, report); } });
    await page.getByLabel("URL do site").fill("ukodelabs.com.br");
    await page.getByRole("button", { name: "Analisar o site" }).click();
    await page.waitForTimeout(300);
    const live = page.locator("#az-live");
    await expect(live.getAttribute("class")).resolves.toContain("verb--run");
    await expect(live.locator(".verb__text").innerText()).resolves.toMatch(/Lendo as páginas/);
    await expect(live.isVisible()).resolves.toBe(true);
    await expect(page.locator("#az-submit").getAttribute("aria-busy")).resolves.toBe("true");
    await expect(page.locator('#az-steps li[data-step="1"]').getAttribute("class")).resolves.toContain("is-on");
    await expect(page.locator("#az-host").innerText()).resolves.toBe("ukodelabs.com.br");
    release();
    await expect.poll(() => page.locator("#az-result").isVisible()).toBe(true);
    await expect.poll(() => live.innerText()).toMatch(/Análise pronta em \d+ s/);
    await page.close();
  });

  it("erro rápido (ex.: análise não configurada) aparece depois do verbo, legível nos dois temas", async () => {
    for (const scheme of ["light", "dark"] as const) {
      const { page } = await open({ scheme, api: (r) => json(r, 503, { error: "A análise ainda não foi configurada neste site." }) });
      await page.getByLabel("URL do site").fill("ukodelabs.com.br");
      await page.getByRole("button", { name: "Analisar o site" }).click();
      await page.waitForTimeout(200);
      await expect(page.locator("#az-live").getAttribute("class")).resolves.toContain("verb--run");
      await expect.poll(() => page.locator("#az-live").innerText()).toMatch(/não foi configurada/);
      const c = await page.locator("#az-live").evaluate((el) => {
        const lum = (rgb: string) => { const [r, g, b] = rgb.match(/\d+/g)!.map(Number).map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
        const fg = lum(getComputedStyle(el).color), bg = lum(getComputedStyle(document.body).backgroundColor);
        return (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
      });
      expect(c, scheme).toBeGreaterThan(4.5);
      await expect.poll(() => page.locator("#az-submit").getAttribute("aria-busy")).toBeNull();
      await page.close();
    }
  });
});

describe("relatório de exemplo", () => {
  it("a landing leva ao relatório real do CLI, com prints de telas e do fluxo carregando", async () => {
    const { page } = await open();
    const href = await page.getByRole("link", { name: "Ver um relatório real com prints" }).getAttribute("href");
    expect(href).toBe("exemplo/relatorio.html");
    await page.goto(`${app.url}/${href}`);
    await expect(page.locator("h1").innerText()).resolves.toMatch(/127\.0\.0\.1/);
    const srcs = await page.locator("img").evaluateAll((els) => els.map((e) => e.getAttribute("src") ?? ""));
    expect(srcs.length).toBeGreaterThan(10);
    expect(srcs.some((s) => s.startsWith("img/fluxos/"))).toBe(true);
    const broken: string[] = [];
    for (const src of srcs) {
      const r = await page.request.get(`${app.url}/exemplo/${src}`);
      const body = await r.body();
      if (r.status() !== 200 || body[0] !== 0xff || body[1] !== 0xd8) broken.push(src);
    }
    expect(broken).toEqual([]);
    await page.close();
  });
});

describe("relatório de exemplo da análise pela web", () => {
  it("a landing oferece o PDF de exemplo, que é um documento A4 real, e o HTML; os JSONs de apoio não são publicados", async () => {
    const { page } = await open();
    const href = await page.getByRole("link", { name: "Ver um relatório de exemplo (PDF)" }).first().getAttribute("href");
    expect(href).toBe("exemplo-analise/relatorio-app-de-teste.pdf");
    const pdf = await page.request.get(`${app.url}/${href}`);
    expect(pdf.status()).toBe(200);
    expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");
    const html = await page.request.get(`${app.url}/exemplo-analise/relatorio-app-de-teste.html`);
    expect(await html.text()).toContain("1. Resumo executivo");
    expect((await page.request.get(`${app.url}/exemplo-analise/app-de-teste.json`)).status()).toBe(404);
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
