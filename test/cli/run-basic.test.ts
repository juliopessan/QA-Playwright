import { describe, it, expect } from "vitest";
import { main, type CliIO } from "../../src/cli/index.js";

const FIXTURE = "fixtures/casos-sinteticos.xlsx";
const VARS = { APP_USER: "u", APP_PASS: "p", LOCKED_USER: "l" };

function io(env: Record<string, string | undefined> = VARS) {
  const out: string[] = [];
  const err: string[] = [];
  const cli: CliIO = { out: (s) => out.push(s), err: (s) => err.push(s), env };
  return { cli, out, err };
}

describe("qa-agent run --dry-run", () => {
  it('no fixture imprime "12 casos, 80 passos" e sai 0', async () => {
    const t = io();
    const code = await main(["run", FIXTURE, "--dry-run"], t.cli);
    expect(code).toBe(0);
    expect(t.out.join("\n")).toContain("12 casos, 80 passos");
  });

  it('--only TC-003 mostra "1 casos, 5 passos"', async () => {
    const t = io();
    const code = await main(["run", FIXTURE, "--dry-run", "--only", "TC-003"], t.cli);
    expect(code).toBe(0);
    expect(t.out.join("\n")).toContain("1 casos, 5 passos");
  });

  it("--only com ID inexistente sai 2", async () => {
    const t = io();
    const code = await main(["run", FIXTURE, "--dry-run", "--only", "TC-999"], t.cli);
    expect(code).toBe(2);
    expect(t.err.join("\n")).toContain("TC-999");
  });

  it('xlsx inexistente sai 2 com mensagem "arquivo não encontrado"', async () => {
    const t = io();
    const code = await main(["run", "/nao/existe.xlsx", "--dry-run"], t.cli);
    expect(code).toBe(2);
    expect(t.err.join("\n")).toContain("arquivo não encontrado");
  });

  it("variável ausente no env sai 2 listando os nomes", async () => {
    const t = io({ APP_USER: "u" });
    const code = await main(["run", FIXTURE, "--dry-run"], t.cli);
    expect(code).toBe(2);
    expect(t.err.join("\n")).toContain("Variáveis ausentes: APP_PASS, LOCKED_USER");
  });

  it("--max-llm-calls inválido sai 2 em vez de virar 'sem limite'", async () => {
    for (const bad of ["abc", "0", "-3", "1.5"]) {
      const t = io();
      const code = await main(["run", FIXTURE, "--dry-run", "--max-llm-calls", bad], t.cli);
      expect(code, bad).toBe(2);
      expect(t.err.join("\n")).toContain("--max-llm-calls");
    }
  });

  it("opção desconhecida sai 2", async () => {
    const t = io();
    const code = await main(["run", FIXTURE, "--naoexiste"], t.cli);
    expect(code).toBe(2);
  });
});
