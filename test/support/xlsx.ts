import ExcelJS from "exceljs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const HEADERS = ["ID", "Título", "Passo nº", "Passo", "Dados", "Resultado esperado"];

/** Grava um xlsx temporário com a aba Casos (ou outro nome) e devolve o caminho. */
export async function writeXlsx(
  rows: Array<Array<string | number | null>>,
  opts: { sheet?: string; headers?: string[] } = {},
): Promise<string> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(opts.sheet ?? "Casos");
  ws.addRow(opts.headers ?? HEADERS);
  for (const r of rows) ws.addRow(r);
  const dir = mkdtempSync(join(tmpdir(), "qa-xlsx-"));
  const p = join(dir, "casos.xlsx");
  await wb.xlsx.writeFile(p);
  return p;
}
