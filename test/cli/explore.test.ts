import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startSaas, SAAS_USER, SAAS_PASS } from "../saas/server.js";
import { main, type CliIO } from "../../src/cli/index.js";
import { FakeLLMProvider } from "../../src/llm/fake.js";

let saas: Awaited<ReturnType<typeof startSaas>>;
beforeAll(async () => {
  saas = await startSaas(0, { slowMs: 200 });
});
afterAll(async () => {
  await saas.close();
});

function io(env: Record<string, string | undefined> = { APP_USER: SAAS_USER, APP_PASS: SAAS_PASS }) {
  const out: string[] = [];
  const err: string[] = [];
  const cli: CliIO = { out: (s) => out.push(s), err: (s) => err.push(s), env };
  return { cli, out, err };
}
const FAST = ["--max-telas", "4", "--estabilidade-ms", "200", "--sem-ux", "--config", "/nao/existe.yaml", "--env-file", "/nao/existe.env"];

describe("qa-agent explore", () => {
  it("explora, gera a pasta qa-report/<runId> e imprime o resumo", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "qa-cli-"));
    const t = io();
    const code = await main(["explore", saas.url, "--out-dir", outDir, ...FAST], t.cli);
    expect(t.err.join("\n")).toBe("");
    expect(code).toBe(0);
    const text = t.out.join("\n");
    expect(text).toMatch(/4 telas/);
    expect(text).toMatch(/qa-report|README\.md/);
    const runId = /(\d{8}-\d{6}-[0-9a-f]{4})/.exec(text)![1];
    for (const p of ["README.md", "achados.md", "mapa.md", "cobertura.md", "dados/achados.json", "dados/manifest.json"]) {
      expect(existsSync(join(outDir, runId, p)), p).toBe(true);
    }
    expect(JSON.parse(readFileSync(join(outDir, runId, "dados/manifest.json"), "utf8")).runId).toBe(runId);
  }, 120_000);

  it("a segunda execução compara com a anterior ('o que mudou')", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "qa-cli-"));
    await main(["explore", saas.url, "--out-dir", outDir, ...FAST], io().cli);
    await new Promise((r) => setTimeout(r, 1100)); // runIds distintos (segundo)
    const t = io();
    await main(["explore", saas.url, "--out-dir", outDir, ...FAST], t.cli);
    const runId = /(\d{8}-\d{6}-[0-9a-f]{4})/.exec(t.out.join("\n"))![1];
    expect(readFileSync(join(outDir, runId, "README.md"), "utf8")).toMatch(/O que mudou/);
  }, 180_000);

  it("sem credenciais e sem sessão salva sai com 2 e orienta", async () => {
    const t = io({});
    const code = await main(["explore", saas.url, "--out-dir", mkdtempSync(join(tmpdir(), "qa-cli-")), ...FAST], t.cli);
    expect(code).toBe(2);
    expect(t.err.join("\n")).toMatch(/APP_USER.*APP_PASS|qa-agent login/);
  });

  it("login recusado sai com 2 e mensagem clara", async () => {
    const t = io({ APP_USER: "x", APP_PASS: "y" });
    const code = await main(["explore", saas.url, "--out-dir", mkdtempSync(join(tmpdir(), "qa-cli-")), ...FAST], t.cli);
    expect(code).toBe(2);
    expect(t.err.join("\n")).toMatch(/Login falhou/);
  }, 60_000);

  it("URL inválida sai com 2", async () => {
    const t = io();
    expect(await main(["explore", "isto-nao-e-url", "--out-dir", mkdtempSync(join(tmpdir(), "qa-cli-")), ...FAST], t.cli)).toBe(2);
    expect(t.err.join("\n")).toMatch(/URL inválida/);
  });

  it("com provedor de LLM, o Aprofundador roda e o orçamento é respeitado", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "qa-cli-"));
    const t = io();
    const fake = new FakeLLMProvider((req) => (req.task === "deepen" ? { elements: [] } : { findings: [] }));
    t.cli.provider = fake;
    const args = ["--max-telas", "3", "--estabilidade-ms", "200", "--config", "/nao/existe.yaml", "--env-file", "/nao/existe.env", "--max-llm-calls", "2"];
    const code = await main(["explore", saas.url, "--out-dir", outDir, ...args], t.cli);
    expect(code).toBe(0);
    expect(fake.calls.length).toBe(2);
    const runId = /(\d{8}-\d{6}-[0-9a-f]{4})/.exec(t.out.join("\n"))![1];
    expect(readFileSync(join(outDir, runId, "cobertura.md"), "utf8")).toMatch(/orçamento/i);
  }, 120_000);

  it("sem chave nem provedor, avisa na cobertura que a parte com LLM não rodou", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "qa-cli-"));
    const t = io();
    await main(["explore", saas.url, "--out-dir", outDir, ...FAST], t.cli);
    const runId = /(\d{8}-\d{6}-[0-9a-f]{4})/.exec(t.out.join("\n"))![1];
    expect(readFileSync(join(outDir, runId, "cobertura.md"), "utf8")).toMatch(/ANTHROPIC_API_KEY/);
  }, 120_000);

  it("--objetivos executa o fluxo, documenta em fluxos/ e sai com 1 se o fluxo falhar", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "qa-cli-"));
    const obj = join(outDir, "objetivos.md");
    writeFileSync(obj, "## Clicar no impossível\nClicar em algo.\n**Sucesso:** algo acontece.\n");
    const t = io();
    t.cli.provider = new FakeLLMProvider((req) =>
      req.task === "flow"
        ? { done: false, giveUp: false, reason: "", action: { kind: "click", locator: { role: "button", name: "Inexistente" }, description: "Clicar no inexistente" } }
        : req.task === "deepen" ? { elements: [] } : { findings: [] },
    );
    const args = ["--max-telas", "2", "--estabilidade-ms", "200", "--sem-ux", "--config", "/nao/existe.yaml", "--env-file", "/nao/existe.env", "--objetivos", obj];
    const code = await main(["explore", saas.url, "--out-dir", outDir, ...args], t.cli);
    expect(code).toBe(1);
    expect(t.out.join("\n")).toMatch(/Fluxos: Clicar no impossível → fail/);
    const runId = /(\d{8}-\d{6}-[0-9a-f]{4})/.exec(t.out.join("\n"))![1];
    expect(existsSync(join(outDir, runId, "fluxos/clicar-no-impossivel.md"))).toBe(true);
  }, 120_000);

  it("--objetivos com arquivo inexistente ou inválido sai com 2", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "qa-cli-"));
    const t = io();
    expect(await main(["explore", saas.url, "--out-dir", outDir, ...FAST, "--objetivos", "/nao/existe.md"], t.cli)).toBe(2);
    const bad = join(outDir, "ruim.md");
    writeFileSync(bad, "## Sem critério\nfaz algo\n");
    const t2 = io();
    expect(await main(["explore", saas.url, "--out-dir", outDir, ...FAST, "--objetivos", bad], t2.cli)).toBe(2);
    expect(t2.err.join("\n")).toMatch(/critério de sucesso/);
  }, 60_000);
});
