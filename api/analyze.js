import { WORKFLOW_FILE, checkCode, config, github, newRequestId, readBody, recentRuns, sealCreds, send, signToken, validateCred, validateTarget } from "./_lib/core.js";

/** POST /api/analyze: valida o pedido e dispara o workflow de análise no GitHub Actions. */
export default async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "Use POST." }, { Allow: "POST" });
  const cfg = config();
  if (cfg.missing.length) return send(res, 503, { error: "A análise pela web ainda não foi configurada neste site." });

  const b = readBody(req);
  if (!checkCode(b.code, cfg.codes)) return send(res, 401, { error: "Código de acesso inválido. Confira o código que você recebeu.", field: "code" });
  const target = validateTarget(b.url);
  if (!target.ok) return send(res, 400, { error: target.error, field: "url" });
  const user = validateCred(b.user, "Usuário");
  const pass = validateCred(b.pass, "Senha");
  if (!user.ok) return send(res, 400, { error: user.error, field: "user" });
  if (!pass.ok) return send(res, 400, { error: pass.error, field: "pass" });
  if (b.authorized !== true) return send(res, 400, { error: "Confirme que você tem autorização para testar este site.", field: "authorized" });

  try {
    const list = await github(cfg, `/repos/${cfg.repo}/actions/workflows/${WORKFLOW_FILE}/runs?per_page=100`);
    if (!list.ok) throw new Error(`listar execuções: ${list.status}`);
    if (recentRuns((await list.json()).workflow_runs) >= cfg.dailyLimit) {
      return send(res, 429, { error: `Limite de ${cfg.dailyLimit} análises nas últimas 24 horas atingido. Tente mais tarde.` });
    }
    const id = newRequestId();
    const d = await github(cfg, `/repos/${cfg.repo}/actions/workflows/${WORKFLOW_FILE}/dispatches`, {
      method: "POST",
      body: JSON.stringify({ ref: cfg.ref, inputs: { target_url: target.url, payload: sealCreds({ user: user.value, pass: pass.value }, cfg.key), request_id: id } }),
    });
    if (d.status !== 204 && d.status !== 200) throw new Error(`disparar workflow: ${d.status}`);
    return send(res, 202, { id, token: signToken(id, cfg.key), url: target.url });
  } catch (e) {
    console.error("analyze:", e.message);
    return send(res, 502, { error: "Não foi possível iniciar a análise agora. Tente de novo em alguns minutos." });
  }
}
