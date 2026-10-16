import { describe, it, expect } from "vitest";
import { z } from "zod";
import { FakeLLMProvider } from "../../src/llm/fake.js";
import { completeValidated, LLMInvalidResponse } from "../../src/llm/validated.js";
import type { LLMRequest } from "../../src/llm/provider.js";

const schema = z.object({ answer: z.number() });
const req = (): LLMRequest<{ answer: number }> => ({
  task: "compile",
  system: "sys",
  prompt: "quanto é 1+1?",
  schema,
});

describe("completeValidated", () => {
  it("devolve dado válido sem retentativa (calls=1)", async () => {
    const p = new FakeLLMProvider(() => ({ answer: 2 }));
    const r = await completeValidated(p, req());
    expect(r.data).toEqual({ answer: 2 });
    expect(p.calls).toHaveLength(1);
  });

  it("resposta inválida → retenta uma vez com a mensagem de erro no prompt (calls=2)", async () => {
    let n = 0;
    const p = new FakeLLMProvider(() => (++n === 1 ? { answer: "dois" } : { answer: 2 }));
    const r = await completeValidated(p, req());
    expect(r.data).toEqual({ answer: 2 });
    expect(p.calls).toHaveLength(2);
    expect(p.calls[1].prompt).toContain("quanto é 1+1?");
    expect(p.calls[1].prompt).toMatch(/inválida|invalid/i);
  });

  it("duas respostas inválidas → lança LLMInvalidResponse", async () => {
    const p = new FakeLLMProvider(() => ({ nope: true }));
    await expect(completeValidated(p, req())).rejects.toBeInstanceOf(LLMInvalidResponse);
    expect(p.calls).toHaveLength(2);
  });

  it("usage soma as duas chamadas quando há retentativa", async () => {
    let n = 0;
    const p = new FakeLLMProvider(() => (++n === 1 ? {} : { answer: 1 }));
    const r = await completeValidated(p, req());
    expect(r.usage.calls).toBe(2);
  });
});
