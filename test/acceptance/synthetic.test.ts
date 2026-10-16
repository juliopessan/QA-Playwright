import { describe, it, expect, beforeAll, afterAll } from "vitest";
import ExcelJS from "exceljs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startTestApp } from "../app/server.js";
import { syntheticProvider } from "../support/synthetic-rules.js";
import { loadConfig } from "../../src/config/index.js";
import { runAll } from "../../src/run/run-all.js";
import type { RunManifest } from "../../src/types/index.js";

const FIXTURE = "fixtures/casos-sinteticos.xlsx";
let app: { url: string; close(): Promise<void> };
let manifest: RunManifest;
let expectedByCase: Map<string, string>;

beforeAll(async () => {
  app = await startTestApp();

  // O veredito esperado vem da coluna "Observação (sintético)" do próprio fixture.
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(FIXTURE);
  const ws = wb.getWorksheet("Casos")!;
  expectedByCase = new Map();
  ws.eachRow((row, n) => {
    if (n === 1) return;
    const obs = String(row.getCell(7).value ?? "");
    const m = /Esperado:\s*(PASS|FAIL|NEEDS-REVIEW)/.exec(obs);
    if (m) expectedByCase.set(String(row.getCell(1).value), m[1].toLowerCase());
  });

  const cfg = await loadConfig({
    configPath: "/nao/existe.yaml",
    excelPath: FIXTURE,
    overrides: { baseUrl: app.url, stepTimeoutMs: 2000 },
  });
  const runsDir = mkdtempSync(join(tmpdir(), "qa-acc-"));
  manifest = await runAll({
    xlsx: FIXTURE,
    cfg,
    provider: syntheticProvider(),
    env: { APP_USER: "standard_user", APP_PASS: "secret_sauce", LOCKED_USER: "locked_out_user" },
    runsDir,
    cacheDir: join(runsDir, "cache"),
  });
}, 240_000);

afterAll(async () => {
  await app.close();
});

describe("aceitação: Excel sintético contra o app local", () => {
  it("o fixture declara um veredito esperado para os 12 casos", () => {
    expect(expectedByCase.size).toBe(12);
  });

  it("cada veredito bate com a coluna 'Observação (sintético)'", () => {
    const got = new Map(manifest.verdicts.map((v) => [v.caseId, v.status as string]));
    for (const [id, want] of expectedByCase) expect({ id, status: got.get(id) }).toEqual({ id, status: want });
  });

  it("TC-011: o passo que falha é o 5 e o 6 fica skipped", () => {
    const v = manifest.verdicts.find((x) => x.caseId === "TC-011")!;
    expect(v.steps.map((s) => s.status).slice(4)).toEqual(["fail", "skipped"]);
  });

  it("TC-010: falha na verificação do total, com valor observado no erro", () => {
    const v = manifest.verdicts.find((x) => x.caseId === "TC-010")!;
    const failed = v.steps.find((s) => s.status === "fail")!;
    expect(failed.error).toContain("Total: $99.99");
  });

  it("TC-009: needs-review vem do Judge sem evidência objetiva", () => {
    const v = manifest.verdicts.find((x) => x.caseId === "TC-009")!;
    expect(v.reasoning).toMatch(/Judge/);
  });

  it("nenhuma senha aparece no manifest", () => {
    expect(JSON.stringify(manifest)).not.toContain("secret_sauce");
    expect(JSON.stringify(manifest)).not.toContain("senha-errada-123");
  });

  it("nenhum caso foi resolvido por autocorreção (não há healer nesta fase)", () => {
    expect(manifest.verdicts.flatMap((v) => v.steps).filter((s) => s.status === "healed")).toHaveLength(0);
  });
});
