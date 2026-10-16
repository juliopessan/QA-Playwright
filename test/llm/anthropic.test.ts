import { describe, it, expect, afterEach } from "vitest";
import { z } from "zod";
import { AnthropicProvider } from "../../src/llm/anthropic.js";
import { brandMaskedImage } from "../../src/masking/image.js";
import { completeValidated } from "../../src/llm/validated.js";

const schema = z.object({ answer: z.number() });

function fakeClient(response: unknown) {
  const seen: any[] = [];
  return {
    seen,
    client: {
      messages: {
        create: async (params: unknown) => {
          seen.push(params);
          return response;
        },
      },
    },
  };
}

const okResponse = {
  content: [{ type: "tool_use", name: "respond", input: { answer: 42 } }],
  usage: { input_tokens: 11, output_tokens: 7 },
};

describe("AnthropicProvider", () => {
  const prev = process.env.ANTHROPIC_API_KEY;
  afterEach(() => {
    if (prev === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = prev;
  });

  it("envia a tool com o JSON Schema do request e tool_choice auto (forçar tool é 400 nos modelos atuais)", async () => {
    const { client, seen } = fakeClient(okResponse);
    const p = new AnthropicProvider({ client, model: "m-test" });
    await p.complete({ task: "compile", system: "sys", prompt: "oi", schema });
    expect(seen[0].model).toBe("m-test");
    expect(seen[0].tools[0].name).toBe("respond");
    expect(seen[0].tools[0].input_schema.type).toBe("object");
    expect(seen[0].tools[0].input_schema.properties.answer).toBeDefined();
    expect(seen[0].tool_choice).toEqual({ type: "auto" });
    expect(seen[0].system).toContain("sys");
    expect(seen[0].system).toMatch(/ferramenta `respond`/);
    expect(seen[0].max_tokens).toBeGreaterThanOrEqual(16000);
  });

  it("converte MaskedImage em bloco image base64 png", async () => {
    const { client, seen } = fakeClient(okResponse);
    const p = new AnthropicProvider({ client });
    const img = brandMaskedImage(Buffer.from("PNGDATA"));
    await p.complete({ task: "judge", system: "s", prompt: "p", schema, images: [img] });
    const blocks = seen[0].messages[0].content;
    const image = blocks.find((b: any) => b.type === "image");
    expect(image.source).toEqual({
      type: "base64",
      media_type: "image/png",
      data: Buffer.from("PNGDATA").toString("base64"),
    });
  });

  it("devolve o input da tool como data e mapeia usage", async () => {
    const { client } = fakeClient(okResponse);
    const p = new AnthropicProvider({ client });
    const r = await p.complete({ task: "compile", system: "s", prompt: "p", schema });
    expect(r.data).toEqual({ answer: 42 });
    expect(r.usage).toEqual({ calls: 1, inputTokens: 11, outputTokens: 7 });
  });

  it("id inclui o modelo", () => {
    const { client } = fakeClient(okResponse);
    expect(new AnthropicProvider({ client, model: "abc" }).id).toBe("anthropic:abc");
  });

  it('sem ANTHROPIC_API_KEY nem client lança erro "ANTHROPIC_API_KEY ausente"', () => {
    delete process.env.ANTHROPIC_API_KEY;
    expect(() => new AnthropicProvider()).toThrow("ANTHROPIC_API_KEY ausente");
  });

  it("resposta só com texto devolve o texto como data (a validação acusa e há retentativa)", async () => {
    const { client } = fakeClient({ content: [{ type: "text", text: "oi, sem ferramenta" }], usage: { input_tokens: 1, output_tokens: 1 } });
    const p = new AnthropicProvider({ client });
    const r = await p.complete({ task: "compile", system: "s", prompt: "p", schema });
    expect(r.data).toBe("oi, sem ferramenta");
  });

  it("com completeValidated: 1ª resposta sem tool_use, 2ª com tool_use → sucesso em 2 chamadas", async () => {
    const responses = [
      { content: [{ type: "text", text: "esqueci a ferramenta" }], usage: { input_tokens: 1, output_tokens: 1 } },
      okResponse,
    ];
    const seen: any[] = [];
    const client = { messages: { create: async (p: unknown) => (seen.push(p), responses[seen.length - 1]) } };
    const p = new AnthropicProvider({ client });
    const r = await completeValidated(p, { task: "compile", system: "s", prompt: "p", schema });
    expect(r.data).toEqual({ answer: 42 });
    expect(seen).toHaveLength(2);
    expect(JSON.stringify(seen[1].messages)).toContain("respond");
  });

  it("modelo padrão é claude-opus-5-5 (QA_AGENT_MODEL sobrescreve)", () => {
    const prev = process.env.QA_AGENT_MODEL;
    delete process.env.QA_AGENT_MODEL;
    expect(new AnthropicProvider({ client: fakeClient(okResponse).client }).id).toBe("anthropic:claude-opus-5-5");
    process.env.QA_AGENT_MODEL = "claude-sonnet-5-5";
    expect(new AnthropicProvider({ client: fakeClient(okResponse).client }).id).toBe("anthropic:claude-sonnet-5-5");
    if (prev === undefined) delete process.env.QA_AGENT_MODEL; else process.env.QA_AGENT_MODEL = prev;
  });
});
