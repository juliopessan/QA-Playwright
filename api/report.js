import { config, isReportFile, pickFromZip, rewriteImages, send, verifyToken } from "./_lib/core.js";
import { loadArtifact, locateRun } from "./_lib/runs.js";

/** Relatório sem scripts: o conteúdo vem do site analisado e é tratado como não confiável. */
const REPORT_CSP = "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; font-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'";

/** GET /api/report?id=&t=[&file=img/x.jpg]: serve o relatorio.html e as imagens do artefato. */
export default async function handler(req, res) {
  const cfg = config();
  if (cfg.missing.length) return send(res, 503, { error: "A análise pela web ainda não foi configurada neste site." });
  const q = new URL(req.url, "http://x").searchParams;
  const id = q.get("id");
  const t = q.get("t");
  const file = q.get("file") || "relatorio.html";
  if (!verifyToken(id, t, cfg.key)) return send(res, 403, { error: "Link do relatório inválido ou expirado." });
  if (!isReportFile(file)) return send(res, 400, { error: "Arquivo inválido." });
  try {
    const run = await locateRun(cfg, id);
    const files = run && run.status === "completed" ? await loadArtifact(cfg, run) : undefined;
    const data = files && pickFromZip(files, file);
    if (!data) return send(res, 404, { error: "Relatório não encontrado. Ele fica disponível por 7 dias após a análise." });
    const cache = { "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": REPORT_CSP, "Referrer-Policy": "no-referrer" };
    if (file === "relatorio.html") return send(res, 200, rewriteImages(new TextDecoder().decode(data), id, t), { ...cache, "Content-Type": "text/html; charset=utf-8" });
    return send(res, 200, Buffer.from(data), { ...cache, "Content-Type": "image/jpeg" });
  } catch (e) {
    console.error("report:", e.message);
    return send(res, 502, { error: "Não foi possível carregar o relatório agora. Tente de novo." });
  }
}
