import { describe, it, expect } from "vitest";
import { z } from "zod";
import { FakeLLMProvider } from "../../src/llm/fake.js";
import { BudgetedProvider, LLMBudgetExceeded } from "../../src/llm/budget.js";

const r = { task: "judge" as const, system: "s", prompt: "p", schema: z.any() };

describe("BudgetedProvider", () => {
  it("lança LLMBudgetExceeded na 3ª chamada com maxCalls=2", async () => {
    const p = new BudgetedProvider(new FakeLLMProvider(() => ({})), 2);
    await p.complete(r);
    await p.complete(r);
    await expect(p.complete(r)).rejects.toBeInstanceOf(LLMBudgetExceeded);
  });
  it("acumula usage das chamadas feitas", async () => {
    const p = new BudgetedProvider(new FakeLLMProvider(() => ({})), 5);
    await p.complete(r);
    await p.complete(r);
    expect(p.usage.calls).toBe(2);
  });
  it("expõe o id do provedor interno", () => {
    expect(new BudgetedProvider(new FakeLLMProvider(() => ({})), 1).id).toBe("fake");
  });
});
