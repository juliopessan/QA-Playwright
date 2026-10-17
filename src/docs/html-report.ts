import { severityRank } from "../explore/findings.js";
import type { Category, ExploreResult, Finding, Screen, Severity } from "../explore/types.js";

const SEV: Record<Severity, string> = { critical: "Crítica", high: "Alta", medium: "Média", low: "Baixa" };
const CAT: Record<Category, string> = { technical: "Técnico", accessibility: "Acessibilidade", performance: "Desempenho", ux: "UX", coverage: "Cobertura" };
const FLOW: Record<string, string> = { pass: "Aprovado", fail: "Reprovado", "needs-review": "Requer revisão", blocked: "Bloqueado" };

/** Todo texto vem do site analisado (não confiável): sempre escapado. */
const esc = (s: unknown): string =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
/** Só caminhos de imagem gerados pelo próprio agente (img/…jpg). */
const img = (p: string | undefined, alt: string) =>
  p && /^img\/[A-Za-z0-9/_.-]+\.jpg$/.test(p) ? `<img loading="lazy" src="${esc(p)}" alt="${esc(alt)}">` : "";

const sorted = (fs: Finding[]) =>
  [...fs].sort((a, b) => severityRank(b.severity) - severityRank(a.severity) || a.category.localeCompare(b.category) || a.title.localeCompare(b.title));

function finding(f: Finding, screens: Screen[]): string {
  const names = f.screenIds.map((id) => screens.find((s) => s.id === id)?.heading || id);
  return `<article class="f" id="f-${esc(f.id)}">
  <header><span class="sev sev--${f.severity}">${SEV[f.severity]}</span><span class="cat">${CAT[f.category]}</span>${f.origin === "agent" ? `<span class="tag">opinião do agente${f.confidence !== undefined ? ` · ${Math.round(f.confidence * 100)}%` : ""}</span>` : ""}<code>${esc(f.id)}</code></header>
  <h3>${esc(f.title)}</h3>
  <p>${esc(f.description)}</p>
  ${f.evidence.length ? `<h4>Evidências</h4><ul>${f.evidence.map((e) => `<li>${esc(e)}</li>`).join("")}</ul>` : ""}
  ${f.reproduction.length ? `<h4>Como reproduzir</h4><ol>${f.reproduction.map((r) => `<li>${esc(r)}</li>`).join("")}</ol>` : ""}
  ${f.suggestion ? `<p><strong>Sugestão:</strong> ${esc(f.suggestion)}</p>` : ""}
  <p class="meta">Telas: ${names.map(esc).join(", ")}</p>
</article>`;
}

function screen(s: Screen, findings: Finding[]): string {
  const n = findings.filter((f) => f.screenIds.includes(s.id)).length;
  return `<article class="s" id="s-${esc(s.id)}">
  <header><h3>${esc(s.heading || s.title || s.routePattern)}</h3><code>${esc(s.routePattern)}</code><span class="meta">${n} achado${n === 1 ? "" : "s"}</span></header>
  <p class="meta">Caminho: ${s.path.map(esc).join(" › ")}</p>
  ${img(s.screenshot, s.heading || s.id)}
  ${s.states.map((st) => `<figure>${img(st.screenshot, st.label)}<figcaption>${esc(st.label)}</figcaption></figure>`).join("")}
</article>`;
}

function flow(f: NonNullable<ExploreResult["flows"]>[number]): string {
  return `<article class="s" id="fluxo-${esc(f.id)}">
  <header><h3>${esc(f.title)}</h3><span class="sev${f.status === "pass" ? "" : " sev--high"}">${FLOW[f.status] ?? esc(f.status)}</span></header>
  <p><strong>Objetivo:</strong> ${esc(f.goal)}</p>
  <p><strong>Critério de sucesso:</strong> ${esc(f.success)}</p>
  <p class="meta">${esc(f.reasoning)}</p>
  ${f.steps
    .map(
      (st) => `<h4>${st.stepIndex}. ${esc(st.text ?? "")} <span class="meta">(${esc(st.status)})</span></h4>
  ${st.error ? `<p>${esc(st.error)}</p>` : ""}
  <div class="pair">${st.screenshotBefore ? `<figure>${img(st.screenshotBefore, "antes")}<figcaption>Antes</figcaption></figure>` : ""}${st.screenshotAfter ? `<figure>${img(st.screenshotAfter, "depois")}<figcaption>Depois</figcaption></figure>` : ""}</div>`,
    )
    .join("\n")}
</article>`;
}

/** Relatório em HTML único (abre direto no navegador). As imagens ficam em `img/`, ao lado do arquivo. */
export function renderHtmlReport(r: ExploreResult): string {
  const fs = sorted(r.findings);
  const count = (s: Severity) => fs.filter((f) => f.severity === s).length;
  const states = r.screens.reduce((n, s) => n + s.states.length, 0);
  const groups = (["critical", "high", "medium", "low"] as Severity[])
    .map((s) => [s, fs.filter((f) => f.severity === s)] as const)
    .filter(([, g]) => g.length);
  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Relatório QA Agent · ${esc(new URL(r.baseUrl).host)}</title>
<style>
:root{--paper:#F1EEE5;--paper-2:#E7E3D7;--ink:#17140F;--soft:#5C564B;--line:#CFC9BA;--orange:#A8460F;--mint:#2F7454;color-scheme:light}
@media (prefers-color-scheme:dark){:root{--paper:#151310;--paper-2:#1F1C17;--ink:#EDE9DE;--soft:#B3AC9E;--line:#3A352D;--orange:#E07A3C;--mint:#7EC8A1;color-scheme:dark}}
*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.55 Archivo,Arial,sans-serif}
main{max-width:1080px;margin:0 auto;padding:32px max(16px,env(safe-area-inset-left))}
h1{font-size:clamp(26px,4vw,40px);line-height:1.1;margin:0 0 8px}h2{margin:48px 0 16px;font-size:24px;border-top:1px solid var(--ink);padding-top:16px}
h3{margin:8px 0;font-size:18px}h4{margin:12px 0 4px;font-size:14px}code,.meta,.sev,.cat,.tag{font-family:"IBM Plex Mono",Menlo,monospace;font-size:12px}
.meta{color:var(--soft)}.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:1px;background:var(--ink);border:1px solid var(--ink);margin:24px 0}
.kpis div{background:var(--paper);padding:16px}.kpis b{display:block;font-size:30px;font-variant-numeric:tabular-nums}
.f,.s{border:1px solid var(--line);padding:16px;margin:0 0 12px;min-width:0}.f header,.s header{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.sev{padding:2px 6px;border:1px solid var(--ink)}.sev--critical,.sev--high{border-color:var(--orange);color:var(--orange)}.sev--low{color:var(--soft)}
.tag{padding:2px 6px;background:var(--paper-2)}.f p,.f li{overflow-wrap:anywhere}img{display:block;max-width:100%;height:auto;border:1px solid var(--line);margin-top:12px}
figure{margin:12px 0 0}figcaption{font-size:13px;color:var(--soft)}table{border-collapse:collapse;width:100%;font-size:14px}td,th{border-bottom:1px solid var(--line);padding:6px 8px;text-align:left;vertical-align:top;overflow-wrap:anywhere}
.wrap{overflow-x:auto}
.pair{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px}
</style></head><body><main>
<p class="meta">Relatório do QA Agent · run ${esc(r.runId)}</p>
<h1>${esc(r.baseUrl)}</h1>
<p class="meta">Início ${esc(r.startedAt)}${r.finishedAt ? ` · fim ${esc(r.finishedAt)}` : ""} · exploração somente leitura</p>
<section class="kpis" aria-label="Resumo">
<div><b>${r.screens.length}</b>telas (+ ${states} subestados)</div>
<div><b>${fs.length}</b>achados</div>
<div><b>${count("critical") + count("high")}</b>críticos ou altos</div>
<div><b>${r.blocked.length}</b>ações bloqueadas</div>
</section>
${r.flows?.length ? `<h2>Fluxos-objetivo</h2>${r.flows.map(flow).join("\n")}` : ""}
<h2>Achados</h2>
${groups.length ? groups.map(([s, g]) => `<h3>${SEV[s]} (${g.length})</h3>${g.map((f) => finding(f, r.screens)).join("\n")}`).join("\n") : "<p>Nenhum achado nesta execução.</p>"}
<h2>Telas</h2>
${r.screens.map((s) => screen(s, fs)).join("\n")}
<h2>Cobertura</h2>
<p>Limites atingidos: ${r.limitsHit.length ? r.limitsHit.map(esc).join(", ") : "nenhum"}.</p>
${r.blocked.length ? `<div class="wrap"><table><tr><th>Camada</th><th>Tela</th><th>Alvo</th><th>Motivo</th></tr>${r.blocked.map((b) => `<tr><td>${b.layer === "network" ? "rede" : "elemento"}</td><td>${esc(b.screenId ?? "")}</td><td>${esc(b.layer === "network" ? `${b.method ?? ""} ${b.url ?? ""}` : b.element ?? "")}</td><td>${esc(b.reason)}</td></tr>`).join("")}</table></div>` : "<p>Nenhuma ação bloqueada.</p>"}
${r.llm.notes.length ? `<h3>Observações</h3><ul>${r.llm.notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>` : ""}
<p class="meta">LLM: ${r.llm.calls} chamadas · ${r.llm.inputTokens} tokens de entrada · ${r.llm.outputTokens} de saída. Achados marcados como opinião do agente não são medições.</p>
</main></body></html>
`;
}
