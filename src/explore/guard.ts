import type { BrowserContext } from "playwright";
import type { BlockedAttempt } from "./types.js";

const WRITE_VERBS = [
  // português
  "salvar", "gravar", "excluir", "apagar", "remover", "deletar", "enviar", "confirmar", "pagar", "comprar",
  "assinar", "convidar", "publicar", "arquivar", "cancelar", "aprovar", "rejeitar", "criar", "adicionar",
  // inglês
  "save", "delete", "remove", "send", "submit", "confirm", "pay", "buy", "subscribe", "invite", "publish",
  "archive", "cancel", "approve", "reject", "create", "add",
];

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Verdadeiro se o rótulo contém um verbo que costuma alterar dados (comparação por palavra inteira). */
export function isWriteLabel(name: string, extra: string[] = []): boolean {
  const words = new Set(norm(name).split(/[^a-z0-9]+/).filter(Boolean));
  return [...WRITE_VERBS, ...extra.map(norm)].some((v) => words.has(v));
}

export interface ClickCandidate {
  name: string;
  role: string;
  type?: string;
  inForm?: boolean;
  /** Marcado pelo Aprofundador como elemento que revela conteúdo sem alterar dados. */
  revealing?: boolean;
}

const NAVIGATION_ROLES = new Set(["link", "tab", "menuitem"]);

/** Camada 1 da guarda: decide se um elemento pode ser clicado durante a exploração. Na dúvida, não clica. */
export function shouldClick(el: ClickCandidate, extraVerbs: string[] = []): { allow: boolean; reason?: string } {
  if (isWriteLabel(el.name, extraVerbs)) return { allow: false, reason: `rótulo de escrita: "${el.name}"` };
  if (el.type === "submit") return { allow: false, reason: "botão de envio (type=submit)" };
  if (el.inForm && !NAVIGATION_ROLES.has(el.role)) return { allow: false, reason: "botão dentro de formulário" };
  if (NAVIGATION_ROLES.has(el.role)) return { allow: true };
  if (el.revealing) return { allow: true };
  return { allow: false, reason: "botão não marcado como revelador de conteúdo" };
}

export interface NetworkGuardOptions {
  /** Rotas (prefixo) em que `POST` é permitido (busca, telemetria). */
  postAllowed?: string[];
  onBlock?: (b: BlockedAttempt) => void;
}

interface GraphQlCheck {
  isGraphQl: boolean;
  mutation: boolean;
}

function checkGraphQl(body: string | null | undefined): GraphQlCheck {
  if (!body) return { isGraphQl: false, mutation: false };
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { isGraphQl: false, mutation: false };
  }
  const ops = Array.isArray(parsed) ? parsed : [parsed];
  let isGraphQl = false;
  let mutation = false;
  for (const op of ops) {
    const q = (op as { query?: unknown } | null)?.query;
    if (typeof q !== "string") continue;
    isGraphQl = true;
    const cleaned = q.replace(/#.*$/gm, "");
    if (/(^|[}\s])mutation\b/.test(cleaned)) mutation = true;
  }
  return { isGraphQl, mutation };
}

/** Camada 2 da guarda: bloqueia na rede qualquer requisição que possa alterar dados. */
export async function installNetworkGuard(
  context: BrowserContext,
  opts: NetworkGuardOptions = {},
): Promise<{ blocked: BlockedAttempt[] }> {
  const blocked: BlockedAttempt[] = [];
  const allowed = opts.postAllowed ?? [];
  await context.route("**/*", (route) => {
    const req = route.request();
    const method = req.method().toUpperCase();
    if (method === "GET" || method === "HEAD" || method === "OPTIONS") return route.fallback();

    let reason: string | undefined;
    if (method === "POST") {
      const gql = checkGraphQl(req.postData());
      if (gql.isGraphQl) {
        if (gql.mutation) reason = "GraphQL mutation bloqueada";
      } else {
        let path = req.url();
        try {
          path = new URL(req.url()).pathname;
        } catch {
          /* mantém a URL */
        }
        if (!allowed.some((p) => path.startsWith(p))) reason = "POST fora de postPermitidos";
      }
    } else {
      reason = `${method} é sempre bloqueado na exploração`;
    }
    if (!reason) return route.fallback();

    const attempt: BlockedAttempt = { layer: "network", reason, url: req.url(), method };
    blocked.push(attempt);
    opts.onBlock?.(attempt);
    return route.abort("blockedbyclient");
  });
  return { blocked };
}
