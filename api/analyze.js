import { clientIp, makeLimiter, readBody, send, validateTarget } from "./_lib/core.js";
import { exaCrawl } from "./_lib/exa.js";
import { fetchPage, measuredFindings } from "./_lib/probe.js";
import { reviewWithClaude } from "./_lib/review.js";

const SEV = { high: 0, medium: 1, low: 2 };

/**
 * POST /api/analyze { url }: análise somente leitura de um site público.
 * 1. Exa lê a página inicial e páginas internas; 2. uma visita direta mede status, tempo, cabeçalhos
 * e HTML; 3. o Claude revisa o conteúdo (achados só com trecho literal do site).
 */
export function makeAnalyze(deps = {}) {
  const limit = deps.limiter ?? makeLimiter();
  return async function handler(req, res) {
    if (req.method !== "POST") return send(res, 405, { error: "Use POST." }, { Allow: "POST" });
    const env = deps.env ?? process.env;
    if (!env.EXA_API_KEY) return send(res, 503, { error: "A análise ainda não foi configurada neste site." });

    const target = validateTarget(readBody(req).url);
    if (!target.ok) return send(res, 400, { error: target.error, field: "url" });
    const gate = limit(clientIp(req));
    if (!gate.ok) return send(res, 429, { error: `Muitas análises seguidas. Tente de novo em ${Math.ceil(gate.retryInSec / 60)} min.` }, { "Retry-After": String(gate.retryInSec) });

    const started = Date.now();
    const notes = [];
    const [crawl, page] = await Promise.allSettled([
      (deps.exaCrawl ?? exaCrawl)(target.url, { apiKey: env.EXA_API_KEY }),
      (deps.fetchPage ?? fetchPage)(target.url),
    ]);
    if (crawl.status === "rejected" && page.status === "rejected") {
      console.error("analyze:", crawl.reason?.message, page.reason?.message);
      return send(res, 502, { error: `Não foi possível acessar o site: ${page.reason?.message ?? "sem resposta"}. Confira a URL e se ele está no ar.` });
    }

    let findings = [];
    let facts = {};
    if (page.status === "fulfilled") {
      const m = measuredFindings(page.value);
      findings.push(...m.findings);
      facts = m.info;
    } else notes.push(`Checagem direta não concluída: ${page.reason?.message}.`);

    const pages = crawl.status === "fulfilled" ? crawl.value.pages : [];
    if (crawl.status === "rejected") notes.push(`Leitura das páginas pelo Exa falhou: ${crawl.reason?.message}. A revisão de conteúdo não rodou.`);

    let summary = "";
    let model;
    if (pages.length && env.ANTHROPIC_API_KEY) {
      try {
        const r = await (deps.review ?? reviewWithClaude)(pages, facts, { apiKey: env.ANTHROPIC_API_KEY });
        findings.push(...r.findings);
        summary = r.summary;
        model = r.model;
        if (r.dropped) notes.push(`${r.dropped} sugestão(ões) do modelo descartada(s) por não citar um trecho real do site.`);
      } catch (e) {
        notes.push(`Revisão de conteúdo pelo Claude indisponível: ${e.message}.`);
      }
    } else if (pages.length) notes.push("Revisão de conteúdo pelo Claude desligada (ANTHROPIC_API_KEY não configurada).");

    findings = findings.sort((a, b) => SEV[a.severity] - SEV[b.severity] || (a.origin === "measured" ? -1 : 1));
    return send(res, 200, {
      url: target.url,
      finalUrl: page.status === "fulfilled" ? page.value.finalUrl : target.url,
      analyzedAt: new Date().toISOString(),
      durationMs: Date.now() - started,
      status: page.status === "fulfilled" ? page.value.status : undefined,
      responseMs: page.status === "fulfilled" ? page.value.ms : undefined,
      pages: pages.map((p) => ({ url: p.url, title: p.title })),
      summary,
      findings,
      counts: { high: findings.filter((f) => f.severity === "high").length, medium: findings.filter((f) => f.severity === "medium").length, low: findings.filter((f) => f.severity === "low").length },
      model,
      notes,
    });
  };
}

export default makeAnalyze();
