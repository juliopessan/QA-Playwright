import { addUsage, type LLMProvider, type LLMRequest } from "./provider.js";
import type { Usage } from "../types/index.js";

export class LLMInvalidResponse extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LLMInvalidResponse";
  }
}

/** Valida a resposta com `req.schema`; uma retentativa com o erro anexado; depois lança. */
export async function completeValidated<T>(
  provider: LLMProvider,
  req: LLMRequest<T>,
): Promise<{ data: T; usage: Usage }> {
  const first = await provider.complete(req);
  const p1 = req.schema.safeParse(first.data);
  if (p1.success) return { data: p1.data, usage: first.usage };

  const retryReq: LLMRequest<T> = {
    ...req,
    prompt: `${req.prompt}\n\nSua resposta anterior foi inválida: ${p1.error.message}\nResponda novamente seguindo exatamente o schema.`,
  };
  const second = await provider.complete(retryReq);
  const usage = addUsage(first.usage, second.usage);
  const p2 = req.schema.safeParse(second.data);
  if (p2.success) return { data: p2.data, usage };
  throw new LLMInvalidResponse(`Resposta do LLM inválida após retentativa: ${p2.error.message}`);
}
