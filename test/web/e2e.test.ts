import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser } from "playwright";
import { inspectPages } from "../../api/_lib/browser.js";
import { startTestApp } from "../app/server.js";
import { buildSite } from "../../scripts/build-web.js";
import { makeAnalyze } from "../../api/analyze.js";
import { makeLimiter } from "../../api/_lib/core.js";
import { exaCrawl } from "../../api/_lib/exa.js";
import { reviewWithClaude } from "../../api/_lib/review.js";

/**
 * Fluxo completo no navegador: landing → POST /api/analyze (handler real) → Exa (HTTP simulado com o
 * conteúdo real lido de ukodelabs.com.br) + visita direta (HTML simulado) + Claude (cliente simulado) → relatório.
 */
const HOME = "https://ukodelabs.com.br/";
const TEXT = "Seus agentes funcionam na demo. A gente faz funcionar em produção.\nA UKode Labs constrói a camada que fica entre os seus agentes e os sistemas do negócio: política antes da ação, aprovação humana onde está o risco, custo por execução e uma auditoria que responde perguntas.";
const exaFetch = (async () =>
  new Response(JSON.stringify({ results: [{ url: HOME, title: "UKode Labs", text: TEXT, subpages: [{ url: `${HOME}contato`, title: "Contato", text: "Fale com a gente" }] }] }))) as unknown as typeof fetch;
const HTML = `<!doctype html><html><head><title>UKode Labs</title></head><body><h1>Seus agentes funcionam na demo.</h1><img src="logo.png"></body></html>`;
const claude = {
  beta: { messages: { create: async () => ({ model: "claude-opus-5-5", stop_reason: "end_turn", usage: {}, content: [{ type: "text", text: JSON.stringify({
    summary: "A UKode Labs vende uma camada de governança para agentes de IA; a mensagem é forte, mas falta um próximo passo claro.",
    findings: [
      { title: "Falta uma chamada para ação na abertura", description: "O texto explica o problema, mas não diz o que fazer em seguida.", category: "ux", severity: "medium", page: HOME, evidence: "A gente faz funcionar em produção", suggestion: "Adicione um botão 'Agendar diagnóstico'.", confidence: 0.8 },
      { title: "Promessa sem prova", description: "Inventado pelo modelo.", category: "confianca", severity: "medium", page: HOME, evidence: "99,9% de disponibilidade garantida", suggestion: "x", confidence: 0.5 },
    ] }) }] }) } },
};

let reviewImages = 0;
let browser: Browser;
let app: Awaited<ReturnType<typeof startTestApp>>;
beforeAll(async () => {
  const out = mkdtempSync(join(tmpdir(), "qa-e2e-"));
  buildSite({ outDir: out, creds: { user: "u_e2e", pass: "p-e2e-123", lockedUser: "u_e2e_b" }, landing: "landing/index.html" });
  app = await startTestApp(0, out);
  browser = await chromium.launch();
});
afterAll(async () => {
  await browser?.close();
  await app?.close();
});

describe("análise pela landing, de ponta a ponta", () => {
  it("cola a URL, vê o andamento e recebe o relatório com medições e a revisão filtrada", async () => {
    const handler = makeAnalyze({
      env: { EXA_API_KEY: "exa-test", ANTHROPIC_API_KEY: "sk-test" },
      limiter: makeLimiter({ max: 10 }),
      exaCrawl: (url: string, o: any) => exaCrawl(url, { ...o, doFetch: exaFetch }),
      fetchPage: async () => ({ status: 200, finalUrl: HOME, ms: 2100, bytes: HTML.length, headers: { "content-type": "text/html" }, html: HTML }),
      // Playwright de verdade fotografando o app de teste local (no lugar do site real, que a rede daqui não alcança).
      inspectPages: () => inspectPages([`${app.url}/demo/`], { launch: () => chromium.launch(), resolve: (async () => [{ address: "200.1.2.3", family: 4 }]) as never, allowHosts: ["127.0.0.1"] }),
      review: (pages: any, facts: any, o: any) => { reviewImages = o.images.length; return reviewWithClaude(pages, facts, { client: claude, images: o.images }); },
    });
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("**/api/analyze", async (route) => {
      const out: any = { headers: {} };
      const res = { set statusCode(v: number) { out.status = v; }, setHeader(k: string, v: string) { out.headers[k] = v; }, end(b: string) { out.body = b; } };
      await new Promise((r) => setTimeout(r, 1200));
      await handler({ method: "POST", body: route.request().postDataJSON(), headers: { "x-forwarded-for": "9.9.9.9" } }, res);
      await route.fulfill({ status: out.status, headers: out.headers, body: out.body });
    });
    await page.goto(`${app.url}/`);
    await page.getByLabel("URL do site").fill("ukodelabs.com.br");
    await page.getByRole("button", { name: "Analisar o site" }).click();
    await page.waitForTimeout(250);
    await expect(page.locator("#az-live .verb__text").innerText()).resolves.toMatch(/Lendo as páginas/);

    await expect.poll(() => page.locator("#az-result").isVisible(), { timeout: 10_000 }).toBe(true);
    await expect(page.locator("#az-result-h").innerText()).resolves.toBe("Análise de ukodelabs.com.br");
    await expect(page.locator("#az-summary").innerText()).resolves.toMatch(/governança para agentes/);
    const text = await page.locator("#az-findings").innerText();
    expect(text).toMatch(/Falta o cabeçalho Strict-Transport-Security/);
    expect(text).toMatch(/1 de 1 imagens sem texto alternativo/);
    expect(text).toMatch(/Resposta acima de 1,5 s: 2,1 s/);
    expect(text).toMatch(/Falta uma chamada para ação na abertura/);
    expect(text).not.toMatch(/Promessa sem prova/);
    await expect(page.locator("#az-notes").innerText()).resolves.toMatch(/1 sugestão\(ões\) do modelo descartada/);
    await expect(page.locator("#az-pages").innerText()).resolves.toContain(`${HOME}contato`);
    await expect(page.locator("#az-kpis").innerText()).resolves.toMatch(/Telas analisadas\s*1/);
    await expect.poll(() => page.locator("#az-live").innerText()).toMatch(/Análise pronta em \d+ s/);
    // Prints reais do Playwright aparecem na página (desktop + celular) e seguem para o Claude.
    const shots = page.locator("#az-shots img");
    await expect(shots.count()).resolves.toBe(2);
    const sizes = await shots.evaluateAll((els) => els.map((e) => [(e as HTMLImageElement).naturalWidth, (e as HTMLImageElement).naturalHeight]));
    expect(sizes[0][0]).toBe(1280);
    expect(sizes[1][0]).toBe(390);
    expect(reviewImages).toBe(2);
    expect(text).toMatch(/Acessibilidade: /);
    expect(errors).toEqual([]);
    await page.close();
  });
});
