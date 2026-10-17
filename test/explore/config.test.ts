import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadExploreConfig } from "../../src/explore/config.js";

const yaml = (txt: string) => {
  const f = join(mkdtempSync(join(tmpdir(), "qa-xc-")), "c.yaml");
  writeFileSync(f, txt);
  return f;
};

describe("loadExploreConfig", () => {
  it("padrões quando não há arquivo", () => {
    const c = loadExploreConfig("/nao/existe.yaml");
    expect(c.limits).toEqual({ maxScreens: 80, maxDepth: 4, timeBudgetMs: 20 * 60_000, examplesPerRoute: 3 });
    expect(c.ux).toBe(true);
    expect(c.perf).toEqual({ lcpMs: 2500, cls: 0.1, loadMs: 5000 });
    expect(c.ignoreUrls).toEqual([]);
    expect(c.repo).toBeUndefined();
  });

  it("lê as seções explorar, analises e publicar (chaves em português)", () => {
    const c = loadExploreConfig(
      yaml(`explorar:
  maxTelas: 10
  maxProfundidade: 2
  tempoMaximoMin: 5
  exemplosPorRota: 1
  ignorarUrls: ["/logout", "/admin"]
  verbosEscrita: ["sincronizar"]
  postPermitidos: ["/api/search"]
  estabilidadeMs: 300
analises:
  ux: false
  limites: { lcpMs: 1800, cls: 0.05, carregamentoMs: 4000 }
publicar:
  repo: "acme/saas"
  rotulos: ["qa-agent", "ux"]
`),
    );
    expect(c.limits).toEqual({ maxScreens: 10, maxDepth: 2, timeBudgetMs: 300_000, examplesPerRoute: 1 });
    expect(c.ignoreUrls).toEqual(["/logout", "/admin"]);
    expect(c.extraWriteVerbs).toEqual(["sincronizar"]);
    expect(c.postAllowed).toEqual(["/api/search"]);
    expect(c.settleMs).toBe(300);
    expect(c.ux).toBe(false);
    expect(c.perf).toEqual({ lcpMs: 1800, cls: 0.05, loadMs: 4000 });
    expect(c.repo).toBe("acme/saas");
    expect(c.labels).toEqual(["qa-agent", "ux"]);
  });

  it("overrides da CLI vencem o arquivo", () => {
    const c = loadExploreConfig(yaml("explorar:\n  maxTelas: 10\nanalises:\n  ux: true\n"), { maxScreens: 3, ux: false });
    expect(c.limits.maxScreens).toBe(3);
    expect(c.ux).toBe(false);
  });

  it("valores inválidos caem no padrão em vez de quebrar", () => {
    const c = loadExploreConfig(yaml("explorar:\n  maxTelas: abc\n  maxProfundidade: -1\n"));
    expect(c.limits.maxScreens).toBe(80);
    expect(c.limits.maxDepth).toBe(4);
  });
});
