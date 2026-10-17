import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { startSaas, SAAS_USER, SAAS_PASS } from "../saas/server.js";
import { attachCollectors, collectMetrics } from "../../src/explore/collect.js";
import { technicalFindings } from "../../src/analyze/technical.js";
import { accessibilityFindings } from "../../src/analyze/accessibility.js";
import { performanceFindings } from "../../src/analyze/performance.js";

let browser: Browser;
let saas: Awaited<ReturnType<typeof startSaas>>;
let ctx: BrowserContext;
let page: Page;
beforeAll(async () => {
  browser = await chromium.launch();
  saas = await startSaas(0, { slowMs: 1200 });
  ctx = await browser.newContext();
  page = await ctx.newPage();
  await page.goto(`${saas.url}/login`);
  await page.getByLabel("Usuário").fill(SAAS_USER);
  await page.getByLabel("Senha").fill(SAAS_PASS);
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.waitForURL("**/dashboard");
});
afterAll(async () => {
  await browser.close();
  await saas.close();
});

const screen = (pattern: string) => ({ id: pattern.replace(/\W+/g, "-").replace(/^-|-$/g, "") || "home", routePattern: pattern, path: ["Painel", pattern] });
async function visit(path: string) {
  const c = attachCollectors(page);
  await page.goto(`${saas.url}${path}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(150);
  return c.flush();
}

describe("coletores e analisador técnico", () => {
  it("/billing: HTTP 500 da API e console.error viram achados", async () => {
    const found = technicalFindings(screen("/billing"), await visit("/billing"));
    const titles = found.map((f) => f.title).join(" | ");
    expect(titles).toMatch(/HTTP 500/);
    const http = found.find((f) => /HTTP 500/.test(f.title))!;
    expect(http.severity).toBe("high");
    expect(http.category).toBe("technical");
    expect(http.evidence.join(" ")).toContain("/api/invoices");
    expect(found.some((f) => /Falha ao carregar faturas/.test(f.description))).toBe(true);
  });

  it("/dashboard: exceção JS não tratada é achado global de gravidade alta", async () => {
    const found = technicalFindings(screen("/dashboard"), await visit("/dashboard"));
    const ex = found.find((f) => /undefinedHelper/.test(f.title + f.description))!;
    expect(ex).toBeDefined();
    expect(ex.severity).toBe("high");
    expect(ex.scope).toBe("global");
  });

  it("a mesma exceção em duas telas gera o mesmo id", async () => {
    const a = technicalFindings(screen("/dashboard"), await visit("/dashboard")).find((f) => /undefinedHelper/.test(f.title))!;
    const b = technicalFindings(screen("/projects"), await visit("/projects")).find((f) => /undefinedHelper/.test(f.title))!;
    expect(a.id).toBe(b.id);
  });

  it("/help: o próprio documento com 404 é achado de tela", async () => {
    const c = attachCollectors(page);
    await page.goto(`${saas.url}/help`);
    const found = technicalFindings(screen("/help"), c.flush());
    const doc = found.find((f) => /HTTP 404/.test(f.title))!;
    expect(doc.scope).toBe("screen");
    expect(doc.severity).toBe("medium");
  });

  it("requisições bloqueadas pela guarda não viram falha do SaaS", () => {
    const found = technicalFindings(screen("/x"), {
      consoleErrors: ["Failed to load resource: net::ERR_BLOCKED_BY_CLIENT"],
      pageErrors: [],
      responses: [],
      failedRequests: [{ method: "POST", url: "http://x/api/delete", error: "net::ERR_BLOCKED_BY_CLIENT" }],
    });
    expect(found).toEqual([]);
  });

  it("flush zera o que foi coletado", async () => {
    const c = attachCollectors(page);
    await page.goto(`${saas.url}/billing`, { waitUntil: "networkidle" });
    expect(c.flush().responses.length).toBeGreaterThan(0);
    expect(c.flush().responses).toEqual([]);
  });
});

describe("acessibilidade (axe)", () => {
  it("/settings: imagem sem alt e campo sem rótulo", async () => {
    await page.goto(`${saas.url}/settings`);
    const found = await accessibilityFindings(page, screen("/settings"));
    const rules = found.map((f) => f.rule);
    expect(rules.join(" ")).toMatch(/axe:image-alt/);
    expect(rules.join(" ")).toMatch(/axe:label/);
    const img = found.find((f) => /image-alt/.test(f.rule))!;
    expect(img.severity).toBe("critical");
    expect(img.category).toBe("accessibility");
    expect(img.evidence.length).toBeGreaterThan(0);
  });

  it("/dashboard não tem violações críticas nem sérias", async () => {
    await page.goto(`${saas.url}/dashboard`);
    const found = await accessibilityFindings(page, screen("/dashboard"));
    expect(found.filter((f) => f.severity === "critical" || f.severity === "high")).toEqual([]);
  });
});

describe("desempenho", () => {
  const limits = { lcpMs: 1000, cls: 0.1, loadMs: 5000 };
  it("collectMetrics: /reports (renderização atrasada) tem LCP maior que /dashboard", async () => {
    await page.goto(`${saas.url}/dashboard`, { waitUntil: "load" });
    const fast = await collectMetrics(page);
    await page.goto(`${saas.url}/reports`, { waitUntil: "load" });
    await page.getByRole("heading", { level: 1 }).waitFor(); // conteúdo renderizado com atraso
    const slow = await collectMetrics(page);
    expect(slow.lcpMs).toBeGreaterThan(1000);
    expect(fast.lcpMs).toBeLessThan(slow.lcpMs);
    expect(slow.transferBytes).toBeGreaterThan(0);
  });

  it("LCP acima do limite vira achado e abaixo não", () => {
    const over = performanceFindings({ lcpMs: 2600, cls: 0, loadMs: 800, transferBytes: 1000 }, limits, screen("/reports"));
    expect(over.map((f) => f.rule)).toEqual(["lcp acima do limite"]);
    expect(over[0]).toMatchObject({ category: "performance", scope: "screen", severity: "high" });
    expect(performanceFindings({ lcpMs: 900, cls: 0, loadMs: 800, transferBytes: 1000 }, limits, screen("/x"))).toEqual([]);
  });

  it("CLS e carregamento acima do limite", () => {
    const f = performanceFindings({ lcpMs: 100, cls: 0.4, loadMs: 9000, transferBytes: 1 }, limits, screen("/x"));
    expect(f.map((x) => x.rule).sort()).toEqual(["carregamento acima do limite", "cls acima do limite"]);
  });
});
