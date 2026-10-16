import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startTestApp } from "../app/server.js";
import { click, compiled, scriptedProvider, type Rule } from "../support/scripted-provider.js";
import { LOGIN_RULES } from "../support/login-rules.js";
import { writeXlsx } from "../support/xlsx.js";
import { loadConfig } from "../../src/config/index.js";
import { runAll } from "../../src/run/run-all.js";
import { ManifestWriter } from "../../src/run/manifest.js";
import { main, type CliIO } from "../../src/cli/index.js";

let app: { url: string; close(): Promise<void> };
beforeAll(async () => {
  app = await startTestApp();
});
afterAll(async () => {
  await app.close();
});

const ENV = { APP_USER: "standard_user", APP_PASS: "secret_sauce" };
const login = (id: string) => [
  [id, id, 1, "Acessar a página inicial do sistema", null, null],
  [id, id, 2, "Preencher o campo de usuário", "{{APP_USER}}", null],
  [id, id, 3, "Preencher o campo de senha", "{{APP_PASS}}", null],
  [id, id, 4, "Clicar no botão Login", null, null],
  [id, id, 5, "Verificar que a lista de produtos é exibida", null, "Products"],
];
const SSO: Rule = {
  match: /Abrir portal SSO/,
  response: compiled([{ kind: "goto", url: "/sso-login.html", description: "ir ao SSO" }]),
};

async function setup(rows: Array<Array<string | number | null>>, loginUrlPattern?: string) {
  const xlsx = await writeXlsx(rows);
  const cfg = await loadConfig({
    configPath: "/nao/existe.yaml",
    overrides: { baseUrl: app.url, stepTimeoutMs: 1500, ...(loginUrlPattern ? { loginUrlPattern } : {}) },
  });
  const runsDir = mkdtempSync(join(tmpdir(), "qa-runs-"));
  return { xlsx, cfg, runsDir, cacheDir: join(runsDir, "cache") };
}

describe("resume e sessão expirada", () => {
  it("resume pula casos já presentes e executa só os restantes, no mesmo runId", async () => {
    const s = await setup([...login("A"), ...login("B")]);
    const first = await runAll({ ...s, provider: scriptedProvider(LOGIN_RULES), env: ENV, only: "A" });
    expect(first.verdicts.map((v) => v.caseId)).toEqual(["A"]);
    const provider = scriptedProvider(LOGIN_RULES);
    const second = await runAll({ ...s, provider, env: ENV, resume: first.runId });
    expect(second.runId).toBe(first.runId);
    expect(second.verdicts.map((v) => v.caseId)).toEqual(["A", "B"]);
    expect(second.verdicts[0]).toEqual(first.verdicts[0]);
  });

  it("sessão expirada no meio do run: aborted preenchido, caso afetado sem veredito, anteriores preservados, seguintes não rodam", async () => {
    const rows = [
      ...login("A"),
      ["B", "B", 1, "Abrir portal SSO", null, null],
      ...login("C"),
    ];
    const s = await setup(rows, "sso-login");
    const provider = scriptedProvider([SSO, ...LOGIN_RULES]);
    const m = await runAll({ ...s, provider, env: ENV });
    expect(m.verdicts.map((v) => v.caseId)).toEqual(["A"]);
    expect(m.verdicts.some((v) => v.status === "fail")).toBe(false);
    expect(m.aborted).toMatch(/Sessão SSO expirada/);
    const onDisk = await ManifestWriter.load(join(s.runsDir, m.runId));
    expect(onDisk.aborted).toBe(m.aborted);
  });

  it("CLI: sessão expirada sai com código 3 e mensagem", async () => {
    const rows = [["B", "B", 1, "Abrir portal SSO", null, null]];
    const s = await setup(rows);
    const cfgPath = join(mkdtempSync(join(tmpdir(), "qa-cfg-")), "c.yaml");
    writeFileSync(cfgPath, "loginUrlPattern: 'sso-login'\n");
    const err: string[] = [];
    const io: CliIO = { out: () => {}, err: (x) => err.push(x), env: ENV, provider: scriptedProvider([SSO]), runsDir: s.runsDir };
    const code = await main(["run", s.xlsx, "--base-url", app.url, "--config", cfgPath], io);
    expect(code).toBe(3);
    expect(err.join("\n")).toContain("Sessão SSO expirada");
  });

  it("CLI: resume de runId inexistente sai 2 com mensagem", async () => {
    const s = await setup(login("A"));
    const err: string[] = [];
    const io: CliIO = { out: () => {}, err: (x) => err.push(x), env: ENV, provider: scriptedProvider(LOGIN_RULES), runsDir: s.runsDir };
    const code = await main(["run", s.xlsx, "--base-url", app.url, "--resume", "nao-existe"], io);
    expect(code).toBe(2);
    expect(err.join("\n")).toContain("run não encontrado: nao-existe");
  });
});
