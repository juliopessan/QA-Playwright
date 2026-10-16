import type { Usage } from "../types/index.js";
import type { LLMProvider, LLMRequest } from "./provider.js";

/** Provedor determinístico para testes: `responder` decide a resposta de cada chamada. */
export class FakeLLMProvider implements LLMProvider {
  readonly id = "fake";
  calls: LLMRequest<unknown>[] = [];
  constructor(private readonly responder: (req: LLMRequest<unknown>) => unknown) {}

  async complete<T>(req: LLMRequest<T>): Promise<{ data: unknown; usage: Usage }> {
    this.calls.push(req as LLMRequest<unknown>);
    const data = this.responder(req as LLMRequest<unknown>);
    return { data, usage: { calls: 1, inputTokens: 0, outputTokens: 0 } };
  }
}
