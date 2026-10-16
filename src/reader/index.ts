import ExcelJS from "exceljs";
import type { AppConfig } from "../config/index.js";
import type { ReadIssue, Step, TestCase } from "../types/index.js";

const SHEET = "Casos";

const cellText = (c: ExcelJS.Cell): string => (c.text ?? "").toString().trim();

export async function readTestCases(
  xlsxPath: string,
  cfg: AppConfig,
): Promise<{ cases: TestCase[]; issues: ReadIssue[] }> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(xlsxPath);
  const ws = wb.getWorksheet(SHEET);
  if (!ws) throw new Error(`aba '${SHEET}' não encontrada em ${xlsxPath}`);

  const wanted = cfg.columns;
  const header = new Map<string, number>();
  ws.getRow(1).eachCell((c, col) => header.set(cellText(c), col));
  const missing = Object.values(wanted).filter((name) => !header.has(name));
  if (missing.length) throw new Error(`colunas ausentes na aba '${SHEET}': ${missing.join(", ")}`);
  const col = {
    id: header.get(wanted.id)!,
    title: header.get(wanted.title)!,
    stepNo: header.get(wanted.stepNo)!,
    step: header.get(wanted.step)!,
    data: header.get(wanted.data)!,
    expected: header.get(wanted.expected)!,
  };

  const issues: ReadIssue[] = [];
  const byId = new Map<string, { title: string; steps: Step[]; errors: string[] }>();

  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const id = cellText(row.getCell(col.id));
    const title = cellText(row.getCell(col.title));
    const stepNoRaw = cellText(row.getCell(col.stepNo));
    const text = cellText(row.getCell(col.step));
    const data = cellText(row.getCell(col.data));
    const expected = cellText(row.getCell(col.expected));
    if (!id && !title && !stepNoRaw && !text && !data && !expected) return; // linha vazia

    if (!id) {
      issues.push({ row: rowNumber, message: "ID ausente: linha ignorada" });
      return;
    }
    const entry = byId.get(id) ?? { title: "", steps: [], errors: [] };
    byId.set(id, entry);
    if (title && !entry.title) entry.title = title;

    const fail = (message: string) => {
      issues.push({ row: rowNumber, caseId: id, message });
      entry.errors.push(`linha ${rowNumber}: ${message}`);
    };

    const n = Number(stepNoRaw);
    if (!stepNoRaw || !Number.isInteger(n) || n < 1) return fail(`Passo nº inválido ('${stepNoRaw}')`);
    if (!text) return fail("Passo ausente");
    if (entry.steps.some((s) => s.index === n)) return fail(`Passo nº ${n} duplicado`);
    entry.steps.push({
      index: n,
      text,
      ...(data ? { data } : {}),
      ...(expected ? { expected } : {}),
    });
  });

  const cases: TestCase[] = [...byId.entries()].map(([id, e]) => ({
    id,
    title: e.title || id,
    steps: e.steps.sort((a, b) => a.index - b.index),
    ...(e.errors.length ? { readError: e.errors.join("; ") } : {}),
  }));
  if (cases.length === 0) throw new Error(`nenhum caso encontrado na aba '${SHEET}'`);
  return { cases, issues };
}
