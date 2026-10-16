import { describe, it, expect } from "vitest";
import { scriptedProvider } from "../support/scripted-provider.js";
import { FakeLLMProvider } from "../../src/llm/fake.js";
import { BudgetedProvider } from "../../src/llm/budget.js";
import { judgeCase } from "../../src/judge/index.js";
import type { CompiledStep, StepResult, TestCase } from "../../src/types/index.js";

const cfg = { minConfidence: 0.6 };
const tc: TestCase = {
  id: "TC-1",
  title: "Caso",
  steps: [
    { index: 1, text: "Abrir" },
    { index: 2, text: "Verificar algo", expected: "é claro" },
  ],
};
const step = (i: number, status: StepResult["status"], extra: Partial<StepResult> = {}): StepResult => ({
  stepIndex: i,
  status,
  durationMs: 5,
  screenshotBefore: `evidence/TC-1/0${i}-before.png`,
  screenshotAfter: `evidence/TC-1/0${i}-after.png`,
  ...extra,
});
const comp = (i: number, extra: Partial<CompiledStep> = {}): CompiledStep => ({
  stepIndex: i,
  kind: "action",
  actions: [],
  confidence: 0.9,
  subjective: false,
  fromCache: false,
  ...extra,
});
const noLLM = () => new FakeLLMProvider(() => { throw new Error("LLM não deveria ser chamado"); });
const objective = { steps: [step(1, "pass"), step(2, "pass")], compiled: [comp(1), comp(2)] };

describe("judgeCase", () => {
  it("todos pass → pass, sem chamar o LLM", async () => {
    const v = await judgeCase(tc, objective, { provider: noLLM(), cfg });
    expect(v.status).toBe("pass");
    expect(v.caseId).toBe("TC-1");
    expect(v.evidenceRefs).toContain("evidence/TC-1/01-before.png");
  });

  it("um passo fail → fail com reasoning citando o passo e os não executados", async () => {
    const r = { steps: [step(1, "fail", { error: "botão não achado" }), step(2, "skipped")], compiled: [comp(1)] };
    const v = await judgeCase(tc, r, { provider: noLLM(), cfg });
    expect(v.status).toBe("fail");
    expect(v.reasoning).toContain("Passo 1");
    expect(v.reasoning).toContain("botão não achado");
    expect(v.reasoning).toMatch(/não executad/i);
  });

  it("confiança baixa → needs-review", async () => {
    const r = { steps: [step(1, "pass"), step(2, "skipped", { error: "não resolvido" })], compiled: [comp(1), comp(2, { confidence: 0.2 })] };
    const v = await judgeCase(tc, r, { provider: noLLM(), cfg });
    expect(v.status).toBe("needs-review");
    expect(v.reasoning).toContain("Passo 2");
  });

  const subjective = { steps: [step(1, "pass"), step(2, "pass", { observed: "Mensagem: preencha o campo" })], compiled: [comp(1), comp(2, { kind: "verification", subjective: true })] };

  it("subjetivo + LLM pass com evidence → pass", async () => {
    const p = scriptedProvider([{ match: /./, task: "judge", response: { verdict: "pass", evidence: "A mensagem orienta a preencher o campo" } }]);
    const v = await judgeCase(tc, subjective, { provider: p, cfg });
    expect(v.status).toBe("pass");
    expect(v.reasoning).toContain("orienta");
    expect(p.calls[0].prompt).toContain("preencha o campo");
  });

  it("subjetivo + LLM uncertain → needs-review", async () => {
    const p = scriptedProvider([{ match: /./, task: "judge", response: { verdict: "uncertain", evidence: "difícil dizer" } }]);
    expect((await judgeCase(tc, subjective, { provider: p, cfg })).status).toBe("needs-review");
  });

  it("subjetivo + LLM pass com evidence vazia → needs-review", async () => {
    const p = scriptedProvider([{ match: /./, task: "judge", response: { verdict: "pass", evidence: "  " } }]);
    expect((await judgeCase(tc, subjective, { provider: p, cfg })).status).toBe("needs-review");
  });

  it("subjetivo + LLM fail → fail", async () => {
    const p = scriptedProvider([{ match: /./, task: "judge", response: { verdict: "fail", evidence: "mensagem confusa" } }]);
    expect((await judgeCase(tc, subjective, { provider: p, cfg })).status).toBe("fail");
  });

  it("resposta inválida do LLM no judge → needs-review", async () => {
    const p = scriptedProvider([{ match: /./, task: "judge", response: { lixo: true } }]);
    expect((await judgeCase(tc, subjective, { provider: p, cfg })).status).toBe("needs-review");
  });

  it("orçamento de LLM esgotado no judge → needs-review", async () => {
    const p = new BudgetedProvider(scriptedProvider([]), 0);
    const v = await judgeCase(tc, subjective, { provider: p, cfg });
    expect(v.status).toBe("needs-review");
    expect(v.reasoning).toMatch(/orçamento/i);
  });

  it("passo healed + resto pass → pass e reasoning menciona a autocorreção", async () => {
    const r = { steps: [step(1, "healed", { healNote: "trocou seletor" }), step(2, "pass")], compiled: [comp(1), comp(2)] };
    const v = await judgeCase(tc, r, { provider: noLLM(), cfg });
    expect(v.status).toBe("pass");
    expect(v.reasoning).toMatch(/autocorrig/i);
    expect(v.reasoning).toContain("trocou seletor");
  });

  it("passo skipped sem fail (LLM indisponível) → needs-review, nunca pass", async () => {
    const r = { steps: [step(1, "skipped", { error: "rede caiu" }), step(2, "skipped")], compiled: [comp(1, { confidence: 0 })] };
    const v = await judgeCase(tc, r, { provider: noLLM(), cfg });
    expect(v.status).toBe("needs-review");
  });
});
