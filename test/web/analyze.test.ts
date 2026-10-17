import { describe, it, expect, vi } from "vitest";
import { makeAnalyze } from "../../api/analyze.js";
import { makeLimiter } from "../../api/_lib/core.js";

const ENV = { EXA_API_KEY: "exa-test", ANTHROPIC_API_KEY: "sk-test" };
const pages = [{ url: "https://ukodelabs.com.br/", title: "Ukode", text: "Fale com um especialista" }];
const sameHostLinks = ["https://ukodelabs.com.br/servicos", "https://outro.com/x", "https://ukodelabs.com.br/logo.png", "https://ukodelabs.com.br/contato"];
const okPage = { status: 200, finalUrl: "https://ukodelabs.com.br/", ms: 420, bytes: 1000, headers: {}, html: "<html><title>Ukode</title></html>" };

function call(handler: any, body: unknown, method = "POST", ip = "1.1.1.1") {
  const out: any = { headers: {} };
  const res = { set statusCode(v: number) { out.status = v; }, setHeader(k: string, v: string) { out.headers[k.toLowerCase()] = v; }, end(b: string) { out.body = JSON.parse(b); } };
  return Promise.resolve(handler({ method, body, headers: { "x-forwarded-for": ip } }, res)).then(() => out);
}

const deps = (over: Record<string, unknown> = {}) => ({
  env: ENV,
  exaCrawl: vi.fn(async () => ({ pages, links: sameHostLinks })),
  fetchPage: vi.fn(async () => okPage),
  review: vi.fn(async () => ({ summary: "Site claro.", findings: [{ origin: "agent", severity: "low", title: "CTA", category: "ux", evidence: "Fale com um especialista", suggestion: "s", page: pages[0].url, description: "d", confidence: 0.7 }], dropped: 1, model: "claude-opus-5-5" })),
  inspectPages: vi.fn(async (urls: string[]) => ({ shots: urls.map((u) => ({ url: u, title: "T", status: 200, loadMs: 800, desktop: "data:image/jpeg;base64,QQ==" })), findings: [{ origin: "measured", category: "acessibilidade", severity: "medium", title: "Acessibilidade: Imagens precisam de texto alternativo", evidence: "img.logo", suggestion: "s", page: urls[0] }], notes: [] })),
  limiter: makeLimiter({ max: 100 }),
  ...over,
});

describe("POST /api/analyze", () => {
  it("só com a URL: lê pelo Exa, mede a página, revisa com o Claude e devolve o relatório", async () => {
    const d = deps();
    const r = await call(makeAnalyze(d), { url: "ukodelabs.com.br" });
    expect(r.status).toBe(200);
    expect(d.exaCrawl).toHaveBeenCalledWith("https://ukodelabs.com.br/", { apiKey: "exa-test" });
    expect(d.fetchPage).toHaveBeenCalledWith("https://ukodelabs.com.br/");
    expect(r.body.pages).toEqual([{ url: "https://ukodelabs.com.br/", title: "Ukode" }]);
    expect(r.body.summary).toBe("Site claro.");
    expect(r.body.findings.some((f: any) => f.origin === "measured")).toBe(true);
    expect(r.body.findings.some((f: any) => f.origin === "agent")).toBe(true);
    expect(r.body.notes.join(" ")).toMatch(/1 sugestão/);
    expect(r.body.responseMs).toBe(420);
    expect(d.inspectPages).toHaveBeenCalledWith(["https://ukodelabs.com.br/", "https://ukodelabs.com.br/servicos", "https://ukodelabs.com.br/contato"]);
    expect(r.body.shots).toHaveLength(3);
    expect(r.body.findings.some((f: any) => /Imagens precisam/.test(f.title))).toBe(true);
    expect((d.review.mock.calls[0] as any[])[2].images).toHaveLength(3);
    const sev = r.body.findings.map((f: any) => f.severity);
    expect(sev).toEqual([...sev].sort((a: string, b: string) => ["high", "medium", "low"].indexOf(a) - ["high", "medium", "low"].indexOf(b)));
  });

  it("sem EXA_API_KEY responde 503; URL inválida 400; não chama nada", async () => {
    const d = deps({ env: {} });
    expect((await call(makeAnalyze(d), { url: "https://a.com" })).status).toBe(503);
    const d2 = deps();
    const r = await call(makeAnalyze(d2), { url: "http://localhost" });
    expect(r.status).toBe(400);
    expect(r.body.field).toBe("url");
    expect(d2.exaCrawl).not.toHaveBeenCalled();
  });

  it("limite por IP", async () => {
    const d = deps({ limiter: makeLimiter({ max: 1 }) });
    const h = makeAnalyze(d);
    expect((await call(h, { url: "https://a.com" })).status).toBe(200);
    const r = await call(h, { url: "https://a.com" });
    expect(r.status).toBe(429);
    expect(r.headers["retry-after"]).toBeTruthy();
  });

  it("falhas parciais viram observações; falha total vira 502 com o motivo", async () => {
    const partial = await call(makeAnalyze(deps({ exaCrawl: vi.fn(async () => { throw new Error("Exa respondeu 401"); }) })), { url: "https://a.com" });
    expect(partial.status).toBe(200);
    expect(partial.body.notes.join(" ")).toMatch(/Exa falhou: Exa respondeu 401/);
    const noLlm = await call(makeAnalyze(deps({ env: { EXA_API_KEY: "x" } })), { url: "https://a.com" });
    expect(noLlm.body.notes.join(" ")).toMatch(/ANTHROPIC_API_KEY/);
    const all = await call(makeAnalyze(deps({ exaCrawl: vi.fn(async () => { throw new Error("x"); }), fetchPage: vi.fn(async () => { throw new Error("o domínio não foi encontrado (DNS)"); }) })), { url: "https://a.com" });
    expect(all.status).toBe(502);
    expect(all.body.error).toMatch(/DNS/);
  });

  it("aceita a chave do Exa com o nome alternativo EXA_API", async () => {
    const d = deps({ env: { EXA_API: "exa-alt" } });
    const r = await call(makeAnalyze(d), { url: "https://a.com" });
    expect(r.status).toBe(200);
    expect(d.exaCrawl).toHaveBeenCalledWith("https://a.com/", { apiKey: "exa-alt" });
  });

  it("só aceita POST", async () => {
    expect((await call(makeAnalyze(deps()), undefined, "GET")).status).toBe(405);
  });
});
