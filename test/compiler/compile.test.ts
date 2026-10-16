import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { FakeLLMProvider } from "../../src/llm/fake.js";
import { CompileCache, cacheKey, COMPILER_VERSION } from "../../src/compiler/cache.js";
import { compileStep } from "../../src/compiler/compile.js";
import { snapshotPage } from "../../src/compiler/snapshot.js";
import { loadConfig } from "../../src/config/index.js";
import type { Step } from "../../src/types/index.js";

let browser: Browser;
let page: Page;
beforeAll(async () => {
  browser = await chromium.launch();
  page = await browser.newPage();
  await page.setContent(
    '<h1>Painel</h1><p>Contato: maria@bayer.com</p><button>Entrar</button>',
  );
});
afterAll(async () => {
  await browser.close();
});

const step: Step = { index: 1, text: "Clicar no botão Entrar" };
const goodResponse = {
  kind: "action",
  confidence: 0.9,
  subjective: false,
  actions: [{ kind: "click", locator: { role: "button", name: "Entrar" }, description: "Clicar em Entrar" }],
};
const newCache = () => new CompileCache(mkdtempSync(join(tmpdir(), "qa-cache-")));
const base = { stepText: "x", url: "http://a/b", compilerVersion: COMPILER_VERSION, providerId: "p" };

describe("cacheKey", () => {
  it("muda quando muda o texto, os dados, o resultado esperado, a URL, o provider.id ou a versão", () => {
    const k = cacheKey(base);
    expect(cacheKey({ ...base, stepText: "y" })).not.toBe(k);
    expect(cacheKey({ ...base, data: "{{A}}" })).not.toBe(k);
    expect(cacheKey({ ...base, expected: "algo" })).not.toBe(k);
    expect(cacheKey({ ...base, url: "http://a/c" })).not.toBe(k);
    expect(cacheKey({ ...base, providerId: "q" })).not.toBe(k);
    expect(cacheKey({ ...base, compilerVersion: "99" })).not.toBe(k);
  });
  it("ignora query string e hash da URL", () => {
    expect(cacheKey({ ...base, url: "http://a/b?x=1#h" })).toBe(cacheKey(base));
  });
  it("usa o template {{VAR}}: o valor do segredo nunca entra na chave", () => {
    const k = cacheKey({ ...base, data: "{{APP_PASS}}" });
    expect(k).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("snapshotPage", () => {
  it("devolve a árvore de acessibilidade com dados sensíveis redigidos", async () => {
    const s = await snapshotPage(page);
    expect(s).toContain("Entrar");
    expect(s).not.toContain("maria@bayer.com");
    expect(s).toContain("[REDIGIDO]");
  });
});

describe("compileStep", () => {
  it("miss chama o LLM uma vez e grava; segunda chamada vem do cache com 0 chamadas ao LLM", async () => {
    const cfg = await loadConfig({ configPath: "/nao/existe.yaml" });
    const cache = newCache();
    const provider = new FakeLLMProvider(() => goodResponse);
    const first = await compileStep(step, { page, provider, cache, cfg });
    expect(first.fromCache).toBe(false);
    expect(first.actions[0].kind).toBe("click");
    expect(provider.calls).toHaveLength(1);
    const second = await compileStep(step, { page, provider, cache, cfg });
    expect(second.fromCache).toBe(true);
    expect(provider.calls).toHaveLength(1);
  });

  it("confiança abaixo de minConfidence não é gravada no cache", async () => {
    const cfg = await loadConfig({ configPath: "/nao/existe.yaml" });
    const cache = newCache();
    const provider = new FakeLLMProvider(() => ({ ...goodResponse, confidence: 0.2 }));
    const first = await compileStep(step, { page, provider, cache, cfg });
    expect(first.confidence).toBe(0.2);
    await compileStep(step, { page, provider, cache, cfg });
    expect(provider.calls).toHaveLength(2);
  });

  it("o prompt enviado contém o snapshot e NÃO contém o e-mail", async () => {
    const cfg = await loadConfig({ configPath: "/nao/existe.yaml" });
    const provider = new FakeLLMProvider(() => goodResponse);
    await compileStep(step, { page, provider, cache: newCache(), cfg });
    const sent = provider.calls[0];
    expect(sent.task).toBe("compile");
    expect(sent.prompt).toContain("Entrar");
    expect(sent.prompt).not.toContain("maria@bayer.com");
    expect(sent.system).toMatch(/não confiável|nao confiavel/i);
  });

  it("o prompt carrega o template de dados sem resolver e o resultado esperado", async () => {
    const cfg = await loadConfig({ configPath: "/nao/existe.yaml" });
    const provider = new FakeLLMProvider(() => goodResponse);
    await compileStep(
      { index: 2, text: "Preencher senha", data: "{{APP_PASS}}", expected: "Campo preenchido" },
      { page, provider, cache: newCache(), cfg },
    );
    expect(provider.calls[0].prompt).toContain("{{APP_PASS}}");
    expect(provider.calls[0].prompt).toContain("Campo preenchido");
  });

  it("resposta inválida duas vezes propaga LLMInvalidResponse", async () => {
    const cfg = await loadConfig({ configPath: "/nao/existe.yaml" });
    const provider = new FakeLLMProvider(() => ({ lixo: 1 }));
    await expect(compileStep(step, { page, provider, cache: newCache(), cfg })).rejects.toThrow(/inválida/);
  });
});
