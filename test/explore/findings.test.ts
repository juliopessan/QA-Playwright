import { describe, it, expect } from "vitest";
import { makeFinding, dedupeFindings, compareRuns, maxSeverity } from "../../src/explore/findings.js";

const base = { category: "technical" as const, severity: "high" as const, origin: "measured" as const, title: "t", description: "d" };

describe("makeFinding", () => {
  it("mesmo problema mantém o mesmo id entre execuções", () => {
    const a = makeFinding({ ...base, rule: "HTTP 500 /api/faturas", scope: "screen", screenId: "billing" });
    const b = makeFinding({ ...base, rule: "HTTP 500 /api/faturas", scope: "screen", screenId: "billing" });
    expect(a.id).toBe(b.id);
    expect(a.id).toMatch(/^[0-9a-f]{10}$/);
  });
  it("ids mudam com categoria, tela (escopo screen) ou regra", () => {
    const a = makeFinding({ ...base, rule: "r", scope: "screen", screenId: "a" });
    expect(makeFinding({ ...base, category: "ux", rule: "r", scope: "screen", screenId: "a" }).id).not.toBe(a.id);
    expect(makeFinding({ ...base, rule: "r", scope: "screen", screenId: "b" }).id).not.toBe(a.id);
    expect(makeFinding({ ...base, rule: "outra", scope: "screen", screenId: "a" }).id).not.toBe(a.id);
  });
  it("escopo global ignora a tela no id", () => {
    const a = makeFinding({ ...base, rule: "TypeError x", scope: "global", screenId: "a" });
    const b = makeFinding({ ...base, rule: "TypeError x", scope: "global", screenId: "b" });
    expect(a.id).toBe(b.id);
  });
  it("normaliza números e UUIDs da regra (estável entre dados diferentes)", () => {
    const a = makeFinding({ ...base, rule: "HTTP 404 /api/projetos/123", scope: "global", screenId: "a" });
    const b = makeFinding({ ...base, rule: "HTTP 404 /api/projetos/987", scope: "global", screenId: "a" });
    expect(a.id).toBe(b.id);
  });
});

describe("dedupeFindings", () => {
  it("mesma regra global em 3 telas vira 1 achado com 3 telas", () => {
    const fs = ["a", "b", "c"].map((s) => makeFinding({ ...base, rule: "TypeError x", scope: "global", screenId: s, evidence: [`ev-${s}`] }));
    const out = dedupeFindings(fs);
    expect(out).toHaveLength(1);
    expect(out[0].screenIds).toEqual(["a", "b", "c"]);
    expect(out[0].evidence).toEqual(["ev-a", "ev-b", "ev-c"]);
  });
  it("mantém a maior gravidade e achados de tela distintos separados", () => {
    const a = makeFinding({ ...base, severity: "low", rule: "x", scope: "global", screenId: "a" });
    const b = makeFinding({ ...base, severity: "critical", rule: "x", scope: "global", screenId: "b" });
    const c = makeFinding({ ...base, rule: "y", scope: "screen", screenId: "a" });
    const out = dedupeFindings([a, b, c]);
    expect(out).toHaveLength(2);
    expect(out.find((f) => f.id === a.id)!.severity).toBe("critical");
  });
  it("maxSeverity ordena critical > high > medium > low", () => {
    expect(maxSeverity("low", "medium")).toBe("medium");
    expect(maxSeverity("critical", "high")).toBe("critical");
  });
});

describe("compareRuns", () => {
  it("classifica novo, persistente e resolvido", () => {
    const f = (r: string) => makeFinding({ ...base, rule: r, scope: "global", screenId: "a" });
    const [x, y, z] = [f("x"), f("y"), f("z")];
    const r = compareRuns([x, y], [y, z]);
    expect(r.new.map((i) => i.id)).toEqual([z.id]);
    expect(r.persistent.map((i) => i.id)).toEqual([y.id]);
    expect(r.resolved.map((i) => i.id)).toEqual([x.id]);
  });
  it("sem run anterior: tudo é novo", () => {
    const x = makeFinding({ ...base, rule: "x", scope: "global", screenId: "a" });
    expect(compareRuns(undefined, [x]).new).toHaveLength(1);
  });
});
