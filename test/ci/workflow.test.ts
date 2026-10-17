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

describe("workflow da análise pela web", () => {
  const raw2 = readFileSync(".github/workflows/explore-web.yml", "utf8");
  const w = parse(raw2) as any;
  const st: any[] = w.jobs.explore.steps;
  const byName = (n: string) => st.find((s) => s.name === n)!;

  it("é disparado só por workflow_dispatch, com url, payload e id do pedido", () => {
    expect(Object.keys(w.on)).toEqual(["workflow_dispatch"]);
    expect(Object.keys(w.on.workflow_dispatch.inputs)).toEqual(["target_url", "payload", "request_id"]);
    expect(w["run-name"]).toBe("explore ${{ inputs.request_id }}");
  });

  it("não interpola inputs nos scripts e usa secrets para chaves", () => {
    for (const s of st) if (s.run) expect(s.run, s.name).not.toContain("${{");
    expect(byName("Explorar e analisar").env.ANTHROPIC_API_KEY).toBe("${{ secrets.ANTHROPIC_API_KEY }}");
    expect(byName("Abrir credenciais do pedido").env.QA_INPUT_KEY).toBe("${{ secrets.QA_INPUT_KEY }}");
    expect(raw2).not.toMatch(/sk-ant-/);
  });

  it("abre as credenciais antes de explorar e publica o relatório mesmo em falha", () => {
    const i = (n: string) => st.findIndex((s) => s.name === n);
    expect(i("Abrir credenciais do pedido")).toBeLessThan(i("Explorar e analisar"));
    const up = st.find((s) => String(s.uses).startsWith("actions/upload-artifact"))!;
    expect(up.if).toBe("always()");
    expect(up.with.name).toBe("qa-report-${{ inputs.request_id }}");
    expect(up.with["retention-days"]).toBe(7);
  });

  it("permissões mínimas, fila única e limite de tempo", () => {
    expect(w.permissions).toEqual({ contents: "read" });
    expect(w.concurrency).toEqual({ group: "explore-web", "cancel-in-progress": false });
    expect(w.jobs.explore["timeout-minutes"]).toBeLessThanOrEqual(60);
  });
});
