import { FakeLLMProvider } from "../../src/llm/fake.js";
import type { LLMRequest } from "../../src/llm/provider.js";

export interface Rule {
  /** Casa contra a primeira linha do prompt ("Passo N: texto") para compile, ou o prompt inteiro nos demais. */
  match: RegExp;
  response: unknown | ((req: LLMRequest<unknown>) => unknown);
  task?: LLMRequest<unknown>["task"];
}

const DEFAULTS: Record<string, unknown> = {
  compile: { kind: "action", actions: [], confidence: 0, subjective: false },
  heal: { actions: [], note: "sem solução" },
  judge: { verdict: "uncertain", evidence: "" },
  deepen: { elements: [] },
  ux: { findings: [] },
  flow: { done: false, giveUp: true, reason: "sem regra" },
};

/** Provedor falso dirigido por regras: determinístico e sem rede. */
export function scriptedProvider(rules: Rule[]): FakeLLMProvider {
  return new FakeLLMProvider((req) => {
    const subject = req.task === "compile" ? req.prompt.split("\n").find((l) => l.startsWith("Passo ")) ?? "" : req.prompt;
    for (const r of rules) {
      if (r.task && r.task !== req.task) continue;
      if (r.match.test(subject)) return typeof r.response === "function" ? (r.response as any)(req) : r.response;
    }
    return DEFAULTS[req.task];
  });
}

export const click = (name: string, nth?: number) => ({
  kind: "click" as const,
  locator: { role: "button", name, ...(nth !== undefined ? { nth } : {}) },
  description: `Clicar em ${name}`,
});
export const compiled = (actions: unknown[], extra: Record<string, unknown> = {}) => ({
  kind: "action",
  confidence: 0.95,
  subjective: false,
  actions,
  ...extra,
});
