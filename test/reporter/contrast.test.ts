import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { contrastRatio, parseTokens } from "../../src/reporter/contrast.js";

const css = readFileSync("src/reporter/tokens.css", "utf8");
const { light, dark } = parseTokens(css);

describe("contrastRatio", () => {
  it("preto sobre branco ≈ 21", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 0);
  });
  it("aceita hex de 3 dígitos", () => {
    expect(contrastRatio("#000", "#fff")).toBeCloseTo(21, 0);
  });
});

const STATUSES = ["pass", "fail", "review", "blocked", "healed"];
const themes = { claro: light, escuro: dark } as const;

describe.each(Object.entries(themes))("tokens (%s)", (_name, t) => {
  it("define a paleta completa", () => {
    for (const k of ["bg", "surface", "text", "muted", "link", "header-bg", "header-fg"]) expect(t[k], k).toBeDefined();
    for (const s of STATUSES) {
      expect(t[`status-${s}-fg`], s).toBeDefined();
      expect(t[`status-${s}-bg`], s).toBeDefined();
    }
  });
  it("texto padrão sobre fundo e superfície tem razão ≥ 4.5", () => {
    expect(contrastRatio(t["text"], t["bg"])).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(t["text"], t["surface"])).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(t["muted"], t["bg"])).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(t["link"], t["bg"])).toBeGreaterThanOrEqual(4.5);
  });
  it("cabeçalho tem razão ≥ 4.5", () => {
    expect(contrastRatio(t["header-fg"], t["header-bg"])).toBeGreaterThanOrEqual(4.5);
  });
  it.each(STATUSES)("selo de status %s tem razão ≥ 4.5", (s) => {
    expect(contrastRatio(t[`status-${s}-fg`], t[`status-${s}-bg`])).toBeGreaterThanOrEqual(4.5);
  });
});

describe("marca", () => {
  it("o azul-marinho do cabeçalho é o token aproximado da Bayer (#10384F)", () => {
    expect(light["header-bg"].toLowerCase()).toBe("#10384f");
  });
});
