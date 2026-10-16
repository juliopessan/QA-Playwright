import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { Usage } from "../types/index.js";
import type { LLMProvider, LLMRequest } from "./provider.js";

export interface AnthropicLike {
  messages: { create(params: any): Promise<any> };
}

export interface AnthropicProviderOptions {
  apiKey?: string;
  model?: string;
  client?: AnthropicLike;
  maxTokens?: number;
}

const TOOL_NAME = "respond";

export class AnthropicProvider implements LLMProvider {
  readonly id: string;
  private readonly client: AnthropicLike;
  private readonly model: string;
  private readonly maxTokens: number;

  constructor(opts: AnthropicProviderOptions = {}) {
    this.model = opts.model ?? process.env.QA_AGENT_MODEL ?? "claude-sonnet-5-5";
    this.maxTokens = opts.maxTokens ?? 4096;
    this.id = `anthropic:${this.model}`;
    if (opts.client) {
      this.client = opts.client;
    } else {
      const apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY;
      if (!apiKey) throw new Error("ANTHROPIC_API_KEY ausente");
      this.client = new Anthropic({ apiKey }) as unknown as AnthropicLike;
    }
  }

  async complete<T>(req: LLMRequest<T>): Promise<{ data: unknown; usage: Usage }> {
    const content: unknown[] = [];
    for (const img of req.images ?? []) {
      content.push({
        type: "image",
        source: { type: "base64", media_type: img.mediaType, data: img.data.toString("base64") },
      });
    }
    content.push({ type: "text", text: req.prompt });

    const res = await this.client.messages.create({
      model: this.model,
      max_tokens: this.maxTokens,
      system: req.system,
      messages: [{ role: "user", content }],
      tools: [
        {
          name: TOOL_NAME,
          description: "Devolve a resposta estruturada da tarefa.",
          input_schema: z.toJSONSchema(req.schema as z.ZodType),
        },
      ],
      tool_choice: { type: "tool", name: TOOL_NAME },
    });

    const block = (res.content as any[]).find((b) => b.type === "tool_use");
    if (!block) throw new Error("Resposta do modelo sem bloco tool_use");
    return {
      data: block.input,
      usage: {
        calls: 1,
        inputTokens: res.usage?.input_tokens ?? 0,
        outputTokens: res.usage?.output_tokens ?? 0,
      },
    };
  }
}
