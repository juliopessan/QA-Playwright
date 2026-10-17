import { config, pickFromZip, send, verifyToken } from "./_lib/core.js";
import { loadArtifact, locateRun } from "./_lib/runs.js";

const dec = new TextDecoder();

/** GET /api/status?id=&t=: andamento da análise e, no fim, o link do relatório. */
export default async function handler(req, res) {
  const cfg = config();
  if (cfg.missing.length) return send(res, 503, { error: "A análise pela web ainda não foi configurada neste site." });
  const q = new URL(req.url, "http://x").searchParams;
  const id = q.get("id");
  const t = q.get("t");
  if (!verifyToken(id, t, cfg.key)) return send(res, 403, { error: "Link de acompanhamento inválido ou expirado." });
  try {
    const run = await locateRun(cfg, id);
    if (!run) return send(res, 200, { state: "queued" });
    if (run.status !== "completed") return send(res, 200, { state: run.status === "in_progress" ? "running" : "queued", startedAt: run.run_started_at });
    const files = await loadArtifact(cfg, run);
    const report = files && pickFromZip(files, "relatorio.html");
    if (report) {
      let summary;
      const m = pickFromZip(files, "dados/manifest.json");
      if (m) {
        try {
          summary = JSON.parse(dec.decode(m)).counts;
        } catch {}
      }
      return send(res, 200, { state: "done", summary, reportUrl: `/api/report?id=${encodeURIComponent(id)}&t=${encodeURIComponent(t)}` });
    }
    const err = files && pickFromZip(files, "erro.txt");
    const msg = err ? dec.decode(err).trim().split("\n").filter(Boolean).slice(-3).join(" ").slice(0, 400) : "";
    return send(res, 200, { state: "failed", error: msg || "A análise terminou sem relatório. Confira a URL e o login e tente de novo." });
  } catch (e) {
    console.error("status:", e.message);
    return send(res, 502, { error: "Não foi possível consultar a análise agora. A página tenta de novo sozinha." });
  }
}
