import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parse } from "yaml";

const raw = readFileSync(".github/workflows/qa.yml", "utf8");
const wf = parse(raw) as any;
const steps: any[] = wf.jobs.qa.steps;

describe("workflow de CI", () => {
  it("é acionável manualmente e por agendamento", () => {
    expect(wf.on).toHaveProperty("workflow_dispatch");
    expect(wf.on.schedule[0].cron).toBeTruthy();
  });

  it("usa secrets (nunca valores literais) para a chave do LLM e as credenciais", () => {
    const env = steps.find((s) => s.name === "Executar QA")!.env;
    expect(env.ANTHROPIC_API_KEY).toBe("${{ secrets.ANTHROPIC_API_KEY }}");
    expect(env.APP_USER).toContain("secrets.");
    expect(env.APP_PASS).toContain("secrets.");
    expect(raw).not.toMatch(/sk-ant-/);
  });

  it("não interpola inputs diretamente no script (evita injeção)", () => {
    const run = steps.find((s) => s.name === "Executar QA")!.run as string;
    expect(run).not.toContain("${{");
  });

  it("publica o relatório como artefato mesmo quando o QA falha", () => {
    const up = steps.find((s) => String(s.uses).startsWith("actions/upload-artifact"))!;
    expect(up.if).toBe("always()");
    expect(up.with.path).toContain("runs/");
  });

  it("instala o Chromium do Playwright e faz build antes de executar", () => {
    const names = steps.map((s) => String(s.run ?? s.uses));
    const idx = (needle: string) => names.findIndex((n) => n.includes(needle));
    expect(idx("playwright install")).toBeGreaterThan(-1);
    expect(idx("npm run build")).toBeLessThan(idx("dist/cli/index.js"));
  });

  it("limita permissões do token ao mínimo", () => {
    expect(wf.permissions).toEqual({ contents: "read" });
  });
});
