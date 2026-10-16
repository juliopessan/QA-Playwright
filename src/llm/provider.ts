import type { z } from "zod";
import type { MaskedImage } from "../masking/image.js";
import type { Usage } from "../types/index.js";

export interface LLMRequest<T> {
  task: "compile" | "heal" | "judge";
  system: string;
  prompt: string;
  /** Só imagens já mascaradas chegam ao modelo. */
  images?: MaskedImage[];
  /** Schema zod; os provedores o convertem em JSON Schema. */
  schema: z.ZodType<T>;
}

export interface LLMProvider {
  readonly id: string;
  /** Devolve o dado bruto do modelo; a validação é feita por `completeValidated`. */
  complete<T>(req: LLMRequest<T>): Promise<{ data: unknown; usage: Usage }>;
}

export const emptyUsage = (): Usage => ({ calls: 0, inputTokens: 0, outputTokens: 0 });

export const addUsage = (a: Usage, b: Usage): Usage => ({
  calls: a.calls + b.calls,
  inputTokens: a.inputTokens + b.inputTokens,
  outputTokens: a.outputTokens + b.outputTokens,
});
