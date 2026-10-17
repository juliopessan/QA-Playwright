import { exaKey, send } from "./_lib/core.js";
import { REVIEW_MODEL } from "./_lib/review.js";

/**
 * GET /api/health: diz se a análise está configurada nesta implantação. Só nomes e booleanos,
 * nunca valores. Nomes parecidos ajudam a achar erro de grafia (ex.: "EXA_KEY" em vez de "EXA_API_KEY").
 */
export function health(env = process.env) {
  const similar = Object.keys(env).filter((k) => /exa|anthropic|claude/i.test(k)).sort();
  return {
    ready: Boolean(exaKey(env)),
    exa: Boolean(exaKey(env)),
    anthropic: Boolean(env.ANTHROPIC_API_KEY),
    model: REVIEW_MODEL,
    similarVariables: similar,
    environment: env.VERCEL_ENV ?? "local",
    commit: (env.VERCEL_GIT_COMMIT_SHA ?? "").slice(0, 7) || undefined,
  };
}

export default function handler(req, res) {
  if (req.method !== "GET") return send(res, 405, { error: "Use GET." }, { Allow: "GET" });
  return send(res, 200, health());
}
