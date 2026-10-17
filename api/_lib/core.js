// Núcleo das funções web (Vercel) e do workflow de análise. JavaScript puro (ESM) para rodar igual
// na Vercel, no GitHub Actions e nos testes, sem etapa de build.
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

export const WORKFLOW_FILE = "explore-web.yml";
export const runTitle = (id) => `explore ${id}`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const isRequestId = (id) => typeof id === "string" && UUID.test(id);
export const newRequestId = () => randomUUID();

const PRIVATE_V4 = [/^10\./, /^127\./, /^0\./, /^169\.254\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./, /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./];

/** Aceita só sites públicos em http(s): nada de localhost, IPs privados, nomes internos ou credenciais na URL. */
export function validateTarget(raw) {
  if (typeof raw !== "string" || !raw.trim() || raw.length > 2048) return { ok: false, error: "Informe a URL do site, começando com https://." };
  let u;
  try {
    u = new URL(raw.trim());
  } catch {
    return { ok: false, error: "URL inválida. Use o endereço completo, como https://app.exemplo.com." };
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return { ok: false, error: "Use uma URL http ou https." };
  if (u.username || u.password) return { ok: false, error: "Não coloque usuário e senha na URL; use os campos de login." };
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const internal =
    host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") || !host.includes(".") ||
    PRIVATE_V4.some((re) => re.test(host)) || host.includes(":");
  if (internal) return { ok: false, error: "Só é possível analisar sites públicos na internet." };
  u.hash = "";
  return { ok: true, url: u.href };
}

/** Usuário e senha do site analisado: texto curto, sem quebra de linha (vão para variáveis de ambiente). */
export function validateCred(v, label) {
  if (v === undefined || v === null || v === "") return { ok: true, value: "" };
  if (typeof v !== "string" || v.length > 256 || /[\r\n\0]/.test(v)) return { ok: false, error: `${label} inválido.` };
  return { ok: true, value: v };
}

const keyOf = (secret) => createHash("sha256").update(String(secret)).digest();

/** Cifra as credenciais (AES-256-GCM) para que não apareçam nos inputs visíveis do workflow. */
export function sealCreds(creds, secret) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", keyOf(secret), iv);
  const body = Buffer.concat([c.update(JSON.stringify({ user: creds.user ?? "", pass: creds.pass ?? "" }), "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), body]).toString("base64url");
}

export function openCreds(sealed, secret) {
  const buf = Buffer.from(String(sealed), "base64url");
  if (buf.length < 29) throw new Error("payload inválido");
  const d = createDecipheriv("aes-256-gcm", keyOf(secret), buf.subarray(0, 12));
  d.setAuthTag(buf.subarray(12, 28));
  const json = Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString("utf8");
  const o = JSON.parse(json);
  return { user: String(o.user ?? ""), pass: String(o.pass ?? "") };
}

const hmac = (secret, data) => createHmac("sha256", keyOf(secret)).update(data).digest("base64url");
const same = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
};

/** Token de leitura do resultado: só quem disparou a análise consegue ver o relatório. */
export function signToken(id, secret, ttlSec = 3 * 24 * 3600, now = Date.now()) {
  const exp = Math.floor(now / 1000) + ttlSec;
  return `${exp}.${hmac(secret, `${id}.${exp}`)}`;
}

export function verifyToken(id, token, secret, now = Date.now()) {
  if (!isRequestId(id) || typeof token !== "string") return false;
  const [exp, sig] = token.split(".");
  if (!/^\d+$/.test(exp ?? "") || !sig) return false;
  if (Number(exp) * 1000 < now) return false;
  return same(sig, hmac(secret, `${id}.${exp}`));
}

/** Compara o código digitado com a lista de códigos válidos (separados por vírgula), em tempo constante. */
export function checkCode(code, codesCsv) {
  if (typeof code !== "string" || !code.trim()) return false;
  const codes = String(codesCsv ?? "").split(",").map((c) => c.trim()).filter((c) => c.length >= 6);
  const h = (s) => createHash("sha256").update(s).digest();
  return codes.some((c) => timingSafeEqual(h(c), h(code.trim())));
}

export const findRun = (runs, id) => (runs ?? []).find((r) => r.display_title === runTitle(id) || r.name === runTitle(id));
export const recentRuns = (runs, now = Date.now(), windowMs = 24 * 3600 * 1000) =>
  (runs ?? []).filter((r) => r.display_title?.startsWith("explore ") && now - Date.parse(r.created_at) < windowMs).length;

/** Arquivos do relatório que podem ser servidos a partir do artefato. */
export const isReportFile = (p) =>
  p === "relatorio.html" || (/^img\/[A-Za-z0-9_.-]+(\/[A-Za-z0-9_.-]+)*\.jpg$/.test(p ?? "") && !p.split("/").some((seg) => /^\.+$/.test(seg)));

/** Acha um arquivo no zip do artefato (o relatório fica em <runId>/…). */
export function pickFromZip(entries, file) {
  const names = Object.keys(entries);
  const report = names.find((n) => n === "relatorio.html" || n.endsWith("/relatorio.html"));
  const base = report ? report.slice(0, report.length - "relatorio.html".length) : "";
  const name = file === "erro.txt" ? names.find((n) => n === "erro.txt") : `${base}${file}`;
  return name && entries[name] ? entries[name] : undefined;
}

/** Troca os caminhos relativos das imagens por URLs da função de relatório. */
export const rewriteImages = (html, id, token) =>
  html.replace(/src="img\//g, `src="/api/report?id=${encodeURIComponent(id)}&t=${encodeURIComponent(token)}&file=img/`);

export function config(env = process.env) {
  const missing = ["QA_GITHUB_TOKEN", "QA_GITHUB_REPO", "QA_INPUT_KEY", "QA_ACCESS_CODES"].filter((k) => !env[k]);
  return {
    missing,
    token: env.QA_GITHUB_TOKEN,
    repo: env.QA_GITHUB_REPO,
    ref: env.QA_GITHUB_REF || "main",
    key: env.QA_INPUT_KEY,
    codes: env.QA_ACCESS_CODES,
    dailyLimit: Number(env.QA_DAILY_LIMIT || 10),
    api: env.QA_GITHUB_API || "https://api.github.com",
  };
}

export async function github(cfg, path, init = {}, doFetch = fetch) {
  const res = await doFetch(`${cfg.api}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "qa-agent-web",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
  });
  return res;
}

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
