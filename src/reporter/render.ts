import { readFileSync } from "node:fs";
import type { CaseStatus, CaseVerdict, RunManifest, StepResult } from "../types/index.js";
import { CLIENT_JS } from "./client.js";

export type EvidenceMode = "linked" | "embedded";

export interface RenderOptions {
  mode: EvidenceMode;
  /** Lê o arquivo de evidência (caminho relativo ao run) para o modo embedded. */
  readImage: (relPath: string) => Buffer | undefined;
}

const TOKENS_CSS = readFileSync(new URL("./tokens.css", import.meta.url), "utf8");

export const esc = (s: unknown): string =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const slug = (s: string): string => s.replace(/[^A-Za-z0-9_-]/g, "_");

const CASE_LABEL: Record<CaseStatus, { icon: string; text: string; cls: string }> = {
  pass: { icon: "✓", text: "Aprovado", cls: "pass" },
  fail: { icon: "✕", text: "Reprovado", cls: "fail" },
  "needs-review": { icon: "◐", text: "Revisão humana", cls: "review" },
  blocked: { icon: "⊘", text: "Bloqueado", cls: "blocked" },
};
const STEP_LABEL: Record<StepResult["status"], { icon: string; text: string; cls: string }> = {
  pass: CASE_LABEL.pass,
  fail: CASE_LABEL.fail,
  healed: { icon: "⚙", text: "Autocorrigido", cls: "healed" },
  skipped: { icon: "⊘", text: "Não executado", cls: "blocked" },
};

const badge = (l: { icon: string; text: string; cls: string }) =>
  `<span class="badge s-${l.cls}"><span aria-hidden="true">${l.icon}</span> ${esc(l.text)}</span>`;

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
const when = (iso?: string) =>
  iso ? new Date(iso).toLocaleString("pt-BR", { timeZone: "UTC", dateStyle: "short", timeStyle: "medium" }) + " UTC" : "—";

const BASE_CSS = `
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif}
a{color:var(--link)}
.hdr{background:var(--header-bg);color:var(--header-fg);padding:20px 24px;border-bottom:4px solid var(--brand-blue)}
.hdr h1{margin:0 0 8px;font-size:22px}
.meta{display:flex;flex-wrap:wrap;gap:6px 24px;margin:0;font-size:13px}
.meta div{display:flex;gap:6px}.meta dt{opacity:.8}.meta dd{margin:0;font-weight:600}
main{max-width:1100px;margin:0 auto;padding:16px 24px 48px}
.alert{background:var(--status-review-bg);color:var(--status-review-fg);padding:10px 14px;border-radius:6px;margin:12px 0;font-weight:600}
.counts{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin:16px 0}
.count{padding:12px 14px;border-radius:8px;display:flex;flex-direction:column}
.count .n{font-size:30px;font-weight:700;line-height:1.1}.count .l{font-size:13px}
.bar{display:flex;height:10px;border-radius:5px;overflow:hidden;background:var(--surface);margin:0 0 8px}
.bar span{display:block;height:100%}
.bar .b-pass{background:var(--brand-green)}.bar .b-fail{background:var(--status-fail-fg)}.bar .b-review{background:var(--status-review-fg)}.bar .b-blocked{background:var(--status-blocked-fg)}
.summary-line{color:var(--muted);font-size:13px;margin:0 0 16px}
.s-pass{background:var(--status-pass-bg);color:var(--status-pass-fg)}
.s-fail{background:var(--status-fail-bg);color:var(--status-fail-fg)}
.s-review{background:var(--status-review-bg);color:var(--status-review-fg)}
.s-blocked{background:var(--status-blocked-bg);color:var(--status-blocked-fg)}
.s-healed{background:var(--status-healed-bg);color:var(--status-healed-fg)}
.badge{display:inline-block;padding:2px 10px;border-radius:999px;font-size:12px;font-weight:700;white-space:nowrap}
.filters{display:flex;flex-wrap:wrap;gap:8px;align-items:center;background:var(--surface);padding:10px 12px;border-radius:8px;margin:8px 0 16px}
.filters button,.filters input[type=search]{font:inherit;padding:6px 10px;border:1px solid var(--border);border-radius:6px;background:var(--bg);color:var(--text)}
.filters button[aria-pressed=true]{background:var(--navy);color:#fff;border-color:var(--navy)}
.filters label{display:flex;gap:6px;align-items:center;font-size:14px}
:focus-visible{outline:3px solid var(--brand-cyan);outline-offset:2px}
.case{border:1px solid var(--border);border-radius:8px;margin:10px 0;background:var(--bg)}
.case>summary{cursor:pointer;display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center;padding:10px 14px;list-style:none}
.case>summary::-webkit-details-marker{display:none}
.case .cid{font-weight:700}.case .ctitle{flex:1;min-width:200px}.case .dur{color:var(--muted);font-size:13px}
.case .body{padding:4px 16px 16px;border-top:1px solid var(--border)}
.reason{background:var(--surface);padding:10px 12px;border-radius:6px}
.steps{list-style:none;padding:0;margin:12px 0 0}
.step{border-left:4px solid var(--border);padding:6px 0 10px 12px;margin:10px 0}
.step[data-status=pass]{border-color:var(--brand-green)}.step[data-status=fail]{border-color:var(--status-fail-fg)}.step[data-status=healed]{border-color:var(--brand-blue)}
.step-head{display:flex;flex-wrap:wrap;gap:8px;align-items:center}.step .num{font-weight:700}
.step .dur{color:var(--muted);font-size:13px;margin-left:auto}
.step p{margin:4px 0}.exp,.obs{color:var(--muted);font-size:13px}.err{color:var(--status-fail-fg);font-weight:600}
.acts{margin:4px 0;padding-left:20px;color:var(--muted);font-size:13px}
.shots{display:flex;flex-wrap:wrap;gap:12px;margin-top:8px}
.shots figure{margin:0}.shots figcaption{font-size:12px;color:var(--muted)}
.shot{padding:0;border:1px solid var(--border);border-radius:6px;background:var(--surface);cursor:zoom-in;display:block}
.shot img{display:block;max-width:320px;height:auto;border-radius:6px}
table{border-collapse:collapse;width:100%;font-size:14px}th,td{border:1px solid var(--border);padding:6px 8px;text-align:left;vertical-align:top}th{background:var(--surface)}
h2{margin:28px 0 8px;font-size:18px;color:var(--navy)}
@media (prefers-color-scheme:dark){h2{color:var(--brand-cyan)}}
footer{margin-top:32px;font-size:13px;color:var(--muted);border-top:1px solid var(--border);padding-top:12px}
.lightbox{position:fixed;inset:0;background:rgba(0,0,0,.85);display:none;align-items:center;justify-content:center;padding:24px;z-index:10}
.lightbox[data-open=true]{display:flex}.lightbox img{max-width:100%;max-height:100%}
.lightbox button{position:absolute;top:12px;right:12px;font:inherit;padding:8px 14px}
.hidden{display:none!important}
@media print{.filters,.lightbox,.shot{cursor:auto}.filters{display:none}.case>summary{break-after:avoid}.case{break-inside:avoid-page}body{background:#fff;color:#000}.hdr{border-bottom:1px solid #000}}
`;

function img(ref: string | undefined, alt: string, opts: RenderOptions): string {
  if (!ref) return "";
  let src: string;
  if (opts.mode === "embedded") {
    const data = opts.readImage(ref);
    if (!data) return `<span class="exp">(evidência indisponível: ${esc(ref)})</span>`;
    src = `data:image/png;base64,${data.toString("base64")}`;
  } else {
    src = `../${ref}`;
  }
  return `<button type="button" class="shot" aria-label="Ampliar: ${esc(alt)}"><img src="${esc(src)}" alt="${esc(alt)}" loading="lazy"></button>`;
}

function stepHtml(s: StepResult, opts: RenderOptions): string {
  const l = STEP_LABEL[s.status];
  const before = img(s.screenshotBefore, `Antes do passo ${s.stepIndex}`, opts);
  const after = img(s.screenshotAfter, `Depois do passo ${s.stepIndex}`, opts);
  return `<li class="step" data-status="${esc(s.status)}">
  <div class="step-head"><span class="num">Passo ${esc(s.stepIndex)}</span>${badge(l)}<span class="txt">${esc(s.text ?? "")}</span><span class="dur">${seconds(s.durationMs)}</span></div>
  ${s.expected ? `<p class="exp">Esperado: ${esc(s.expected)}</p>` : ""}
  ${s.actions?.length ? `<ul class="acts">${s.actions.map((a) => `<li>${esc(a)}</li>`).join("")}</ul>` : ""}
  ${s.error ? `<p class="err">${esc(s.error)}</p>` : ""}
  ${s.healNote ? `<p class="exp">Autocorreção: ${esc(s.healNote)}</p>` : ""}
  ${s.observed ? `<p class="obs">Observado: ${esc(s.observed)}</p>` : ""}
  ${before || after ? `<div class="shots">${before ? `<figure>${before}<figcaption>Antes</figcaption></figure>` : ""}${after ? `<figure>${after}<figcaption>Depois</figcaption></figure>` : ""}</div>` : ""}
</li>`;
}

function caseHtml(v: CaseVerdict, opts: RenderOptions): string {
  const l = CASE_LABEL[v.status];
  const total = v.steps.reduce((n, s) => n + s.durationMs, 0);
  const search = `${v.caseId} ${v.title}`.toLowerCase();
  return `<details class="case" id="case-${slug(v.caseId)}" data-status="${esc(v.status)}" data-search="${esc(search)}">
<summary>${badge(l)}<span class="cid">${esc(v.caseId)}</span><span class="ctitle">${esc(v.title)}</span><span class="dur">${seconds(total)}</span></summary>
<div class="body">
  <p class="reason"><strong>Parecer:</strong> ${esc(v.reasoning)}</p>
  ${v.steps.length ? `<ol class="steps">${v.steps.map((s) => stepHtml(s, opts)).join("")}</ol>` : "<p class=\"exp\">Nenhum passo executado.</p>"}
</div>
</details>`;
}

export function renderReport(m: RunManifest, opts: RenderOptions): string {
  const count = (st: CaseStatus) => m.verdicts.filter((v) => v.status === st).length;
  const healedSteps = m.verdicts.flatMap((v) => v.steps.filter((s) => s.status === "healed").map((s) => ({ v, s })));
  const total = m.verdicts.length;
  const hasAttention = m.verdicts.some((v) => v.status !== "pass");
  const pct = (n: number) => (total ? ((n / total) * 100).toFixed(2) : "0");
  const rate = total ? Math.round((count("pass") / total) * 100) : 0;
  const totalMs = m.verdicts.reduce((n, v) => n + v.steps.reduce((a, s) => a + s.durationMs, 0), 0);

  const counts: Array<[string, string, string, number]> = [
    ["pass", "pass", "✓ Aprovados", count("pass")],
    ["fail", "fail", "✕ Reprovados", count("fail")],
    ["needs-review", "review", "◐ Revisão humana", count("needs-review")],
    ["blocked", "blocked", "⊘ Bloqueados", count("blocked")],
    ["healed", "healed", "⚙ Autocorrigidos (passos)", healedSteps.length],
  ];

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>Relatório de evidências de QA — ${esc(m.runId)}</title>
<style>${TOKENS_CSS}${BASE_CSS}</style>
</head>
<body>
<header class="hdr">
  <h1>Relatório de evidências de QA</h1>
  <dl class="meta">
    <div><dt>Run</dt><dd>${esc(m.runId)}</dd></div>
    <div><dt>Ambiente</dt><dd>${esc(m.env)}</dd></div>
    <div><dt>Início</dt><dd>${esc(when(m.startedAt))}</dd></div>
    <div><dt>Fim</dt><dd>${esc(when(m.finishedAt))}</dd></div>
    <div><dt>Modelo</dt><dd>${esc(m.model)}</dd></div>
    <div><dt>CLI</dt><dd>${esc(m.cliVersion)}</dd></div>
    <div><dt>Commit</dt><dd>${esc(m.commit ?? "—")}</dd></div>
  </dl>
</header>
<main>
${m.aborted ? `<p class="alert" role="alert">Run interrompido: ${esc(m.aborted)}</p>` : ""}
<section aria-labelledby="h-resumo">
  <h2 id="h-resumo">Resumo</h2>
  <div class="counts">${counts
    .map(
      ([key, cls, label, n]) =>
        `<div class="count s-${cls}"><span class="n" data-count="${key}">${n}</span><span class="l">${esc(label)}</span></div>`,
    )
    .join("")}</div>
  <div class="bar" role="img" aria-label="Proporção de casos: ${count("pass")} aprovados, ${count("fail")} reprovados, ${count("needs-review")} em revisão, ${count("blocked")} bloqueados">
    <span class="b-pass" style="width:${pct(count("pass"))}%"></span><span class="b-fail" style="width:${pct(count("fail"))}%"></span><span class="b-review" style="width:${pct(count("needs-review"))}%"></span><span class="b-blocked" style="width:${pct(count("blocked"))}%"></span>
  </div>
  <p class="summary-line">${total} caso(s) · taxa de sucesso ${rate}% · tempo de execução ${seconds(totalMs)} · ${esc(m.usage.calls)} chamada(s) ao LLM</p>
</section>
${
  m.issues.length
    ? `<section aria-labelledby="h-issues"><h2 id="h-issues">Problemas na leitura do Excel</h2><ul>${m.issues
        .map((i) => `<li>linha ${esc(i.row)}${i.caseId ? ` (${esc(i.caseId)})` : ""}: ${esc(i.message)}</li>`)
        .join("")}</ul></section>`
    : ""
}
<section aria-labelledby="h-casos">
  <h2 id="h-casos">Casos</h2>
  <div class="filters" id="filters" role="group" aria-label="Filtros">
    <button type="button" data-filter="all" aria-pressed="true">Todos</button>
    <button type="button" data-filter="fail" aria-pressed="false">Reprovados</button>
    <button type="button" data-filter="needs-review" aria-pressed="false">Revisão humana</button>
    <button type="button" data-filter="blocked" aria-pressed="false">Bloqueados</button>
    <button type="button" data-filter="pass" aria-pressed="false">Aprovados</button>
    <input type="search" id="q" placeholder="Buscar por ID ou título" aria-label="Buscar por ID ou título">
    <label><input type="checkbox" id="attention"${hasAttention ? " checked" : ""}> Mostrar só o que exige atenção</label>
  </div>
  <div id="cases">${total ? m.verdicts.map((v) => caseHtml(v, opts)).join("\n") : "<p>Nenhum caso executado.</p>"}</div>
  <p id="empty" class="hidden">Nenhum caso corresponde aos filtros.</p>
</section>
<section aria-labelledby="h-heal">
  <h2 id="h-heal">Autocorreções</h2>
  ${
    healedSteps.length
      ? `<table><thead><tr><th>Caso</th><th>Passo</th><th>Antes</th><th>Depois</th><th>Nota</th></tr></thead><tbody>${healedSteps
          .map(({ v, s }) => {
            const hs = s.heals?.length ? s.heals : [{ from: "—", to: ["—"], note: s.healNote ?? "" }];
            return hs
              .map(
                (h) =>
                  `<tr><td><a href="#case-${slug(v.caseId)}">${esc(v.caseId)}</a></td><td>${esc(s.stepIndex)} — ${esc(s.text ?? "")}</td><td>${esc(h.from)}</td><td>${esc(h.to.join("; "))}</td><td>${esc(h.note)}</td></tr>`,
              )
              .join("");
          })
          .join("")}</tbody></table>`
      : "<p>Nenhuma autocorreção neste run.</p>"
  }
</section>
<footer>
  <p><a href="../manifest.json" download>Baixar manifest.json</a> · Prints e textos enviados ao LLM passam por mascaramento (campos de senha e seletores configurados). Cores de marca aproximadas.</p>
</footer>
</main>
<div class="lightbox" id="lightbox" role="dialog" aria-modal="true" aria-label="Evidência ampliada" data-open="false"><button type="button" id="lb-close">Fechar (Esc)</button><img alt="" id="lb-img"></div>
<script>${CLIENT_JS}</script>
</body>
</html>
`;
}
