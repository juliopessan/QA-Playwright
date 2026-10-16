import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startTestApp } from "../app/server.js";
import { scriptedProvider } from "../support/scripted-provider.js";
import { LOGIN_RULES } from "../support/login-rules.js";
import { writeXlsx } from "../support/xlsx.js";
import { loadConfig } from "../../src/config/index.js";
import { runAll } from "../../src/run/run-all.js";
import { main, type CliIO } from "../../src/cli/index.js";

let app: { url: string; close(): Promise<void> };
beforeAll(async () => {
  app = await startTestApp();
});
afterAll(async () => {
  await app.close();
});

const LOGIN_ROWS = (id: string) => [
  [id, "Login válido", 1, "Acessar a página inicial do sistema", null, null],
  [id, "Login válido", 2, "Preencher o campo de usuário", "{{APP_USER}}", null],
  [id, "Login válido", 3, "Preencher o campo de senha", "{{APP_PASS}}", null],
  [id, "Login válido", 4, "Clicar no botão Login", null, null],
  [id, "Login válido", 5, "Verificar que a lista de produtos é exibida", null, "Products"],
];
const ENV = { APP_USER: "standard_user", APP_PASS: "secret_sauce" };

async function setup(rows: Array<Array<string | number | null>>) {
  const xlsx = await writeXlsx(rows);
  const cfg = await loadConfig({ configPath: "/nao/existe.yaml", overrides: { baseUrl: app.url, stepTimeoutMs: 1500 } });
  const runsDir = mkdtempSync(join(tmpdir(), "qa-runs-"));
  return { xlsx, cfg, runsDir };
}

describe("runAll", () => {
  it("TC-001 com provider scriptado produz verdict pass e prints por passo", async () => {
    const { xlsx, cfg, runsDir } = await setup(LOGIN_ROWS("TC-001"));
    const provider = scriptedProvider(LOGIN_RULES);
    const m = await runAll({ xlsx, cfg, provider, env: ENV, runsDir, cacheDir: join(runsDir, "cache") });
    expect(m.verdicts).toHaveLength(1);
    expect(m.verdicts[0].status).toBe("pass");
    expect(m.verdicts[0].steps).toHaveLength(5);
    const runDir = join(runsDir, m.runId);
    expect(existsSync(join(runDir, m.verdicts[0].steps[0].screenshotBefore!))).toBe(true);
    expect(existsSync(join(runDir, "manifest.json"))).toBe(true);
    expect(m.usage.calls).toBe(provider.calls.length);
    expect(m.finishedAt).toBeDefined();
    expect(m.model).toBe("fake");
  });

  it("caso com readError vira blocked sem chamar o LLM", async () => {
    const rows = [...LOGIN_ROWS("TC-A"), ["TC-A", "Login válido", 6, null, null, null]];
    const { xlsx, cfg, runsDir } = await setup(rows);
    const provider = scriptedProvider(LOGIN_RULES);
    const m = await runAll({ xlsx, cfg, provider, env: ENV, runsDir, cacheDir: join(runsDir, "cache") });
    expect(m.verdicts[0].status).toBe("blocked");
    expect(m.verdicts[0].reasoning).toMatch(/Passo/);
    expect(provider.calls).toHaveLength(0);
    expect(m.issues).toHaveLength(1);
  });

  it("--only executa só o caso pedido", async () => {
    const { xlsx, cfg, runsDir } = await setup([...LOGIN_ROWS("A"), ...LOGIN_ROWS("B")]);
    const m = await runAll({ xlsx, cfg, provider: scriptedProvider(LOGIN_RULES), env: ENV, runsDir, only: "B", cacheDir: join(runsDir, "cache") });
    expect(m.verdicts.map((v) => v.caseId)).toEqual(["B"]);
  });

  it("dois runs têm runIds e pastas distintas", async () => {
    const { xlsx, cfg, runsDir } = await setup(LOGIN_ROWS("A"));
    const opts = { xlsx, cfg, provider: scriptedProvider(LOGIN_RULES), env: ENV, runsDir, cacheDir: join(runsDir, "cache") };
    const a = await runAll(opts);
    const b = await runAll({ ...opts, provider: scriptedProvider(LOGIN_RULES) });
    expect(a.runId).not.toBe(b.runId);
  });

  it("CLI: run completo contra o app local sai 0 e imprime o resumo", async () => {
    const { xlsx, runsDir } = await setup(LOGIN_ROWS("TC-001"));
    const out: string[] = [];
    const err: string[] = [];
    const io: CliIO = { out: (s) => out.push(s), err: (s) => err.push(s), env: ENV, provider: scriptedProvider(LOGIN_RULES), runsDir };
    const code = await main(["run", xlsx, "--base-url", app.url], io);
    expect(err.join("\n")).toBe("");
    expect(code).toBe(0);
    expect(out.join("\n")).toMatch(/1 aprovado/);
  });
});
