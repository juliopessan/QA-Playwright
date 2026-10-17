import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeDocs } from "../../src/docs/markdown.js";
import { parseApprovals } from "../../src/docs/approvals.js";
import { makeFinding } from "../../src/explore/findings.js";
import type { ExploreResult, Finding, Screen } from "../../src/explore/types.js";

const screen = (id: string, pattern: string, heading: string, extra: Partial<Screen> = {}): Screen => ({
  id, routePattern: pattern, title: heading, heading, exampleUrls: [`http://x${pattern.replace(":id", "1")}`], path: ["Início", heading],
  screenshot: `img/${id}.jpg`, states: [], ...extra,
});
const f = (over: Partial<Parameters<typeof makeFinding>[0]> & { rule: string }): Finding =>
  makeFinding({ category: "technical", severity: "high", origin: "measured", title: "Erro 500", description: "A API falhou.", scope: "screen", screenId: "billing", evidence: ["GET /api/x → 500"], reproduction: ["Início", "Faturas"], ...over });

function result(over: Partial<ExploreResult> = {}): ExploreResult {
  return {
    runId: "20261017-101010-abcd", baseUrl: "http://x", startedAt: "2026-10-17T10:10:10.000Z", finishedAt: "2026-10-17T10:12:00.000Z",
    screens: [
      screen("dashboard", "/dashboard", "Painel", { states: [{ label: "aba Convites", screenshot: "img/dashboard-aba-convites.jpg" }] }),
      screen("billing", "/billing", 'Faturas "2026" [beta]'),
    ],
    edges: [["dashboard", "billing"]],
    findings: [
      f({ rule: "http 500", severity: "high" }),
      f({ rule: "axe:image-alt", category: "accessibility", severity: "critical", title: "Imagem sem alt", scope: "global", screenId: "dashboard" }),
      f({ rule: "ux confuso", category: "ux", severity: "low", origin: "agent", title: "Rótulo ambíguo", screenId: "dashboard", confidence: 0.6 }),
    ],
    blocked: [{ layer: "network", reason: "POST fora de postPermitidos", method: "POST", url: "http://x/api/delete", screenId: "dashboard" },
              { layer: "element", reason: "rótulo de escrita", element: 'botão "Excluir | tudo"', screenId: "billing" }],
    limitsHit: ["maxScreens"], skipped: [{ url: "http://ext/x", reason: "link externo" }],
    llm: { calls: 4, inputTokens: 1000, outputTokens: 200, notes: ["UX não analisada em /x: LLM indisponível"] },
    ...over,
  };
}
const out = () => mkdtempSync(join(tmpdir(), "qa-docs-"));
const read = (d: string, p: string) => readFileSync(join(d, p), "utf8");

describe("writeDocs", () => {
  it("gera a estrutura de arquivos", () => {
    const d = out();
    writeDocs(result(), d);
    for (const p of ["README.md", "achados.md", "mapa.md", "cobertura.md", "telas/dashboard.md", "telas/billing.md", "dados/achados.json", "dados/manifest.json"]) {
      expect(existsSync(join(d, p)), p).toBe(true);
    }
  });

  it("README: resumo por gravidade, principais achados com link e cobertura", () => {
    const d = out();
    writeDocs(result(), d);
    const md = read(d, "README.md");
    expect(md).toContain("20261017-101010-abcd");
    expect(md).toMatch(/Crítica\s*\|\s*1/);
    expect(md).toMatch(/Alta\s*\|\s*1/);
    expect(md).toMatch(/Baixa\s*\|\s*1/);
    expect(md).toContain("telas/dashboard.md#");
    expect(md).toMatch(/2 telas/);
    expect(md).toMatch(/maxScreens/);
  });

  it("README: seção 'o que mudou' só aparece com run anterior", () => {
    const a = out();
    writeDocs(result(), a);
    expect(read(a, "README.md")).not.toMatch(/O que mudou/);
    const prev = [f({ rule: "http 500" }), f({ rule: "antigo", title: "Já corrigido" })];
    const b = out();
    writeDocs(result(), b, { previous: prev });
    const md = read(b, "README.md");
    expect(md).toMatch(/O que mudou/);
    expect(md).toMatch(/Novos \(2\)/);
    expect(md).toMatch(/Persistentes \(1\)/);
    expect(md).toMatch(/Resolvidos \(1\)/);
    expect(md).toContain("Já corrigido");
  });

  it("achados.md: checkbox por achado, ordenado por gravidade, e parseApprovals lê só os marcados", () => {
    const d = out();
    const r = result();
    writeDocs(r, d);
    const md = read(d, "achados.md");
    const lines = md.split("\n").filter((l) => l.startsWith("- [ ]"));
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain("CRÍTICA");
    expect(lines[2]).toContain("BAIXA");
    expect(parseApprovals(md)).toEqual([]);
    const crit = r.findings.find((x) => x.severity === "critical")!;
    const approved = md.replace(new RegExp(`- \\[ \\](.*${crit.id})`), "- [x]$1");
    expect(parseApprovals(approved)).toEqual([crit.id]);
  });

  it("parseApprovals aceita [X] maiúsculo e ignora texto solto", () => {
    expect(parseApprovals("- [X] **ALTA** · t · `a3f9c1d2e4`\ntexto\n- [ ] **BAIXA** · u · `0123456789`")).toEqual(["a3f9c1d2e4"]);
  });

  it("página de tela: screenshot relativo, subestados, âncora do achado e evidências", () => {
    const d = out();
    const r = result();
    writeDocs(r, d);
    const md = read(d, "telas/dashboard.md");
    expect(md).toContain("![Painel](../img/dashboard.jpg)");
    expect(md).toContain("aba Convites");
    expect(md).toContain("../img/dashboard-aba-convites.jpg");
    const ax = r.findings.find((x) => x.rule === "axe:image-alt")!;
    expect(md).toContain(`<a id="${ax.id}"></a>`);
    expect(md).toContain("GET /api/x → 500");
    expect(md).toMatch(/opinião do agente/i);
  });

  it("achado global aparece em todas as telas afetadas", () => {
    const d = out();
    const r = result();
    const g = r.findings.find((x) => x.rule === "axe:image-alt")!;
    g.screenIds = ["dashboard", "billing"];
    writeDocs(r, d);
    expect(read(d, "telas/billing.md")).toContain(`<a id="${g.id}"></a>`);
  });

  it("mapa.md: Mermaid com nós e arestas, sem quebrar com aspas e colchetes no título", () => {
    const d = out();
    writeDocs(result(), d);
    const md = read(d, "mapa.md");
    expect(md).toContain("```mermaid");
    expect(md).toContain("graph LR");
    expect(md).toContain("dashboard --> billing");
    expect(md).not.toMatch(/\["Faturas "2026"/);
  });

  it("cobertura.md: bloqueios (com pipe escapado), limites, ignorados e notas do LLM", () => {
    const d = out();
    writeDocs(result(), d);
    const md = read(d, "cobertura.md");
    expect(md).toContain("POST fora de postPermitidos");
    expect(md).toContain("Excluir \\| tudo");
    expect(md).toContain("maxScreens");
    expect(md).toContain("link externo");
    expect(md).toContain("LLM indisponível");
  });

  it("dados/achados.json preserva o número da issue de um run anterior ao regravar", () => {
    const d = out();
    const r = result();
    writeDocs(r, d);
    const json = JSON.parse(read(d, "dados/achados.json")) as Finding[];
    expect(json).toHaveLength(3);
    expect(json[0]).toHaveProperty("id");
  });

  it("sem achados: documentos continuam válidos", () => {
    const d = out();
    writeDocs(result({ findings: [], blocked: [], limitsHit: [], skipped: [], llm: { calls: 0, inputTokens: 0, outputTokens: 0, notes: [] } }), d);
    expect(read(d, "README.md")).toMatch(/Nenhum achado/);
    expect(read(d, "achados.md")).toMatch(/Nenhum achado/);
  });

  it("não sobrescreve screenshots existentes na pasta img", () => {
    const d = out();
    mkdirSync(join(d, "img"), { recursive: true });
    writeFileSync(join(d, "img", "dashboard.jpg"), "x");
    writeDocs(result(), d);
    expect(readFileSync(join(d, "img", "dashboard.jpg"), "utf8")).toBe("x");
  });

  it("fluxos-objetivo ganham fluxos/<id>.md, tabela no README e entrada no manifest", () => {
    const d = mkdtempSync(join(tmpdir(), "qa-docs-"));
    writeDocs(
      result({
        flows: [{
          id: "convidar", title: "Convidar usuário", goal: "Convidar alguém.", success: "Convite enviado.", status: "pass",
          reasoning: "Aprovado pelo Judge: botão visível.", screenIds: ["dashboard"],
          steps: [{ stepIndex: 1, text: "Clicar em Convidar", status: "pass", durationMs: 1, screenshotBefore: "img/fluxos/convidar/01-antes.jpg", screenshotAfter: "img/fluxos/convidar/01-depois.jpg" }],
        }],
      }),
      d,
    );
    const page = readFileSync(join(d, "fluxos/convidar.md"), "utf8");
    expect(page).toContain("Aprovado pelo Judge");
    expect(page).toContain("../img/fluxos/convidar/01-depois.jpg");
    expect(page).toContain("../telas/dashboard.md");
    expect(readFileSync(join(d, "README.md"), "utf8")).toMatch(/Fluxos-objetivo[\s\S]*\[Convidar usuário\]\(fluxos\/convidar\.md\) \| Aprovado/);
    expect(JSON.parse(readFileSync(join(d, "dados/manifest.json"), "utf8")).flows).toEqual([{ id: "convidar", title: "Convidar usuário", status: "pass" }]);
  });

  it("sem fluxos não cria a pasta fluxos", () => {
    const d = mkdtempSync(join(tmpdir(), "qa-docs-"));
    writeDocs(result(), d);
    expect(existsSync(join(d, "fluxos"))).toBe(false);
  });
});
