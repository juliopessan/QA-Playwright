import { describe, it, expect } from "vitest";
import { readTestCases } from "../../src/reader/index.js";
import { loadConfig } from "../../src/config/index.js";
import { writeXlsx } from "../support/xlsx.js";

const FIXTURE = "fixtures/casos-sinteticos.xlsx";
const cfgP = () => loadConfig({ configPath: "/nao/existe.yaml" });

describe("readTestCases", () => {
  it("fixture: 12 casos e 80 passos", async () => {
    const { cases, issues } = await readTestCases(FIXTURE, await cfgP());
    expect(cases).toHaveLength(12);
    expect(cases.reduce((n, c) => n + c.steps.length, 0)).toBe(80);
    expect(issues).toEqual([]);
  });

  it("TC-007 tem 11 passos e o último tem expected 'Aparece Thank you for your order!'", async () => {
    const { cases } = await readTestCases(FIXTURE, await cfgP());
    const tc = cases.find((c) => c.id === "TC-007")!;
    expect(tc.steps).toHaveLength(11);
    expect(tc.steps.at(-1)!.expected).toBe("Aparece 'Thank you for your order!'");
    expect(tc.title).toBe("Checkout completo de um produto");
  });

  it('ignora a coluna "Observação (sintético)"', async () => {
    const { cases } = await readTestCases(FIXTURE, await cfgP());
    expect(JSON.stringify(cases)).not.toContain("Esperado: PASS");
  });

  it("agrupa por ID e ordena por Passo nº quando as linhas vêm intercaladas", async () => {
    const p = await writeXlsx([
      ["A", "Caso A", 2, "segundo A", null, null],
      ["B", "Caso B", 1, "primeiro B", null, null],
      ["A", "Caso A", 1, "primeiro A", null, null],
    ]);
    const { cases, issues } = await readTestCases(p, await cfgP());
    expect(issues).toEqual([]);
    expect(cases.map((c) => c.id)).toEqual(["A", "B"]);
    expect(cases[0].steps.map((s) => s.text)).toEqual(["primeiro A", "segundo A"]);
  });

  it("linha sem Passo gera issue com row e marca o caso com readError", async () => {
    const p = await writeXlsx([
      ["A", "Caso A", 1, "ok", null, null],
      ["A", "Caso A", 2, null, null, null],
    ]);
    const { cases, issues } = await readTestCases(p, await cfgP());
    expect(issues).toHaveLength(1);
    expect(issues[0].row).toBe(3);
    expect(issues[0].caseId).toBe("A");
    expect(cases[0].readError).toMatch(/Passo/);
  });

  it("Passo nº duplicado gera issue", async () => {
    const p = await writeXlsx([
      ["A", "Caso A", 1, "um", null, null],
      ["A", "Caso A", 1, "outro um", null, null],
    ]);
    const { cases, issues } = await readTestCases(p, await cfgP());
    expect(issues.some((i) => /duplicado/i.test(i.message))).toBe(true);
    expect(cases[0].readError).toBeDefined();
  });

  it("linha sem ID gera issue e não cria caso", async () => {
    const p = await writeXlsx([
      ["A", "Caso A", 1, "um", null, null],
      [null, "órfã", 1, "sem id", null, null],
    ]);
    const { cases, issues } = await readTestCases(p, await cfgP());
    expect(cases).toHaveLength(1);
    expect(issues[0].message).toMatch(/ID/);
  });

  it("arquivo sem aba Casos lança erro", async () => {
    const p = await writeXlsx([], { sheet: "Outra" });
    await expect(readTestCases(p, await cfgP())).rejects.toThrow("aba 'Casos' não encontrada");
  });

  it("aba Casos vazia lança erro", async () => {
    const p = await writeXlsx([]);
    await expect(readTestCases(p, await cfgP())).rejects.toThrow("nenhum caso encontrado");
  });

  it("cabeçalho sem coluna obrigatória lança erro listando as ausentes", async () => {
    const p = await writeXlsx([["A", "x", 1]], { headers: ["ID", "Título", "Passo nº"] });
    await expect(readTestCases(p, await cfgP())).rejects.toThrow(/Passo.*Dados|colunas ausentes/);
  });
});
