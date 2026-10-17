import { clientIp, makeLimiter, readBody, send } from "./_lib/core.js";
import { launchBrowser } from "./_lib/browser.js";
import { renderReportHtml, sanitizeReport } from "./_lib/report.js";

const slug = (url) => new URL(url).host.replace(/[^a-z0-9.-]/gi, "-");

/** PDF em A4 com o Chromium da função; a página não tem rede (só o HTML do relatório e imagens data:). */
export async function renderPdf(html, launch = launchBrowser) {
  const browser = await launch();
  try {
    const context = await browser.newContext();
    await context.route("**/*", (route) => (route.request().url().startsWith("data:") ? route.fulfill({ status: 204 }) : route.abort("blockedbyclient")));
    const page = await context.newPage();
    await page.setContent(html, { waitUntil: "load", timeout: 30_000 });
    await page.emulateMedia({ media: "print" });
    return await page.pdf({ preferCSSPageSize: true, printBackground: true });
  } finally {
    await browser.close().catch(() => undefined);
  }
}

/**
 * POST /api/report { report, format: "html" | "pdf" }: gera o documento do relatório (A4) a partir do
 * resultado da análise. O conteúdo é revalidado e escapado; nada é guardado no servidor.
 */
export function makeReport(deps = {}) {
  const limit = deps.limiter ?? makeLimiter({ max: 20 });
  return async function handler(req, res) {
    if (req.method !== "POST") return send(res, 405, { error: "Use POST." }, { Allow: "POST" });
    const body = readBody(req);
    const format = body.format === "pdf" ? "pdf" : "html";
    let report;
    try {
      report = sanitizeReport(body.report);
    } catch (e) {
      return send(res, 400, { error: `Relatório inválido: ${e.message}.` });
    }
    const gate = limit(clientIp(req));
    if (!gate.ok) return send(res, 429, { error: "Muitos relatórios gerados em sequência. Tente de novo em alguns minutos." }, { "Retry-After": String(gate.retryInSec) });

    const name = `relatorio-qa-agent-${slug(report.url)}`;
    const html = renderReportHtml(report);
    const headers = { "Content-Disposition": `attachment; filename="${name}.${format}"`, "X-Content-Type-Options": "nosniff" };
    if (format === "html") return send(res, 200, html, { ...headers, "Content-Type": "text/html; charset=utf-8" });
    try {
      const pdf = await (deps.renderPdf ?? renderPdf)(html);
      return send(res, 200, pdf, { ...headers, "Content-Type": "application/pdf" });
    } catch (e) {
      console.error("report pdf:", e.message);
      return send(res, 502, { error: "Não foi possível gerar o PDF agora. Baixe o HTML e use Imprimir → Salvar como PDF no navegador." });
    }
  };
}

export default makeReport();
