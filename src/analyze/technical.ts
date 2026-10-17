import { makeFinding } from "../explore/findings.js";
import type { Collected } from "../explore/collect.js";
import type { Finding, Severity } from "../explore/types.js";

export interface ScreenRef {
  id: string;
  routePattern: string;
  path: string[];
}

const BLOCKED = /ERR_BLOCKED_BY_CLIENT/;

const pathOf = (url: string): string => {
  try {
    const u = new URL(url);
    return u.pathname;
  } catch {
    return url;
  }
};

const statusSeverity = (status: number, isDocument: boolean, resourceType: string): Severity => {
  if (status >= 500) return "high";
  if (isDocument) return "medium";
  if (resourceType === "image" || resourceType === "stylesheet" || resourceType === "font") return "low";
  return "medium";
};

/** Erros de console, exceções, respostas ≥ 400 e falhas de rede de uma tela viram achados técnicos. */
export function technicalFindings(screen: ScreenRef, c: Collected): Finding[] {
  const out: Finding[] = [];
  const repro = screen.path;

  for (const msg of c.pageErrors) {
    out.push(
      makeFinding({
        category: "technical", severity: "high", origin: "measured", scope: "global", screenId: screen.id,
        title: `Exceção JavaScript não tratada: ${msg.slice(0, 120)}`,
        description: `A página lançou uma exceção que não foi capturada: ${msg}`,
        rule: `pageerror ${msg}`, evidence: [`Exceção: ${msg}`], reproduction: repro,
        suggestion: "Tratar o erro ou corrigir a referência indefinida; erros não tratados costumam quebrar a interface.",
      }),
    );
  }

  for (const msg of c.consoleErrors) {
    if (BLOCKED.test(msg) || /^Failed to load resource/i.test(msg)) continue; // já coberto pelas respostas e falhas de rede
    out.push(
      makeFinding({
        category: "technical", severity: "medium", origin: "measured", scope: "global", screenId: screen.id,
        title: `Erro no console: ${msg.slice(0, 120)}`,
        description: `A página registrou um erro no console: ${msg}`,
        rule: `console ${msg}`, evidence: [`console.error: ${msg}`], reproduction: repro,
      }),
    );
  }

  for (const r of c.responses) {
    const path = pathOf(r.url);
    const doc = r.isDocument;
    out.push(
      makeFinding({
        category: "technical", severity: statusSeverity(r.status, doc, r.resourceType), origin: "measured",
        scope: doc ? "screen" : "global", screenId: screen.id,
        title: doc ? `HTTP ${r.status} ao abrir a tela` : `HTTP ${r.status} em ${r.method} ${path}`,
        description: doc
          ? `A própria página respondeu com status ${r.status}.`
          : `A requisição ${r.method} ${path} respondeu com status ${r.status}.`,
        rule: doc ? `http ${r.status} documento` : `http ${r.status} ${r.method} ${path}`,
        evidence: [`${r.method} ${r.url} → ${r.status}`], reproduction: repro,
        suggestion: r.status >= 500 ? "Investigar o erro no servidor (logs da API)." : undefined,
      }),
    );
  }

  for (const f of c.failedRequests) {
    if (f.error && BLOCKED.test(f.error)) continue; // bloqueada por nossa guarda somente leitura
    const path = pathOf(f.url);
    out.push(
      makeFinding({
        category: "technical", severity: "medium", origin: "measured", scope: "global", screenId: screen.id,
        title: `Requisição falhou: ${f.method} ${path}`,
        description: `A requisição ${f.method} ${f.url} falhou (${f.error ?? "erro de rede"}).`,
        rule: `requestfailed ${f.method} ${path} ${f.error ?? ""}`,
        evidence: [`${f.method} ${f.url}: ${f.error ?? "falha"}`], reproduction: repro,
      }),
    );
  }
  return out;
}
