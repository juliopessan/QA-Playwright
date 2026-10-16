import { addUsage, emptyUsage, type LLMProvider, type LLMRequest } from "./provider.js";
import type { Usage } from "../types/index.js";

export class LLMBudgetExceeded extends Error {
  constructor(max: number) {
    super(`Orçamento de chamadas ao LLM esgotado (--max-llm-calls ${max})`);
    this.name = "LLMBudgetExceeded";
  }
}

export class BudgetedProvider implements LLMProvider {
  usage: Usage = emptyUsage();
  constructor(
    private readonly inner: LLMProvider,
    private readonly maxCalls: number,
  ) {}
  get id(): string {
    return this.inner.id;
  }
  async complete<T>(req: LLMRequest<T>): Promise<{ data: unknown; usage: Usage }> {
    if (this.usage.calls >= this.maxCalls) throw new LLMBudgetExceeded(this.maxCalls);
    const r = await this.inner.complete(req);
    this.usage = addUsage(this.usage, r.usage.calls ? r.usage : { ...r.usage, calls: 1 });
    return r;
  }
}
