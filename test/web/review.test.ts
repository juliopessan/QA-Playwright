import { describe, it, expect } from "vitest";
import { acceptAgentFindings, imageBlocks, reviewPrompt, reviewWithClaude } from "../../api/_lib/review.js";

const pages = [
  { url: "https://ukodelabs.com.br/", title: "Ukode Labs", text: "Desenvolvemos software sob medida. Fale com um especialista." },
  { url: "https://ukodelabs.com.br/servicos", title: "Serviços", text: "Consultoria em nuvem e IA generativa." },
];
const f = (over: Record<string, unknown> = {}) => ({ title: "CTA vago", description: "d", category: "ux", severity: "medium", page: pages[0].url, evidence: "Fale com um especialista", suggestion: "s", confidence: 0.8, ...over });

describe("acceptAgentFindings", () => {
  it("mantém só achados com trecho real do site; marca como opinião do agente", () => {
    const r = acceptAgentFindings({ summary: "ok", findings: [f(), f({ title: "Inventado", evidence: "Preço a partir de R$ 9" })] }, pages);
    expect(r.findings.map((x) => x.title)).toEqual(["CTA vago"]);
    expect(r.dropped).toBe(1);
    expect(r.findings[0]).toMatchObject({ origin: "agent", severity: "medium", page: pages[0].url });
  });
  it("limita gravidade, categoria, página e quantidade", () => {
    const many = Array.from({ length: 12 }, (_, i) => f({ title: `t${i}`, severity: "high", category: "outra", page: "https://outro.com" }));
    const r = acceptAgentFindings({ summary: 1, findings: many }, pages);
    expect(r.findings).toHaveLength(8);
    expect(r.findings.every((x) => x.severity === "low" && x.category === "ux" && x.page === pages[0].url)).toBe(true);
    expect(r.summary).toBe("");
  });
});

describe("reviewWithClaude", () => {
  it("usa saída estruturada, o conteúdo vai marcado como não confiável e o resultado é filtrado", async () => {
    let params: any;
    const client = { beta: { messages: { create: async (p: any) => { params = p; return { model: "claude-opus-5-5", stop_reason: "end_turn", usage: {}, content: [{ type: "thinking", thinking: "" }, { type: "text", text: JSON.stringify({ summary: "Resumo", findings: [f()] }) }] }; } } } };
    const r = await reviewWithClaude(pages, { title: "Ukode Labs" }, { client });
    expect(params.model).toBe("claude-opus-5-5");
    expect(params.output_config.format.type).toBe("json_schema");
    expect(params.tool_choice).toBeUndefined();
    const parts = params.messages[0].content;
    expect(parts.at(-1).text).toContain("<site-nao-confiavel>");
    expect(params.system).toMatch(/não confiável/);
    expect(r.summary).toBe("Resumo");
    expect(r.findings).toHaveLength(1);
  });
  it("envia os screenshots como imagens e ignora o que não é JPEG em data URL", async () => {
    let params: any;
    const client = { beta: { messages: { create: async (p: any) => { params = p; return { stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify({ summary: "s", findings: [] }) }] }; } } } };
    await reviewWithClaude(pages, {}, { client, images: ["data:image/jpeg;base64,/9j/AAA=", "https://evil.example/x.jpg", "data:image/svg+xml;base64,AAAA", undefined as any] });
    const kinds = params.messages[0].content.map((c: any) => c.type);
    expect(kinds).toEqual(["image", "text"]);
    expect(params.messages[0].content[0].source).toEqual({ type: "base64", media_type: "image/jpeg", data: "/9j/AAA=" });
    expect(imageBlocks(Array(9).fill("data:image/jpeg;base64,QQ=="))).toHaveLength(4);
  });

  it("recusa do modelo vira erro claro", async () => {
    const client = { beta: { messages: { create: async () => ({ stop_reason: "refusal", content: [] }) } } };
    await expect(reviewWithClaude(pages, {}, { client })).rejects.toThrow(/recusou/);
  });
  it("prompt inclui as páginas e os fatos medidos", () => {
    const p = reviewPrompt(pages, { title: "T", description: "", lang: "", h1: 0, imagesWithoutAlt: 3 });
    expect(p).toContain("https://ukodelabs.com.br/servicos");
    expect(p).toContain("3 imagens sem alt");
  });
});
