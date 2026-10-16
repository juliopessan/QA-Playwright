import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser } from "playwright";
import { startTestApp } from "../app/server.js";
import { click, compiled, scriptedProvider, type Rule } from "../support/scripted-provider.js";
import { LOGIN_RULES } from "../support/login-rules.js";
import { CompileCache } from "../../src/compiler/cache.js";
import { loadConfig, type AppConfig } from "../../src/config/index.js";
import { BudgetedProvider } from "../../src/llm/budget.js";
import type { LLMProvider } from "../../src/llm/provider.js";
import { makeHealer } from "../../src/healer/index.js";
import { runCase } from "../../src/runner/run-case.js";
import type { TestCase } from "../../src/types/index.js";

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

const ENV = { APP_USER: "standard_user", APP_PASS: "secret_sauce" };
const tc: TestCase = {
  id: "TC-001",
  title: "Login",
  steps: [
    { index: 1, text: "Acessar a página inicial do sistema" },
    { index: 2, text: "Preencher o campo de usuário", data: "{{APP_USER}}" },
    { index: 3, text: "Preencher o campo de senha", data: "{{APP_PASS}}" },
    { index: 4, text: "Clicar no botão Login" },
    { index: 5, text: "Verificar que a lista de produtos é exibida", expected: "Products" },
  ],
};
const BROKEN_LOGIN: Rule = { match: /Clicar no botão Login/, task: "compile", response: compiled([click("Entrar")]) };
const FIX: Rule = { match: /./, task: "heal", response: { actions: [click("Login")], note: "botão Entrar → Login" } };

async function setup(cfgOver: Partial<AppConfig> = {}) {
  const cfg = await loadConfig({
    configPath: "/nao/existe.yaml",
    overrides: { baseUrl: app.url, stepTimeoutMs: 800, ...cfgOver },
  });
  const cache = new CompileCache(join(mkdtempSync(join(tmpdir(), "qa-heal-")), "cache"));
  const evidenceDir = join(mkdtempSync(join(tmpdir(), "qa-heal-ev-")), "evidence");
  return { cfg, cache, evidenceDir };
}

async function run(provider: LLMProvider, s: Awaited<ReturnType<typeof setup>>, healProvider: LLMProvider = provider, heal = true, testCase = tc) {
  const page = await browser.newPage();
  const r = await runCase(testCase, {
    page,
    provider,
    cache: s.cache,
    cfg: s.cfg,
    env: ENV,
    evidenceDir: s.evidenceDir,
    heal: heal ? makeHealer({ provider: healProvider, cfg: s.cfg }) : undefined,
  });
  await page.close();
  return r;
}

describe("healer", () => {
  it("quebra induzida é corrigida: passo healed com healNote, cache atualizado, 2ª execução sem LLM", async () => {
    const s = await setup();
    const provider = scriptedProvider([BROKEN_LOGIN, FIX, ...LOGIN_RULES]);
    const r = await run(provider, s);
    expect(r.steps.map((x) => x.status)).toEqual(["pass", "pass", "pass", "healed", "pass"]);
    expect(r.steps[3].healNote).toContain("Entrar → Login");

    const second = scriptedProvider([]);
    const r2 = await run(second, s, second, false);
    expect(second.calls).toHaveLength(0);
    expect(r2.steps.map((x) => x.status)).toEqual(["pass", "pass", "pass", "pass", "pass"]);
  });

  it("sem solução em maxHealAttempts tentativas: passo fail (e exatamente 2 chamadas heal)", async () => {
    const s = await setup();
    const BAD: Rule = { match: /./, task: "heal", response: { actions: [click("Nada")], note: "tentativa" } };
    const provider = scriptedProvider([BROKEN_LOGIN, BAD, ...LOGIN_RULES]);
    const r = await run(provider, s);
    expect(r.steps[3].status).toBe("fail");
    expect(r.steps[4].status).toBe("skipped");
    expect(provider.calls.filter((c) => c.task === "heal")).toHaveLength(2);
  });

  it("sem healer (--no-heal): passo fica fail sem chamar o LLM de heal", async () => {
    const s = await setup();
    const provider = scriptedProvider([BROKEN_LOGIN, FIX, ...LOGIN_RULES]);
    const r = await run(provider, s, provider, false);
    expect(r.steps[3].status).toBe("fail");
    expect(provider.calls.filter((c) => c.task === "heal")).toHaveLength(0);
  });

  it("orçamento de LLM esgotado durante o heal: passo fail (nunca pass)", async () => {
    const s = await setup();
    const inner = scriptedProvider([BROKEN_LOGIN, FIX, ...LOGIN_RULES]);
    const budget = new BudgetedProvider(inner, 4); // 4 compiles; o heal estoura
    const r = await run(budget, s);
    expect(r.steps[3].status).toBe("fail");
    expect(r.steps.every((x) => x.status !== "healed")).toBe(true);
  });

  it("falha de verificação (expect) NÃO é corrigida pelo healer", async () => {
    const s = await setup();
    const WRONG_TITLE: Rule = {
      match: /Verificar que a lista/,
      task: "compile",
      response: compiled([{ kind: "expectText", text: "Titulo Errado", mode: "contains", description: "x" }], { kind: "verification" }),
    };
    const provider = scriptedProvider([WRONG_TITLE, FIX, ...LOGIN_RULES]);
    const r = await run(provider, s);
    expect(r.steps[4].status).toBe("fail");
    expect(provider.calls.filter((c) => c.task === "heal")).toHaveLength(0);
  });

  it("heal que devolve expect* é rejeitado (a asserção nunca é reescrita pelo LLM)", async () => {
    const s = await setup();
    const SNEAKY: Rule = {
      match: /./,
      task: "heal",
      response: { actions: [{ kind: "expectText", text: "", mode: "contains", description: "sempre passa" }], note: "trapaça" },
    };
    const provider = scriptedProvider([BROKEN_LOGIN, SNEAKY, ...LOGIN_RULES]);
    const r = await run(provider, s);
    expect(r.steps[3].status).toBe("fail");
  });

  it("navegação para host não permitido não é corrigida", async () => {
    const s = await setup();
    const EVIL: Rule = { match: /Acessar a página inicial/, task: "compile", response: compiled([{ kind: "goto", url: "http://evil.example/", description: "x" }]) };
    const provider = scriptedProvider([EVIL, FIX, ...LOGIN_RULES]);
    const r = await run(provider, s);
    expect(r.steps[0].status).toBe("fail");
    expect(r.steps[0].error).toMatch(/Host não permitido/);
    expect(provider.calls.filter((c) => c.task === "heal")).toHaveLength(0);
  });

  it("o prompt do heal delimita o snapshot como não confiável e traz o erro", async () => {
    const s = await setup();
    const provider = scriptedProvider([BROKEN_LOGIN, FIX, ...LOGIN_RULES]);
    await run(provider, s);
    const heal = provider.calls.find((c) => c.task === "heal")!;
    expect(heal.prompt).toContain("<pagina-nao-confiavel>");
    expect(heal.prompt).toMatch(/Entrar/);
    expect(heal.system).toMatch(/não confiável/i);
  });
});
