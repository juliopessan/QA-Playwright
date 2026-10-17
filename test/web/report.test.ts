import { describe, it, expect } from "vitest";
import { chromium } from "playwright";
import { createServer } from "node:http";
import { findingId, renderReportHtml, sanitizeReport } from "../../api/_lib/report.js";
import { makeReport, renderPdf } from "../../api/report.js";
import { makeLimiter } from "../../api/_lib/core.js";

const JPG = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=";
const base = () => ({
  url: "https://ukodelabs.com.br/", finalUrl: "https://ukodelabs.com.br/", analyzedAt: "2026-10-17T19:55:00.000Z", status: 200, responseMs: 800, model: "claude-opus-5-5",
  summary: "O site comunica bem a proposta, mas falta clareza para decisores.",
  pages: [{ url: "https://ukodelabs.com.br/", title: "UKode Labs" }],
  shots: [{ url: "https://ukodelabs.com.br/", title: "UKode Labs", status: 200, loadMs: 1600, desktop: JPG, mobile: JPG }],
  notes: ["5 sugestão(ões) do modelo descartada(s) por não citar um trecho real do site."],
  findings: [
    { origin: "measured", category: "seguranca", severity: "low", title: "Sem Content-Security-Policy", evidence: "Cabeçalho content-security-policy ausente", suggestion: "Defina uma CSP.", page: "https://ukodelabs.com.br/" },
    { origin: "measured", category: "acessibilidade", severity: "high", title: "Acessibilidade: contraste insuficiente", evidence: ".eyebrow | .hero-foot", suggestion: "Aumente o contraste para 4,5:1.", page: "https://ukodelabs.com.br/" },
    { origin: "agent", category: "conteudo", severity: "medium", title: "Métrica '00 frameworks' confusa", description: "Parece erro.", evidence: "00 frameworks de agente", suggestion: "Explique o zero.", page: "https://ukodelabs.com.br/", confidence: 0.8 },
  ],
});

describe("sanitizeReport", () => {
  it("ordena por gravidade, dá id estável e limita campos", () => {
    const r = sanitizeReport(base());
    expect(r.findings.map((f: any) => f.severity)).toEqual(["high", "medium", "low"]);
    expect(r.findings[0].id).toBe(findingId({ category: "acessibilidade", page: "https://ukodelabs.com.br/", title: "Acessibilidade: contraste insuficiente" }));
    expect(r.findings[0].id).toMatch(/^[0-9a-f]{8}$/);
    const big = base();
    big.findings = Array.from({ length: 200 }, (_, i) => ({ ...big.findings[0], title: `t${i}`, evidence: "x".repeat(5000) }));
    const s = sanitizeReport(big);
    expect(s.findings).toHaveLength(80);
    expect(s.findings[0].evidence.length).toBe(420);
  });

  it("recusa relatório sem URL válida e descarta imagens que não são JPEG, URLs não http(s) e categorias inventadas", () => {
    expect(() => sanitizeReport({ url: "javascript:alert(1)" })).toThrow(/URL/);
    expect(() => sanitizeReport(null)).toThrow();
    const b: any = base();
    b.shots = [{ url: "https://a.com/", title: "A", status: 200, loadMs: 1, desktop: "javascript:alert(1)", mobile: "data:image/svg+xml;base64,AAAA" }, { url: "ftp://x.com/", title: "X" }];
    b.findings[0].category = "<script>";
    b.findings[0].page = "javascript:alert(1)";
    const r = sanitizeReport(b);
    expect(r.shots).toHaveLength(1);
    expect(r.shots[0].desktop).toBeUndefined();
    expect(r.shots[0].mobile).toBeUndefined();
    expect(r.findings.find((f: any) => f.title.startsWith("Sem Content"))).toMatchObject({ category: "ux", page: "https://ukodelabs.com.br/" });
  });
});

describe("renderReportHtml", () => {
  const html = renderReportHtml(base());

  it("tem a estrutura de documento: capa, resumo, método, achados medidos, opinião do agente, evidências, limites e checklist", () => {
    for (const h of ["Relatório de análise", "1. Resumo executivo", "2. Escopo e método", "3. Achados medidos (2)", "4. Opinião do agente (1)", "5. Evidências visuais", "6. Observações e limitações", "7. Checklist para a equipe"]) expect(html).toContain(h);
    expect(html).toContain("<title>Relatório de análise · ukodelabs.com.br</title>");
    expect(html).toContain("17 de outubro de 2026");
    expect(html).toMatch(/@page\{size:A4/);
    expect(html).toContain("counter(pages)");
  });

  it("separa medido de opinião, numera os achados de forma consistente e mostra evidência e sugestão", () => {
    expect(html).toContain("A-01");
    expect(html).toMatch(/Acessibilidade: contraste insuficiente[\s\S]*A-01/);
    expect(html).toContain("opinião do agente · 80%");
    expect(html).toContain("Evidência</h4><div class=\"ev\">00 frameworks de agente</div>");
    expect(html).toContain("O que fazer");
    const sec3 = html.slice(html.indexOf("3. Achados medidos"), html.indexOf("4. Opinião do agente"));
    expect(sec3).not.toContain("00 frameworks");
    expect(html.slice(html.indexOf("4. Opinião do agente"), html.indexOf("5. Evidências"))).toContain("00 frameworks");
  });

  it("embute os screenshots e legenda as figuras", () => {
    // capa (hero) + desktop e celular da figura 1
    expect(html.match(/<img src="data:image\/jpeg;base64,/g)).toHaveLength(3);
    expect(html).toMatch(/Desktop · 1280 px[\s\S]*Celular · 390 px[\s\S]*Figura 1\./);
  });

  it("escapa todo texto vindo do site e não deixa imagem ou link perigoso passar", () => {
    const evil: any = base();
    evil.summary = "<script>alert(1)</script>";
    evil.findings[0].title = '"><img src=x onerror=alert(1)>';
    evil.findings[0].evidence = "<b>x</b>";
    evil.shots[0].desktop = "javascript:alert(1)";
    evil.notes = ["<iframe src=//evil>"];
    const out = renderReportHtml(evil);
    expect(out).not.toMatch(/<script>alert|<img src=x|<b>x<\/b>|<iframe/);
    expect(out).not.toContain("javascript:");
    expect(out).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("estados vazios: sem achados, sem screenshots e revisão do Claude desligada", () => {
    const empty: any = { ...base(), findings: [], shots: [], notes: ["Revisão de conteúdo pelo Claude desligada (ANTHROPIC_API_KEY não configurada)."] };
    const out = renderReportHtml(empty);
    expect(out).toContain("Nenhum achado de gravidade alta ou média");
    expect(out).toContain("Sem screenshots nesta análise");
    expect(out).toContain("a revisão pelo Claude não rodou");
    expect(out).toContain("Sem pendências");
  });
});

describe("POST /api/report", () => {
  function call(handler: any, body: unknown, method = "POST", ip = "1.1.1.1") {
    const out: any = { headers: {} };
    const res = { set statusCode(v: number) { out.status = v; }, setHeader(k: string, v: string) { out.headers[k.toLowerCase()] = v; }, end(b: any) { out.body = b; } };
    return Promise.resolve(handler({ method, body, headers: { "x-forwarded-for": ip } }, res)).then(() => out);
  }

  it("html: devolve o documento como anexo com o nome do site", async () => {
    const r = await call(makeReport({ limiter: makeLimiter({ max: 9 }) }), { report: base(), format: "html" });
    expect(r.status).toBe(200);
    expect(r.headers["content-type"]).toMatch(/text\/html/);
    expect(r.headers["content-disposition"]).toBe('attachment; filename="relatorio-qa-agent-ukodelabs.com.br.html"');
    expect(String(r.body)).toContain("1. Resumo executivo");
  });

  it("pdf: devolve os bytes do renderizador como anexo; falha vira 502 com o caminho alternativo", async () => {
    const ok = await call(makeReport({ limiter: makeLimiter({ max: 9 }), renderPdf: async (html: string) => Buffer.from(`%PDF-fake ${html.length}`) }), { report: base(), format: "pdf" });
    expect(ok.status).toBe(200);
    expect(ok.headers["content-type"]).toBe("application/pdf");
    expect(ok.headers["content-disposition"]).toContain(".pdf");
    expect(Buffer.isBuffer(ok.body)).toBe(true);
    const bad = await call(makeReport({ limiter: makeLimiter({ max: 9 }), renderPdf: async () => { throw new Error("sem navegador"); } }), { report: base(), format: "pdf" });
    expect(bad.status).toBe(502);
    expect(JSON.parse(bad.body).error).toMatch(/Baixe o HTML/);
  });

  it("recusa relatório inválido (400), só aceita POST (405) e limita por IP (429)", async () => {
    const h = makeReport({ limiter: makeLimiter({ max: 1 }) });
    expect((await call(h, { report: { url: "ftp://x" } })).status).toBe(400);
    expect((await call(h, {}, "GET")).status).toBe(405);
    expect((await call(h, { report: base() })).status).toBe(200);
    const limited = await call(h, { report: base() });
    expect(limited.status).toBe(429);
    expect(limited.headers["retry-after"]).toBeTruthy();
  });
});

describe("renderPdf com Chromium de verdade", () => {
  it("gera um PDF A4 de várias páginas e a página não acessa a rede", async () => {
    const hits: string[] = [];
    const server = createServer((req, res) => { hits.push(String(req.url)); res.writeHead(200).end("x"); });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as any).port;
    try {
      const b: any = base();
      b.findings = Array.from({ length: 14 }, (_, i) => ({ ...b.findings[i % 3], title: `Achado número ${i} com texto de exemplo`, page: "https://ukodelabs.com.br/" }));
      const html = renderReportHtml(b).replace("</main>", `<img src="http://127.0.0.1:${port}/espiao.png"></main>`);
      const pdf = await renderPdf(html, () => chromium.launch());
      expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
      const pages = (pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;
      expect(pages).toBeGreaterThanOrEqual(4);
      expect(hits).toEqual([]);
    } finally {
      server.close();
    }
  }, 90_000);
});
