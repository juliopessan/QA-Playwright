import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startSaas, SAAS_USER, SAAS_PASS } from "../saas/server.js";
import { explore, type ExploreOptions } from "../../src/explore/crawler.js";
import type { ExploreResult } from "../../src/explore/types.js";

let saas: Awaited<ReturnType<typeof startSaas>>;
let result: ExploreResult;
let outDir: string;

const opts = (over: Partial<ExploreOptions> = {}): ExploreOptions => ({
  baseUrl: saas.url,
  user: SAAS_USER,
  pass: SAAS_PASS,
  outDir,
  limits: { maxScreens: 80, maxDepth: 4, timeBudgetMs: 120_000, examplesPerRoute: 3 },
  ignoreUrls: [],
  extraWriteVerbs: [],
  postAllowed: [],
  perf: { lcpMs: 600, cls: 0.1, loadMs: 5000 },
  ...over,
});

beforeAll(async () => {
  saas = await startSaas(0, { slowMs: 900 });
  outDir = mkdtempSync(join(tmpdir(), "qa-explore-"));
  result = await explore(opts());
}, 180_000);
afterAll(async () => {
  await saas.close();
});

const patterns = () => result.screens.map((s) => s.routePattern);

describe("explore (SaaS sintético)", () => {
  it("descobre as telas do menu e as telas ligadas a elas", () => {
    for (const p of ["/dashboard", "/projects", "/projects/:id", "/team", "/billing", "/reports", "/settings", "/help"]) {
      expect(patterns(), p).toContain(p);
    }
  });

  it("telas com o mesmo padrão de rota viram uma tela com até 3 exemplos", () => {
    const projetos = result.screens.filter((s) => s.routePattern === "/projects/:id");
    expect(projetos).toHaveLength(1);
    expect(projetos[0].exampleUrls.length).toBeLessThanOrEqual(3);
    expect(projetos[0].exampleUrls.length).toBeGreaterThanOrEqual(2);
  });

  it("não visita logout, links externos nem a URL destrutiva", () => {
    expect(patterns()).not.toContain("/logout");
    expect(saas.visited).not.toContain("/logout");
    expect(saas.visited).not.toContain("/settings/delete-account");
    expect(result.skipped.some((s) => s.url.includes("external.example"))).toBe(true);
  });

  it("link com rótulo de escrita vira bloqueio de elemento registrado", () => {
    const b = result.blocked.find((x) => x.layer === "element" && /Excluir conta/.test(x.element ?? ""));
    expect(b).toBeDefined();
    expect(b!.screenId).toBe("settings");
  });

  it("gera screenshot JPEG de cada tela e o caminho de navegação", () => {
    for (const s of result.screens) {
      expect(s.screenshot, s.routePattern).toMatch(/^img\/.+\.jpg$/);
      expect(existsSync(join(outDir, s.screenshot!))).toBe(true);
      expect(s.path.length).toBeGreaterThan(0);
    }
    const team = result.screens.find((s) => s.routePattern === "/team")!;
    expect(team.path[0]).toBe("Início");
    expect(team.heading).toBe("Equipe");
  });

  it("registra o mapa de navegação (arestas entre telas)", () => {
    expect(result.edges.length).toBeGreaterThan(5);
    expect(result.edges).toContainEqual(["dashboard", "projects"]);
  });

  it("achados plantados: HTTP 500, axe, desempenho, 404 e exceção JS (deduplicada)", () => {
    const text = (f: { title: string; rule: string }) => `${f.title} ${f.rule}`;
    const by = (re: RegExp) => result.findings.filter((f) => re.test(text(f)));
    expect(by(/HTTP 500/).length).toBeGreaterThan(0);
    expect(by(/image-alt/).length).toBeGreaterThan(0);
    expect(by(/lcp acima/i).some((f) => f.screenIds.includes("reports"))).toBe(true);
    expect(by(/HTTP 404/).some((f) => f.screenIds.includes("help"))).toBe(true);
    const ex = by(/undefinedhelper/i);
    expect(ex).toHaveLength(1);
    expect(ex[0].screenIds.length).toBeGreaterThanOrEqual(2);
  });

  it("a exploração é somente leitura: nenhuma escrita chegou ao servidor (exceto o login)", () => {
    expect(saas.writes.filter((w) => w.path !== "/login")).toEqual([]);
  });

  it("dados da execução: runId, base e horário", () => {
    expect(result.baseUrl).toBe(saas.url);
    expect(result.startedAt).toMatch(/^\d{4}-/);
    expect(result.finishedAt).toBeDefined();
    expect(result.limitsHit).toEqual([]);
  });
});

describe("explore: limites e falhas", () => {
  it("maxScreens interrompe a exploração e registra o limite", async () => {
    const r = await explore(opts({ outDir: mkdtempSync(join(tmpdir(), "qa-explore-")), limits: { maxScreens: 3, maxDepth: 4, timeBudgetMs: 60_000, examplesPerRoute: 3 } }));
    expect(r.screens).toHaveLength(3);
    expect(r.limitsHit).toContain("maxScreens");
  }, 120_000);

  it("maxDepth 0 visita só a tela inicial", async () => {
    const r = await explore(opts({ outDir: mkdtempSync(join(tmpdir(), "qa-explore-")), limits: { maxScreens: 80, maxDepth: 0, timeBudgetMs: 60_000, examplesPerRoute: 3 } }));
    expect(r.screens).toHaveLength(1);
  }, 120_000);

  it("ignorarUrls exclui telas por trecho de caminho", async () => {
    const r = await explore(opts({ outDir: mkdtempSync(join(tmpdir(), "qa-explore-")), ignoreUrls: ["/billing", "/reports"], limits: { maxScreens: 80, maxDepth: 2, timeBudgetMs: 60_000, examplesPerRoute: 1 } }));
    expect(r.screens.map((s) => s.routePattern)).not.toContain("/billing");
    expect(r.skipped.some((s) => /ignorarUrls/.test(s.reason))).toBe(true);
  }, 120_000);

  it("credenciais erradas: erro claro", async () => {
    await expect(explore(opts({ pass: "errada", outDir: mkdtempSync(join(tmpdir(), "qa-explore-")) }))).rejects.toThrow(/Login falhou/);
  }, 60_000);
});
