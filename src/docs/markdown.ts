import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { compareRuns, severityRank } from "../explore/findings.js";
import { renderHtmlReport } from "./html-report.js";
import type { BlockedAttempt, Category, ExploreResult, Finding, FlowRecord, Screen, Severity } from "../explore/types.js";

const SEV_LABEL: Record<Severity, string> = { critical: "Crítica", high: "Alta", medium: "Média", low: "Baixa" };
const SEV_TAG: Record<Severity, string> = { critical: "CRÍTICA", high: "ALTA", medium: "MÉDIA", low: "BAIXA" };
const CAT_LABEL: Record<Category, string> = { technical: "Técnico", accessibility: "Acessibilidade", performance: "Desempenho", ux: "UX", coverage: "Cobertura" };

const STATUS_LABEL: Record<FlowRecord["status"], string> = { pass: "Aprovado", fail: "Reprovado", "needs-review": "Requer revisão", blocked: "Bloqueado" };

const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();
const cell = (s: string) => oneLine(s).replace(/\|/g, "\\|");
const sorted = (fs: Finding[]) =>
  [...fs].sort((a, b) => severityRank(b.severity) - severityRank(a.severity) || a.category.localeCompare(b.category) || a.title.localeCompare(b.title));

const link = (f: Finding, screens: Screen[]) => {
  const target = screens.find((s) => f.screenIds.includes(s.id))?.id ?? f.screenIds[0];
  return `telas/${target}.md#${f.id}`;
};

function findingLine(f: Finding, screens: Screen[], tag?: string): string {
  const where = f.screenIds.length > 3 ? `${f.screenIds.slice(0, 3).join(", ")} +${f.screenIds.length - 3}` : f.screenIds.join(", ");
  return `- [ ] **${SEV_TAG[f.severity]}** · ${oneLine(f.title)} · \`${f.id}\`${tag ? ` · ${tag}` : ""} · telas: ${where} · [detalhes](${link(f, screens)})`;
}

function readme(r: ExploreResult, findings: Finding[], previous?: Finding[]): string {
  const bySev = (s: Severity) => findings.filter((f) => f.severity === s).length;
  const states = r.screens.reduce((n, s) => n + s.states.length, 0);
  const L: string[] = [];
  L.push(`# Relatório de QA — ${r.baseUrl}`, "");
  L.push(`- **Run:** \`${r.runId}\``, `- **Início:** ${r.startedAt}${r.finishedAt ? ` · **Fim:** ${r.finishedAt}` : ""}`);
  L.push(`- **Cobertura:** ${r.screens.length} telas (+ ${states} subestados), ${r.blocked.length} ações bloqueadas pelo modo somente leitura`);
  if (r.limitsHit.length) L.push(`- **Limites atingidos:** ${r.limitsHit.join(", ")} (a exploração foi interrompida)`);
  L.push(`- **LLM:** ${r.llm.calls} chamadas, ${r.llm.inputTokens} tokens de entrada, ${r.llm.outputTokens} de saída`, "");

  L.push("## Resumo dos achados", "");
  if (findings.length === 0) L.push("Nenhum achado nesta execução.", "");
  else {
    L.push("| Gravidade | Qtde |", "|---|---|");
    for (const s of ["critical", "high", "medium", "low"] as Severity[]) L.push(`| ${SEV_LABEL[s]} | ${bySev(s)} |`);
    L.push("");
    const cats = (Object.keys(CAT_LABEL) as Category[]).map((c) => [c, findings.filter((f) => f.category === c).length] as const).filter(([, n]) => n > 0);
    L.push(`Por categoria: ${cats.map(([c, n]) => `${CAT_LABEL[c]} ${n}`).join(" · ")}`, "");
  }

  if (previous) {
    const c = compareRuns(previous, findings);
    L.push("## O que mudou desde o último run", "");
    const list = (title: string, fs: Finding[]) => {
      L.push(`### ${title} (${fs.length})`, "");
      for (const f of sorted(fs).slice(0, 15)) L.push(`- **${SEV_TAG[f.severity]}** · ${oneLine(f.title)} · \`${f.id}\``);
      L.push("");
    };
    list("Novos", c.new);
    list("Persistentes", c.persistent);
    list("Resolvidos", c.resolved);
  }

  if (r.flows?.length) {
    L.push("## Fluxos-objetivo", "", "| Fluxo | Resultado |", "|---|---|");
    for (const f of r.flows) L.push(`| [${cell(f.title)}](fluxos/${f.id}.md) | ${STATUS_LABEL[f.status]} |`);
    L.push("");
  }

  if (findings.length) {
    L.push("## Principais achados", "");
    for (const f of sorted(findings).slice(0, 10)) L.push(`- **${SEV_TAG[f.severity]}** · ${oneLine(f.title)} · [detalhes](${link(f, r.screens)})`);
    L.push("");
  }
  L.push("## Arquivos", "", "- [`achados.md`](achados.md): todos os achados, com checkbox de aprovação para virar issue", "- [`mapa.md`](mapa.md): mapa de telas e navegação", "- [`cobertura.md`](cobertura.md): o que foi e o que não foi explorado", "- `telas/`: uma página por tela, com screenshots e análises", "- `fluxos/`: passo a passo de cada fluxo-objetivo (quando houver)", "- `dados/`: `achados.json` e `manifest.json`", "");
  return L.join("\n");
}

function achados(r: ExploreResult, findings: Finding[], previous?: Finding[]): string {
  const L = ["# Achados", "", "Marque `[x]` nos achados que merecem uma issue e rode `qa-agent issues`.", ""];
  if (findings.length === 0) return [...L, "Nenhum achado nesta execução.", ""].join("\n");
  const prevIds = new Set((previous ?? []).map((f) => f.id));
  for (const s of ["critical", "high", "medium", "low"] as Severity[]) {
    const group = sorted(findings.filter((f) => f.severity === s));
    if (!group.length) continue;
    L.push(`## ${SEV_LABEL[s]} (${group.length})`, "");
    for (const f of group) L.push(findingLine(f, r.screens, previous ? (prevIds.has(f.id) ? "persistente" : "novo") : undefined));
    L.push("");
  }
  return L.join("\n");
}

function findingDetail(f: Finding): string {
  const L = [`<a id="${f.id}"></a>`, `### **${SEV_TAG[f.severity]}** · ${CAT_LABEL[f.category]} · ${oneLine(f.title)}`, ""];
  if (f.origin === "agent") L.push(`> Opinião do agente${f.confidence !== undefined ? ` (confiança ${Math.round(f.confidence * 100)}%)` : ""}: não é uma medição objetiva.`, "");
  L.push(f.description, "");
  if (f.evidence.length) L.push("**Evidências**", "", ...f.evidence.map((e) => `- ${oneLine(e)}`), "");
  if (f.reproduction.length) L.push("**Como reproduzir**", "", ...f.reproduction.map((p, i) => `${i + 1}. ${p}`), "");
  if (f.suggestion) L.push(`**Sugestão:** ${oneLine(f.suggestion)}`, "");
  L.push(`\`id: ${f.id}\`${f.screenIds.length > 1 ? ` · afeta: ${f.screenIds.join(", ")}` : ""}`, "");
  return L.join("\n");
}

function screenPage(s: Screen, findings: Finding[]): string {
  const mine = sorted(findings.filter((f) => f.screenIds.includes(s.id)));
  const L = [`# ${oneLine(s.heading || s.title || s.routePattern)}`, ""];
  L.push(`- **Rota:** \`${s.routePattern}\``, `- **Exemplos visitados:** ${s.exampleUrls.map((u) => `\`${u}\``).join(", ")}`, `- **Caminho:** ${s.path.join(" › ")}`, "");
  if (s.screenshot) L.push(`![${oneLine(s.heading || s.id)}](../${s.screenshot})`, "");
  if (s.states.length) {
    L.push("## Subestados", "");
    for (const st of s.states) L.push(`### ${oneLine(st.label)}`, "", `![${oneLine(st.label)}](../${st.screenshot})`, "");
  }
  L.push(`## Achados (${mine.length})`, "");
  if (mine.length === 0) L.push("Nenhum achado nesta tela.", "");
  for (const f of mine) L.push(findingDetail(f));
  return L.join("\n");
}

function flowPage(f: FlowRecord): string {
  const L = [`# Fluxo: ${oneLine(f.title)}`, "", `**Resultado:** ${STATUS_LABEL[f.status]}`, "", `**Objetivo:** ${oneLine(f.goal)}`, "", `**Critério de sucesso:** ${oneLine(f.success)}`, "", `**Parecer:** ${oneLine(f.reasoning)}`, ""];
  if (f.screenIds.length) L.push(`**Telas visitadas:** ${f.screenIds.map((id) => `[${id}](../telas/${id}.md)`).join(", ")}`, "");
  L.push("## Passo a passo", "");
  if (f.steps.length === 0) L.push("Nenhuma ação foi executada.", "");
  for (const s of f.steps) {
    L.push(`### ${s.stepIndex}. ${oneLine(s.text ?? "")} (${s.status})`, "");
    if (s.error) L.push(`Erro: ${oneLine(s.error)}`, "");
    if (s.screenshotBefore) L.push(`Antes: ![antes](../${s.screenshotBefore})`, "");
    if (s.screenshotAfter) L.push(`Depois: ![depois](../${s.screenshotAfter})`, "");
  }
  return L.join("\n");
}

const mermaidId = (id: string) => {
  const s = id.replace(/[^a-zA-Z0-9_]/g, "_");
  return s === "end" ? "end_" : s;
};
const mermaidLabel = (s: string) => oneLine(s).replace(/"/g, "'").replace(/[\[\]{}]/g, (c) => ({ "[": "(", "]": ")", "{": "(", "}": ")" })[c]!);

function mapa(r: ExploreResult): string {
  const L = ["# Mapa do SaaS", "", "```mermaid", "graph LR"];
  for (const s of r.screens) L.push(`  ${mermaidId(s.id)}["${mermaidLabel(s.heading || s.routePattern)}<br/>${mermaidLabel(s.routePattern)}"]`);
  for (const [a, b] of r.edges) L.push(`  ${mermaidId(a)} --> ${mermaidId(b)}`);
  L.push("```", "");
  return L.join("\n");
}

function cobertura(r: ExploreResult): string {
  const L = ["# Cobertura", ""];
  L.push(`Telas exploradas: **${r.screens.length}**. Subestados: **${r.screens.reduce((n, s) => n + s.states.length, 0)}**.`, "");
  L.push("## Limites atingidos", "", r.limitsHit.length ? r.limitsHit.map((l) => `- \`${l}\``).join("\n") : "Nenhum.", "");
  L.push("## Ações bloqueadas pelo modo somente leitura", "");
  if (r.blocked.length === 0) L.push("Nenhuma.", "");
  else {
    L.push("| Camada | Tela | Alvo | Motivo |", "|---|---|---|---|");
    const target = (b: BlockedAttempt) => (b.layer === "network" ? `${b.method ?? ""} ${b.url ?? ""}` : `${b.element ?? ""}`);
    for (const b of r.blocked) L.push(`| ${b.layer === "network" ? "rede" : "elemento"} | ${cell(b.screenId ?? "—")} | ${cell(target(b))} | ${cell(b.reason)} |`);
    L.push("", "Estas ações não foram executadas por segurança. Fluxos que precisam delas devem ser descritos em `objetivos.md`.", "");
  }
  L.push("## Links e URLs ignorados", "");
  if (r.skipped.length === 0) L.push("Nenhum.", "");
  else {
    const groups = new Map<string, string[]>();
    for (const s of r.skipped) groups.set(s.reason, [...(groups.get(s.reason) ?? []), s.url]);
    for (const [reason, urls] of groups) L.push(`- **${reason}** (${urls.length}): ${urls.slice(0, 5).map((u) => `\`${u}\``).join(", ")}${urls.length > 5 ? ", …" : ""}`);
    L.push("");
  }
  if (r.llm.notes.length) L.push("## Observações da execução", "", ...r.llm.notes.map((n) => `- ${oneLine(n)}`), "");
  return L.join("\n");
}

export interface WriteDocsOptions {
  /** Achados do run anterior: habilita "o que mudou" e preserva números de issues. */
  previous?: Finding[];
}

/** Gera a pasta Markdown de revisão (README, achados, mapa, cobertura, telas e dados) e o relatorio.html. */
export function writeDocs(r: ExploreResult, outDir: string, opts: WriteDocsOptions = {}): void {
  for (const d of ["telas", "dados", "img", ...(r.flows?.length ? ["fluxos"] : [])]) mkdirSync(join(outDir, d), { recursive: true });
  const issueById = new Map((opts.previous ?? []).filter((f) => f.issue !== undefined).map((f) => [f.id, f.issue!]));
  const findings = r.findings.map((f) => (issueById.has(f.id) ? { ...f, issue: issueById.get(f.id) } : f));

  const put = (rel: string, body: string) => writeFileSync(join(outDir, rel), body, "utf8");
  put("README.md", readme(r, findings, opts.previous));
  put("achados.md", achados(r, findings, opts.previous));
  put("mapa.md", mapa(r));
  put("cobertura.md", cobertura(r));
  for (const s of r.screens) put(`telas/${s.id}.md`, screenPage(s, findings));
  for (const f of r.flows ?? []) put(`fluxos/${f.id}.md`, flowPage(f));
  put("dados/achados.json", JSON.stringify(sorted(findings), null, 2));
  put("relatorio.html", renderHtmlReport({ ...r, findings }));
  put(
    "dados/manifest.json",
    JSON.stringify(
      {
        runId: r.runId, baseUrl: r.baseUrl, startedAt: r.startedAt, finishedAt: r.finishedAt,
        screens: r.screens.map((s) => ({ id: s.id, routePattern: s.routePattern, heading: s.heading, examples: s.exampleUrls.length, states: s.states.length })),
        flows: (r.flows ?? []).map((f) => ({ id: f.id, title: f.title, status: f.status })),
        counts: { screens: r.screens.length, findings: findings.length, blocked: r.blocked.length },
        limitsHit: r.limitsHit, llm: r.llm,
      },
      null,
      2,
    ),
  );
}
