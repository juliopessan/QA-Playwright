import { createHash } from "node:crypto";

const SEV = { high: "Alta", medium: "Média", low: "Baixa" };
const SEV_ORDER = { high: 0, medium: 1, low: 2 };
const CAT = { tecnico: "Técnico", seguranca: "Segurança", desempenho: "Desempenho", seo: "SEO", acessibilidade: "Acessibilidade", ux: "UX", conteudo: "Conteúdo", confianca: "Confiança" };
const IMG = /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/;
const MAX_IMG = 700_000;

const clip = (v, n) => String(v ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").slice(0, n);
export const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const httpUrl = (u) => {
  try {
    const x = new URL(String(u));
    return x.protocol === "http:" || x.protocol === "https:" ? x.href.slice(0, 500) : "";
  } catch {
    return "";
  }
};
const fmtDate = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "long", timeStyle: "short" });
};
const secs = (ms) => (Number(ms) / 1000).toFixed(1).replace(".", ",");

/** Id estável do achado (mesmo problema, mesma página, mesmo id entre análises). */
export const findingId = (f) => createHash("sha1").update(`${f.category}|${f.page}|${f.title}`).digest("hex").slice(0, 8);

/**
 * O relatório chega do navegador (JSON): nada é confiável. Só a forma esperada passa, com tamanhos
 * limitados, URLs http(s) e imagens JPEG em data URL; todo texto é escapado ao renderizar.
 */
export function sanitizeReport(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  const url = httpUrl(r.finalUrl) || httpUrl(r.url);
  if (!url) throw new Error("relatório sem URL válida");
  const img = (v) => (typeof v === "string" && v.length <= MAX_IMG && IMG.test(v) ? v : undefined);
  const findings = (Array.isArray(r.findings) ? r.findings : []).slice(0, 80).map((f) => {
    const sev = ["high", "medium", "low"].includes(f?.severity) ? f.severity : "low";
    const out = {
      origin: f?.origin === "agent" ? "agent" : "measured",
      category: Object.hasOwn(CAT, f?.category) ? f.category : "ux",
      severity: sev,
      title: clip(f?.title, 220),
      description: clip(f?.description, 700),
      evidence: clip(f?.evidence, 420),
      suggestion: clip(f?.suggestion, 500),
      page: httpUrl(f?.page) || url,
      confidence: typeof f?.confidence === "number" ? Math.max(0, Math.min(1, f.confidence)) : undefined,
    };
    return { ...out, id: findingId(out) };
  }).filter((f) => f.title);
  return {
    url,
    analyzedAt: clip(r.analyzedAt, 40),
    durationMs: Number.isFinite(r.durationMs) ? Number(r.durationMs) : undefined,
    summary: clip(r.summary, 900),
    model: clip(r.model, 60),
    status: Number.isFinite(r.status) ? Number(r.status) : undefined,
    responseMs: Number.isFinite(r.responseMs) ? Number(r.responseMs) : undefined,
    pages: (Array.isArray(r.pages) ? r.pages : []).slice(0, 12).map((p) => ({ url: httpUrl(p?.url), title: clip(p?.title, 160) })).filter((p) => p.url),
    shots: (Array.isArray(r.shots) ? r.shots : []).slice(0, 6).map((s) => ({ url: httpUrl(s?.url), title: clip(s?.title, 160), status: Number(s?.status) || 0, loadMs: Number(s?.loadMs) || 0, desktop: img(s?.desktop), mobile: img(s?.mobile) })).filter((s) => s.url),
    notes: (Array.isArray(r.notes) ? r.notes : []).slice(0, 12).map((n) => clip(n, 400)),
    findings: findings.sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity] || a.category.localeCompare(b.category)),
  };
}

const CSS = `
:root{--paper:#F1EEE5;--paper2:#E7E3D7;--ink:#17140F;--soft:#5C564B;--line:#CFC9BA;--orange:#A8460F;--mint:#2F7454}
*{box-sizing:border-box}
@page{size:A4;margin:18mm 16mm 20mm;@bottom-left{content:"QA Agent · Relatório de análise";font:8pt "IBM Plex Mono",Menlo,monospace;color:#5C564B}@bottom-right{content:"Página " counter(page) " de " counter(pages);font:8pt "IBM Plex Mono",Menlo,monospace;color:#5C564B}}
html{-webkit-print-color-adjust:exact;print-color-adjust:exact}
body{margin:0;background:var(--paper);color:var(--ink);font:10.5pt/1.5 Archivo,"Helvetica Neue",Arial,sans-serif}
main{max-width:190mm;margin:0 auto;padding:12mm 8mm}
@media print{body{background:var(--paper)}main{max-width:none;padding:0}}
h1,h2,h3,h4{line-height:1.2;margin:0;break-after:avoid}
h2{font-size:17pt;margin:0 0 4mm;padding-top:3mm;border-top:1.2pt solid var(--ink)}
h3{font-size:11.5pt;margin:0 0 2mm}h4{font-size:9pt;font-family:"IBM Plex Mono",Menlo,monospace;text-transform:uppercase;letter-spacing:.04em;color:var(--soft);margin:3mm 0 1mm}
p{margin:0 0 2.5mm}.soft{color:var(--soft)}.mono,code{font-family:"IBM Plex Mono",Menlo,monospace;font-size:8.5pt}
section{margin:0 0 9mm}
#evidencias{break-before:auto}#evidencias h2{break-after:avoid}
.cover{min-height:245mm;display:flex;flex-direction:column;justify-content:space-between;break-after:page;padding-bottom:6mm}
.cover .brand{display:flex;align-items:center;gap:3mm;font:600 9pt "IBM Plex Mono",Menlo,monospace;letter-spacing:.14em;text-transform:uppercase}
.cover .mark{width:9mm;height:9mm;background:var(--ink);color:var(--paper);display:grid;place-items:center;font:800 14pt Archivo,Arial,sans-serif;letter-spacing:0}
.cover h1{font-size:34pt;letter-spacing:-.02em;margin:0 0 4mm}.cover h1 i{display:block;font:italic 400 28pt "Instrument Serif",Georgia,serif;letter-spacing:0}
.cover .lede{font-size:12pt;max-width:150mm;color:var(--soft)}
.meta-grid{display:grid;grid-template-columns:repeat(2,1fr);border:1pt solid var(--ink);margin-top:8mm}
.meta-grid div{padding:3mm 4mm;border-right:1pt solid var(--line);border-bottom:1pt solid var(--line)}.meta-grid div:nth-child(2n){border-right:0}
.meta-grid b{display:block;font:500 7.5pt "IBM Plex Mono",Menlo,monospace;text-transform:uppercase;letter-spacing:.05em;color:var(--soft);margin-bottom:.5mm}
.kpis{display:grid;grid-template-columns:repeat(4,1fr);border:1pt solid var(--ink);margin:4mm 0}
.kpis div{padding:3mm 4mm;border-right:1pt solid var(--line)}.kpis div:last-child{border-right:0}
.kpis b{display:block;font:800 22pt Archivo,Arial,sans-serif;font-variant-numeric:tabular-nums;letter-spacing:-.02em}.kpis span{font-size:8.5pt;color:var(--soft)}
table{border-collapse:collapse;width:100%;font-size:9pt;margin:2mm 0 4mm}
th{background:var(--paper2);text-align:left;font:500 7.5pt "IBM Plex Mono",Menlo,monospace;text-transform:uppercase;letter-spacing:.04em;color:var(--soft)}
th,td{padding:1.8mm 2.4mm;border:.6pt solid var(--line);vertical-align:top;overflow-wrap:anywhere}
tr{break-inside:avoid}
.nw{white-space:nowrap;overflow-wrap:normal}
.sev{display:inline-block;padding:.3mm 2mm;border:1pt solid var(--ink);font:600 7.5pt "IBM Plex Mono",Menlo,monospace}
.sev--high{border-color:var(--orange);color:var(--orange)}.sev--low{color:var(--soft);border-color:var(--line)}
.tag{display:inline-block;padding:.3mm 2mm;background:var(--paper2);font:500 7.5pt "IBM Plex Mono",Menlo,monospace;color:var(--soft)}
.f{border:.8pt solid var(--line);padding:3.5mm 4mm;margin:0 0 3mm;break-inside:avoid;background:#F7F5EE}
.f header{display:flex;flex-wrap:wrap;gap:2mm;align-items:center;margin-bottom:2mm}.f header .id{margin-left:auto}
.ev{font-family:"IBM Plex Mono",Menlo,monospace;font-size:8.5pt;background:var(--paper2);padding:1.5mm 2.5mm;border-left:2pt solid var(--ink);overflow-wrap:anywhere;margin:1mm 0 2mm}
.fix{border-left:2pt solid var(--mint);padding-left:2.5mm}
.shot{break-inside:avoid;margin:0 0 6mm}.shot .row{display:flex;gap:4mm;align-items:flex-start}
.shot img{display:block;border:.8pt solid var(--line);max-width:100%;max-height:196mm;width:auto;height:auto}.shot .d{flex:1 1 0;min-width:0}.shot .m{flex:0 0 auto;max-width:50mm}
.shot figcaption{font-size:8.5pt;color:var(--soft);margin-top:1.5mm;overflow-wrap:anywhere}
.check{break-inside:avoid}.check li{list-style:none;margin:0 0 1.5mm;padding-left:0;display:flex;gap:2.5mm}.check{padding:0;margin:0}.check .box{flex:none;width:3.4mm;height:3.4mm;border:1pt solid var(--ink);margin-top:1mm}
.legend{display:grid;grid-template-columns:1fr 1fr;gap:4mm}.legend>div{border:.8pt solid var(--line);padding:3mm 4mm}
ul{margin:0 0 3mm;padding-left:5mm}
.note{border:1pt solid var(--mint);padding:2.5mm 3.5mm;margin:3mm 0;background:#F7F5EE;font-size:9pt}
@media (prefers-color-scheme:dark) and (not print){:root{--paper:#151310;--paper2:#1F1C17;--ink:#EDE9DE;--soft:#B3AC9E;--line:#3A352D;--orange:#E07A3C;--mint:#7EC8A1}.f,.note{background:#1B1814}}
`;

function row(label, value) {
  return value ? `<div><b>${esc(label)}</b>${esc(value)}</div>` : "";
}

function findingCard(f, n) {
  return `<article class="f" id="f-${esc(f.id)}">
  <header><span class="sev sev--${f.severity}">${SEV[f.severity]}</span><span class="tag">${CAT[f.category]}</span><span class="tag">${f.origin === "agent" ? `opinião do agente${f.confidence !== undefined ? ` · ${Math.round(f.confidence * 100)}%` : ""}` : "medido"}</span><span class="mono id">A-${String(n).padStart(2, "0")} · ${esc(f.id)}</span></header>
  <h3>${esc(f.title)}</h3>
  ${f.description ? `<p>${esc(f.description)}</p>` : ""}
  <h4>Evidência</h4><div class="ev">${esc(f.evidence)}</div>
  ${f.suggestion ? `<h4>O que fazer</h4><p class="fix">${esc(f.suggestion)}</p>` : ""}
  <p class="mono soft">Página: ${esc(f.page)}</p>
</article>`;
}

/**
 * Documento do relatório (HTML autônomo, A4, pronto para virar PDF). Estrutura: capa, resumo executivo,
 * escopo e método, achados medidos, opinião do agente, evidências visuais, limitações e checklist.
 */
export function renderReportHtml(input) {
  const r = sanitizeReport(input);
  const host = new URL(r.url).host;
  const measured = r.findings.filter((f) => f.origin === "measured");
  const agent = r.findings.filter((f) => f.origin === "agent");
  const count = (s) => r.findings.filter((f) => f.severity === s).length;
  const idx = new Map(r.findings.map((f, i) => [f.id + f.page, i + 1]));
  const num = (f) => idx.get(f.id + f.page);
  const top = r.findings.filter((f) => f.severity !== "low").slice(0, 3);
  const byCat = Object.keys(CAT).map((c) => [c, r.findings.filter((f) => f.category === c).length]).filter(([, n]) => n);
  const date = fmtDate(r.analyzedAt);

  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Relatório de análise · ${esc(host)}</title>
<meta name="description" content="Relatório de análise do QA Agent para ${esc(host)}">
<style>${CSS}</style></head><body><main>

<section class="cover">
  <div class="brand"><span class="mark">Q</span>QA Agent</div>
  <div>
    <p class="mono soft">Relatório de análise</p>
    <h1>${esc(host)}<i>evidências e achados</i></h1>
    <p class="lede">${esc(r.summary || "Análise somente leitura do site: leitura do conteúdo, navegador com screenshots, medições de segurança, desempenho, SEO e acessibilidade, e revisão do conteúdo pelo Claude.")}</p>
    <div class="meta-grid">
      ${row("Site analisado", r.url)}
      ${row("Data da análise", date)}
      ${row("Páginas analisadas", String(r.shots.length || r.pages.length))}
      ${row("Achados", `${r.findings.length} (${count("high")} altos, ${count("medium")} médios, ${count("low")} baixos)`)}
      ${row("Resposta do HTML", r.responseMs != null ? `${secs(r.responseMs)} s (HTTP ${r.status ?? "—"})` : "")}
      ${row("Duração da análise", r.durationMs != null ? `${secs(r.durationMs)} s` : "")}
    </div>
  </div>
  <p class="mono soft">Análise somente leitura de páginas públicas. Medições são reproduzíveis; itens marcados como opinião do agente não são medições.</p>
</section>

<section id="resumo">
  <h2>1. Resumo executivo</h2>
  <div class="kpis"><div><b>${r.findings.length}</b><span>achados</span></div><div><b>${count("high")}</b><span>gravidade alta</span></div><div><b>${measured.length}</b><span>medidos</span></div><div><b>${agent.length}</b><span>opinião do agente</span></div></div>
  ${r.summary ? `<p>${esc(r.summary)}</p>` : ""}
  ${top.length ? `<h4>Prioridades</h4><ol>${top.map((f) => `<li><b>${esc(f.title)}</b> <span class="mono soft">(A-${String(num(f)).padStart(2, "0")} · ${SEV[f.severity]})</span></li>`).join("")}</ol>` : `<p class="soft">Nenhum achado de gravidade alta ou média.</p>`}
  ${byCat.length ? `<h4>Achados por categoria</h4><table><tr>${byCat.map(([c]) => `<th>${CAT[c]}</th>`).join("")}</tr><tr>${byCat.map(([, n]) => `<td>${n}</td>`).join("")}</tr></table>` : ""}
  ${r.findings.length ? `<h4>Todos os achados</h4><table><tr><th class="nw">#</th><th class="nw">Gravidade</th><th class="nw">Categoria</th><th class="nw">Origem</th><th>Achado</th></tr>${r.findings.map((f) => `<tr><td class="mono nw">A-${String(num(f)).padStart(2, "0")}</td><td class="nw">${SEV[f.severity]}</td><td class="nw">${CAT[f.category]}</td><td class="nw">${f.origin === "agent" ? "opinião" : "medido"}</td><td>${esc(f.title)}</td></tr>`).join("")}</table>` : ""}
</section>

<section id="metodo">
  <h2>2. Escopo e método</h2>
  <p>A análise visita o site como um visitante anônimo. Não faz login, não envia formulários e não clica em botões: o navegador só realiza leituras (GET) e bloqueia qualquer outra requisição, além de acessos a redes privadas.</p>
  <div class="legend">
    <div><h3>Medido</h3><ul><li><b>Navegador (Playwright):</b> screenshots, erros de console, recursos que falham, LCP, CLS, rolagem lateral no celular.</li><li><b>Acessibilidade (axe-core):</b> regras WCAG por página.</li><li><b>Visita direta:</b> status, tempo, HTTPS, cabeçalhos de segurança, título, descrição, idioma, viewport, h1 e imagens sem alt.</li></ul></div>
    <div><h3>Opinião do agente</h3><ul><li><b>Leitura do conteúdo (Exa)</b> e revisão pelo Claude${r.model ? ` (${esc(r.model)})` : ""} com texto e screenshots.</li><li>Cada sugestão cita um trecho literal do site; as que não citam são descartadas.</li><li>Gravidade limitada a média; não é medição.</li></ul></div>
  </div>
  <h3 style="margin-top:4mm">Páginas analisadas</h3>
  <table><tr><th>Página</th><th>Título</th><th>HTTP</th><th>Carga</th></tr>
  ${(r.shots.length ? r.shots : r.pages).map((p) => `<tr><td>${esc(p.url)}</td><td>${esc(p.title)}</td><td>${p.status ?? "—"}</td><td>${p.loadMs ? `${secs(p.loadMs)} s` : "—"}</td></tr>`).join("") || `<tr><td colspan="4">Nenhuma página.</td></tr>`}
  </table>
</section>

<section id="medidos">
  <h2>3. Achados medidos (${measured.length})</h2>
  ${measured.length ? measured.map((f) => findingCard(f, num(f))).join("\n") : `<p class="soft">Nenhum achado medido: as checagens feitas não encontraram problemas.</p>`}
</section>

<section id="agente">
  <h2>4. Opinião do agente (${agent.length})</h2>
  <p class="note">Estas sugestões vêm da revisão do Claude sobre o texto e os screenshots do site. Cada uma cita um trecho real, mas são julgamentos e podem ser discordados pela equipe.</p>
  ${agent.length ? agent.map((f) => findingCard(f, num(f))).join("\n") : `<p class="soft">Sem sugestões do agente nesta análise${r.notes.some((n) => /desligada|indispon/i.test(n)) ? " (a revisão pelo Claude não rodou, veja as observações)" : ""}.</p>`}
</section>

<section id="evidencias">
  <h2>5. Evidências visuais</h2>
  ${r.shots.some((s) => s.desktop) ? r.shots.filter((s) => s.desktop || s.mobile).map((s, i) => `<figure class="shot"><div class="row">${s.desktop ? `<div class="d"><img src="${s.desktop}" alt="Screenshot de ${esc(s.title || s.url)} no desktop"></div>` : ""}${s.mobile ? `<div class="m"><img src="${s.mobile}" alt="Screenshot de ${esc(s.title || s.url)} no celular"></div>` : ""}</div><figcaption><b>Figura ${i + 1}.</b> ${esc(s.title || s.url)} · ${esc(s.url)} · HTTP ${s.status || "—"} · carga ${secs(s.loadMs)} s${s.mobile ? " · desktop (1280 px) e celular (390 px)" : " · desktop (1280 px)"}</figcaption></figure>`).join("\n") : `<p class="soft">Sem screenshots nesta análise.</p>`}
</section>

<section id="limites">
  <h2>6. Observações e limitações</h2>
  ${r.notes.length ? `<ul>${r.notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>` : ""}
  <ul>
    <li>A análise cobre páginas públicas (até 4); telas autenticadas, abas, modais e fluxos exigem o CLI do QA Agent.</li>
    <li>Métricas de desempenho vêm de uma única execução em ambiente de servidor e variam com rede e carga.</li>
    <li>A varredura automática de acessibilidade encontra só parte dos problemas; não substitui teste com leitores de tela.</li>
  </ul>
</section>

<section id="checklist">
  <h2>7. Checklist para a equipe</h2>
  ${r.findings.length ? `<ul class="check">${r.findings.map((f) => `<li><span class="box"></span><span><b>${SEV[f.severity]}</b> · ${esc(f.title)} <span class="mono soft">A-${String(num(f)).padStart(2, "0")}</span></span></li>`).join("")}</ul>` : `<p class="soft">Sem pendências.</p>`}
</section>

</main></body></html>
`;
}
