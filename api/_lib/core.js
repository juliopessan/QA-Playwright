// Utilitários das funções web (Vercel). JavaScript puro (ESM): roda igual na Vercel e nos testes.

const PRIVATE_V4 = [/^10\./, /^127\./, /^0\./, /^169\.254\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./, /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, /^22[4-9]\./, /^2[3-5]\d\./];

/** Endereço IP de rede privada, local ou reservada (não deve ser acessado a partir do servidor). */
export function isPrivateAddress(ip) {
  const a = String(ip).toLowerCase();
  if (a.includes(":")) {
    const v4 = /::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(a);
    if (v4) return isPrivateAddress(v4[1]);
    return a === "::" || a === "::1" || /^f[cd]/.test(a) || /^fe[89ab]/.test(a);
  }
  return PRIVATE_V4.some((re) => re.test(a));
}

/** Aceita só sites públicos em http(s): nada de localhost, IPs, nomes internos ou credenciais na URL. */
export function validateTarget(raw) {
  if (typeof raw !== "string" || !raw.trim() || raw.length > 2048) return { ok: false, error: "Informe a URL do site, como https://app.exemplo.com." };
  let text = raw.trim();
  if (!/^[a-z][a-z0-9+.-]*:/i.test(text)) text = `https://${text}`;
  let u;
  try {
    u = new URL(text);
  } catch {
    return { ok: false, error: "URL inválida. Use o endereço completo, como https://app.exemplo.com." };
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return { ok: false, error: "Use uma URL http ou https." };
  if (u.username || u.password) return { ok: false, error: "Não coloque usuário e senha na URL." };
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const ipLiteral = /^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(":");
  const internal = host === "localhost" || /\.(localhost|local|internal|lan|home|corp)$/.test(host) || !host.includes(".") || ipLiteral;
  if (internal) return { ok: false, error: "Só é possível analisar sites públicos, pelo nome de domínio." };
  u.hash = "";
  return { ok: true, url: u.href };
}

/** Limite por IP em memória (por instância): protege o custo sem guardar dados de quem usa. */
export function makeLimiter({ max = 5, windowMs = 10 * 60 * 1000 } = {}) {
  const hits = new Map();
  return (key, now = Date.now()) => {
    const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
    if (recent.length >= max) {
      hits.set(key, recent);
      return { ok: false, retryInSec: Math.ceil((windowMs - (now - recent[0])) / 1000) };
    }
    recent.push(now);
    hits.set(key, recent);
    if (hits.size > 5000) hits.clear();
    return { ok: true };
  };
}

export const clientIp = (req) => String(req.headers?.["x-forwarded-for"] ?? req.headers?.["x-real-ip"] ?? "anon").split(",")[0].trim();

export function send(res, status, body, headers = {}) {
  res.statusCode = status;
  for (const [k, v] of Object.entries({ "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers })) res.setHeader(k, v);
  res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

export function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  try {
    return JSON.parse(req.body ?? "{}");
  } catch {
    return {};
  }
}

const norm = (s) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();

/** A evidência citada pelo modelo precisa existir no texto das páginas (comparação tolerante a acentos e espaços). */
export function evidenceFound(evidence, pages) {
  const e = norm(evidence).replace(/^["'“”]+|["'“”.…]+$/g, "");
  if (e.length < 4) return false;
  return pages.some((p) => norm(`${p.title ?? ""} ${p.text ?? ""}`).includes(e));
}

/** Chave do Exa: o nome documentado é EXA_API_KEY; EXA_API também é aceito (nome usado no painel da Vercel). */
export const exaKey = (env) => env.EXA_API_KEY || env.EXA_API || "";
