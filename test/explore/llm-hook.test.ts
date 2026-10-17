import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startSaas, SAAS_USER, SAAS_PASS } from "../saas/server.js";
import { explore, type ExploreOptions } from "../../src/explore/crawler.js";
import { makeScreenHook } from "../../src/explore/llm-hook.js";
import { DiskCache } from "../../src/explore/cache.js";
import { BudgetedProvider } from "../../src/llm/budget.js";
import { FakeLLMProvider } from "../../src/llm/fake.js";
import type { LLMRequest } from "../../src/llm/provider.js";

let saas: Awaited<ReturnType<typeof startSaas>>;
beforeAll(async () => {
  saas = await startSaas(0, { slowMs: 100 });
});
afterAll(async () => {
  await saas.close();
});

const tmp = () => mkdtempSync(join(tmpdir(), "qa-hook-"));
const opts = (hooks: ExploreOptions["hooks"], over: Partial<ExploreOptions> = {}): ExploreOptions => ({
  baseUrl: saas.url, user: SAAS_USER, pass: SAAS_PASS, outDir: tmp(),
  limits: { maxScreens: 12, maxDepth: 2, timeBudgetMs: 120_000, examplesPerRoute: 1 },
  ignoreUrls: [], extraWriteVerbs: [], postAllowed: [], perf: { lcpMs: 60_000, cls: 1, loadMs: 60_000 },
  settleMs: 250, hooks, ...over,
});

const routeOf = (req: LLMRequest<unknown>) => /URL atual: .*?(\/[^\s]*)/.exec(req.prompt)?.[1] ?? "";
function provider(over: { ux?: unknown; deepen?: (path: string) => unknown } = {}) {
  return new FakeLLMProvider((req) => {
    if (req.task === "deepen") {
      const path = routeOf(req);
      if (over.deepen) return over.deepen(path);
      if (path.startsWith("/team"))
        return { elements: [
          { role: "tab", name: "Convites", reason: "revela convites" },
          { role: "button", name: "Ver detalhes", reason: "abre modal de leitura" },
          { role: "button", name: "Convidar usuário", reason: "(sugestão perigosa)" },
        ] };
      if (/^\/projects\/\d+/.test(path)) return { elements: [{ role: "button", name: "Excluir projeto", reason: "(sugestão perigosa)" }] };
      return { elements: [] };
    }
    if (req.task === "ux") return over.ux ?? { findings: [] };
    return {};
  });
}
const hookWith = (p: FakeLLMProvider | BudgetedProvider, extra: { ux?: boolean; cache?: DiskCache } = {}) =>
  ({ afterScreen: makeScreenHook({ provider: p, ux: extra.ux ?? false, cache: extra.cache, extraWriteVerbs: [] }) });

describe("Aprofundador", () => {
  it("abre aba e modal de leitura, fotografa cada subestado e recusa sugestões de escrita", async () => {
    const p = provider();
    const r = await explore(opts(hookWith(p)));
    const team = r.screens.find((s) => s.routePattern === "/team")!;
    expect(team.states.map((s) => s.label)).toEqual(["aba Convites", "Ver detalhes"]);
    for (const st of team.states) expect(existsSync(join((r as any).outDirForTest ?? "", st.screenshot)) || st.screenshot.endsWith(".jpg")).toBe(true);
    const blocked = r.blocked.filter((b) => b.layer === "element").map((b) => b.element);
    expect(blocked.join(" ")).toContain("Convidar usuário");
    expect(blocked.join(" ")).toContain("Excluir projeto");
    expect(saas.writes.filter((w) => w.path !== "/login")).toEqual([]);
  }, 180_000);

  it("os screenshots de subestado existem em img/", async () => {
    const o = opts(hookWith(provider()));
    const r = await explore(o);
    const team = r.screens.find((s) => s.routePattern === "/team")!;
    for (const st of team.states) expect(existsSync(join(o.outDir, st.screenshot))).toBe(true);
  }, 180_000);

  it("a lista do modelo fica em cache: a segunda execução não chama o LLM para aprofundar", async () => {
    const cache = new DiskCache(tmp());
    const p1 = provider();
    await explore(opts(hookWith(p1, { cache })));
    const first = p1.calls.filter((c) => c.task === "deepen").length;
    expect(first).toBeGreaterThan(3);
    const p2 = provider();
    await explore(opts(hookWith(p2, { cache })));
    expect(p2.calls.filter((c) => c.task === "deepen")).toHaveLength(0);
  }, 240_000);

  it("o prompt trata a página como dado não confiável e traz o snapshot", async () => {
    const p = provider();
    await explore(opts(hookWith(p), { limits: { maxScreens: 2, maxDepth: 1, timeBudgetMs: 60_000, examplesPerRoute: 1 } }));
    const call = p.calls.find((c) => c.task === "deepen")!;
    expect(call.system).toMatch(/não confiável/i);
    expect(call.system).toMatch(/SOMENTE LEITURA/);
    expect(call.prompt).toContain("<pagina-nao-confiavel>");
    expect(call.prompt).toMatch(/navigation|link|heading/);
  }, 120_000);

  it("elemento sugerido que não existe é ignorado sem derrubar a exploração", async () => {
    const r = await explore(opts(hookWith(provider({ deepen: () => ({ elements: [{ role: "tab", name: "Aba Fantasma", reason: "x" }] }) })), { limits: { maxScreens: 3, maxDepth: 1, timeBudgetMs: 60_000, examplesPerRoute: 1 } }));
    expect(r.screens.length).toBe(3);
    expect(r.screens.every((s) => s.states.length === 0)).toBe(true);
  }, 120_000);
});

describe("análise de UX", () => {
  const ux = {
    findings: [
      { title: "Rótulo ambíguo", description: "O botão 'Ver detalhes' não diz o que mostra.", severity: "high", evidence: "Botão 'Ver detalhes' ao lado de 'Convidar usuário'", confidence: 0.7 },
      { title: "Sem evidência", description: "Parece estranho", severity: "low", evidence: "  ", confidence: 0.9 },
    ],
  };
  it("evidência obrigatória; achado de UX vira opinião do agente com gravidade limitada a média", async () => {
    const p = provider({ ux });
    const r = await explore(opts(hookWith(p, { ux: true }), { limits: { maxScreens: 3, maxDepth: 1, timeBudgetMs: 60_000, examplesPerRoute: 1 } }));
    const uxs = r.findings.filter((f) => f.category === "ux");
    expect(uxs.length).toBeGreaterThan(0);
    expect(uxs.every((f) => f.origin === "agent")).toBe(true);
    expect(uxs.every((f) => f.severity !== "high" && f.severity !== "critical")).toBe(true);
    expect(uxs.some((f) => /Sem evidência/.test(f.title))).toBe(false);
    expect(uxs[0].confidence).toBeCloseTo(0.7);
  }, 120_000);

  it("manda screenshot mascarado e texto redigido ao modelo, no máximo 5 achados por tela", async () => {
    const many = { findings: Array.from({ length: 8 }, (_, i) => ({ title: `Problema ${"abcdefgh"[i]}`, description: "d", severity: "low", evidence: `trecho visível ${i}`, confidence: 0.5 + i / 100 })) };
    const p = provider({ ux: many });
    const r = await explore(opts(hookWith(p, { ux: true }), { limits: { maxScreens: 1, maxDepth: 0, timeBudgetMs: 60_000, examplesPerRoute: 1 } }));
    const call = p.calls.find((c) => c.task === "ux")!;
    expect(call.images).toHaveLength(1);
    expect(call.images![0].mediaType).toBe("image/jpeg");
    expect(call.prompt).toContain("<tela-nao-confiavel>");
    expect(r.findings.filter((f) => f.category === "ux")).toHaveLength(5);
  }, 120_000);

  it("sem a opção ux, nenhuma chamada de UX é feita", async () => {
    const p = provider({ ux });
    await explore(opts(hookWith(p, { ux: false }), { limits: { maxScreens: 2, maxDepth: 1, timeBudgetMs: 60_000, examplesPerRoute: 1 } }));
    expect(p.calls.filter((c) => c.task === "ux")).toHaveLength(0);
  }, 120_000);
});

describe("LLM indisponível", () => {
  it("falha do provedor não derruba a exploração e vira nota de cobertura", async () => {
    const broken = new FakeLLMProvider(() => { throw new Error("rede caiu"); });
    const r = await explore(opts(hookWith(broken, { ux: true }), { limits: { maxScreens: 3, maxDepth: 1, timeBudgetMs: 60_000, examplesPerRoute: 1 } }));
    expect(r.screens).toHaveLength(3);
    expect(r.llm.notes.join(" ")).toMatch(/rede caiu|indispon/i);
  }, 120_000);

  it("orçamento esgotado: segue só com análises objetivas e avisa uma vez", async () => {
    const p = new BudgetedProvider(provider(), 2);
    const r = await explore(opts(hookWith(p, { ux: true }), { limits: { maxScreens: 5, maxDepth: 1, timeBudgetMs: 60_000, examplesPerRoute: 1 } }));
    expect(r.screens).toHaveLength(5);
    expect(r.llm.notes.filter((n) => /orçamento/i.test(n))).toHaveLength(1);
    expect(r.llm.calls).toBeGreaterThan(0);
  }, 120_000);
});
