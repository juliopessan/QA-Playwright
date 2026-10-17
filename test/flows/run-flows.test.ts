import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startSaas, SAAS_USER, SAAS_PASS } from "../saas/server.js";
import { runFlows } from "../../src/flows/run-flows.js";
import { parseObjectives } from "../../src/flows/parse.js";
import { FakeLLMProvider } from "../../src/llm/fake.js";
import type { ExploreResult } from "../../src/explore/types.js";

let saas: Awaited<ReturnType<typeof startSaas>>;
beforeAll(async () => {
  saas = await startSaas(0, { slowMs: 100 });
});
afterAll(async () => {
  await saas.close();
});

const emptyResult = (): ExploreResult => ({
  runId: "r", baseUrl: saas.url, startedAt: "", screens: [], edges: [], findings: [], blocked: [], limitsHit: [], skipped: [],
  llm: { calls: 0, inputTokens: 0, outputTokens: 0, notes: [] },
});
const perf = { lcpMs: 60_000, cls: 1, loadMs: 60_000 };
const run = (provider: FakeLLMProvider, md: string, extra: { maxSteps?: number; allowedHosts?: string[] } = {}) => {
  const runDir = mkdtempSync(join(tmpdir(), "qa-flow-"));
  const result = emptyResult();
  const { objectives } = parseObjectives(md);
  const p = runFlows(objectives, { baseUrl: saas.url, user: SAAS_USER, pass: SAAS_PASS, runDir, provider, env: { APP_USER: SAAS_USER, APP_PASS: SAAS_PASS }, perf, ...extra }, result);
  return p.then(() => ({ result, runDir }));
};

const INVITE = "## Convidar usuário\nConvidar um novo usuário pela tela de equipe.\n**Sucesso:** o convite é enviado.";

/** Roteiro: ir à equipe, clicar em Convidar usuário, declarar concluído; o Judge aprova com evidência. */
function inviteProvider(judge: unknown = { verdict: "pass", evidence: "Botão 'Convidar usuário' visível na tela de equipe" }) {
  return new FakeLLMProvider((req) => {
    if (req.task === "flow") {
      const done = req.prompt.match(/Ações já executadas:\n([\s\S]*?)\nURL atual/)?.[1] ?? "";
      if (!/Ir para/.test(done)) return { done: false, giveUp: false, reason: "", action: { kind: "goto", url: "/team", description: "Ir para a tela de equipe" } };
      if (!/Clicar/.test(done)) return { done: false, giveUp: false, reason: "", action: { kind: "click", locator: { role: "button", name: "Convidar usuário" }, description: "Clicar em Convidar usuário" } };
      return { done: true, giveUp: false, reason: "convite enviado" };
    }
    if (req.task === "judge") return judge;
    return {};
  });
}

describe("fluxos-objetivo", () => {
  it("executa o objetivo com escrita permitida, fotografa cada passo e o Judge aprova", async () => {
    const before = saas.writes.length;
    const { result, runDir } = await run(inviteProvider(), INVITE);
    const flow = result.flows![0];
    expect(flow.status).toBe("pass");
    expect(saas.writes.slice(before).map((w) => w.path)).toContain("/api/invite");
    expect(flow.steps.map((s) => s.text)).toEqual(["Ir para a tela de equipe", "Clicar em Convidar usuário", expect.stringContaining("Critério de sucesso")]);
    for (const s of flow.steps) for (const ref of [s.screenshotBefore, s.screenshotAfter]) if (ref) expect(existsSync(join(runDir, ref))).toBe(true);
    expect(flow.reasoning).toMatch(/Judge/);
  }, 120_000);

  it("telas alcançadas pelo fluxo entram no resultado e são analisadas", async () => {
    const { result } = await run(inviteProvider(), INVITE);
    expect(result.screens.map((s) => s.routePattern)).toContain("/team");
    expect(result.flows![0].screenIds).toContain("team");
  }, 120_000);

  it("o Judge sem evidência não aprova: vira needs-review", async () => {
    const { result } = await run(inviteProvider({ verdict: "pass", evidence: "" }), INVITE);
    expect(result.flows![0].status).toBe("needs-review");
  }, 120_000);

  it("ação que falha vira fail com o motivo", async () => {
    const p = new FakeLLMProvider((req) =>
      req.task === "flow"
        ? { done: false, giveUp: false, reason: "", action: { kind: "click", locator: { role: "button", name: "Botão Inexistente" }, description: "Clicar no botão inexistente" } }
        : {},
    );
    const { result } = await run(p, INVITE);
    expect(result.flows![0].status).toBe("fail");
    expect(result.flows![0].reasoning).toMatch(/falhou/);
  }, 120_000);

  it("respeita o limite de passos e não aprova", async () => {
    const p = new FakeLLMProvider((req) =>
      req.task === "flow" ? { done: false, giveUp: false, reason: "", action: { kind: "press", key: "Escape", description: "Pressionar Escape" } } : {},
    );
    const { result } = await run(p, INVITE, { maxSteps: 3 });
    expect(result.flows![0].status).toBe("needs-review");
    expect(result.flows![0].reasoning).toMatch(/3 passos/);
    expect(p.calls.filter((c) => c.task === "flow")).toHaveLength(3);
  }, 120_000);

  it("agente que desiste vira needs-review com o motivo", async () => {
    const p = new FakeLLMProvider((req) => (req.task === "flow" ? { done: false, giveUp: true, reason: "não vejo a tela" } : {}));
    const { result } = await run(p, INVITE);
    expect(result.flows![0].status).toBe("needs-review");
    expect(result.flows![0].reasoning).toContain("não vejo a tela");
  }, 120_000);

  it("senha nunca vai ao modelo nem aparece no resultado; página é tratada como não confiável", async () => {
    const p = inviteProvider();
    const { result } = await run(p, INVITE);
    const flowCalls = p.calls.filter((c) => c.task === "flow");
    expect(flowCalls[0].prompt).toContain("{{APP_PASS}}");
    expect(flowCalls.every((c) => !c.prompt.includes(SAAS_PASS))).toBe(true);
    expect(flowCalls[0].prompt).toContain("<pagina-nao-confiavel>");
    expect(JSON.stringify(result.flows)).not.toContain(SAAS_PASS);
  }, 120_000);

  it("navegação para host não permitido é bloqueada e o fluxo falha", async () => {
    const p = new FakeLLMProvider((req) =>
      req.task === "flow" ? { done: false, giveUp: false, reason: "", action: { kind: "goto", url: "http://example.invalid/x", description: "Ir para fora" } } : {},
    );
    const { result } = await run(p, INVITE);
    expect(result.flows![0].status).toBe("fail");
  }, 120_000);
});
