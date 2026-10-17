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
:root{--paper:#F1EEE5;--paper2:#E7E3D7;--ink:#17140F;--soft:#5C564B;--line:#CFC9BA;--orange:#A8460F;--amber:#B07A12;--mint:#2F7454}
*{box-sizing:border-box}
@page{size:A4;margin:20mm 16mm 20mm;@top-left{font:8pt "IBM Plex Mono",Menlo,monospace;color:#5C564B}@top-right{content:"Relatório de análise";font:8pt "IBM Plex Mono",Menlo,monospace;color:#5C564B}@bottom-left{content:"QA Agent · Relatório de análise";font:8pt "IBM Plex Mono",Menlo,monospace;color:#5C564B}@bottom-right{content:"Página " counter(page) " de " counter(pages);font:8pt "IBM Plex Mono",Menlo,monospace;color:#5C564B}}
@page:first{margin:16mm;@top-left{content:none}@top-right{content:none}@bottom-left{content:none}@bottom-right{content:none}}
html{-webkit-print-color-adjust:exact;print-color-adjust:exact}
body{margin:0;background:var(--paper);color:var(--ink);font:10.5pt/1.5 Archivo,"Helvetica Neue",Arial,sans-serif}
main{max-width:190mm;margin:0 auto;padding:12mm 8mm}
@media print{body{background:var(--paper)}main{max-width:none;padding:0}}
h1,h2,h3,h4{line-height:1.2;margin:0;break-after:avoid}
h2{font-size:17pt;margin:0 0 4mm;padding-top:3mm;border-top:1.2pt solid var(--ink)}
h3{font-size:11.5pt;margin:0 0 2mm}h4{font-size:9pt;font-family:"IBM Plex Mono",Menlo,monospace;text-transform:uppercase;letter-spacing:.04em;color:var(--soft);margin:3mm 0 1mm}
p{margin:0 0 2.5mm}.soft{color:var(--soft)}.mono,code{font-family:"IBM Plex Mono",Menlo,monospace;font-size:8.5pt}
section{margin:0 0 9mm}#metodo,#evidencias{break-before:page}
.cover{break-after:page}.cover>*{margin:0 0 7mm}.cover .brand{margin-bottom:10mm}
.cover .brand{display:flex;align-items:center;gap:3mm;font:600 9pt "IBM Plex Mono",Menlo,monospace;letter-spacing:.14em;text-transform:uppercase}
.cover .mark{width:9mm;height:9mm;background:var(--ink);color:var(--paper);display:grid;place-items:center;font:800 14pt Archivo,Arial,sans-serif;letter-spacing:0}
.cover h1{font-size:36pt;letter-spacing:-.02em;margin:0 0 3mm;overflow-wrap:anywhere}.cover h1 i{display:block;font:italic 400 28pt "Instrument Serif",Georgia,serif;letter-spacing:0}
.cover .lede{font-size:11.5pt;max-width:160mm;color:var(--soft)}
.hero{border:1pt solid var(--ink);height:60mm;margin-bottom:7mm;overflow:hidden;background:#fff}.hero img{display:block;width:100%;height:100%;object-fit:cover;object-position:top}
.score{display:grid;grid-template-columns:1.4fr 1fr 1fr 1fr;background:var(--ink);color:var(--paper)}.score div{padding:4mm 5mm;border-right:1pt solid #3A352D}.score div:last-child{border-right:0}
.score b{display:block;font:800 30pt/1 Archivo,Arial,sans-serif;font-variant-numeric:tabular-nums;letter-spacing:-.03em}.score span{display:block;margin-top:1.5mm;font:500 7.5pt "IBM Plex Mono",Menlo,monospace;text-transform:uppercase;letter-spacing:.06em;color:#CFC9BA}
.score .h b{color:#F0A06A}.score .m b{color:#E6C168}.score .l b{color:#B9B2A3}
.dist{display:flex;height:3.2mm;background:#3A352D}.dist i{display:block;height:100%}.dist .h{background:var(--orange)}.dist .m{background:var(--amber)}.dist .l{background:#8D8677}
.toc{display:flex;flex-wrap:wrap;gap:1.5mm 5mm;font:500 8pt "IBM Plex Mono",Menlo,monospace;color:var(--soft);padding:0;list-style:none}.toc b{color:var(--ink);font-weight:600}
.meta-grid{display:grid;grid-template-columns:repeat(2,1fr);border:1pt solid var(--ink)}
.meta-grid div{padding:2.4mm 4mm;border-right:1pt solid var(--line);border-bottom:1pt solid var(--line);overflow-wrap:anywhere}.meta-grid div:nth-child(2n){border-right:0}
.meta-grid b{display:block;font:500 7.5pt "IBM Plex Mono",Menlo,monospace;text-transform:uppercase;letter-spacing:.05em;color:var(--soft);margin-bottom:.5mm}
.bars{margin:2mm 0 4mm}.bars .r{display:grid;grid-template-columns:30mm 1fr 8mm;gap:3mm;align-items:center;margin:0 0 1.4mm;font-size:9pt}.bars .t{height:3.2mm;background:var(--paper2)}.bars .t i{display:block;height:100%;background:var(--ink)}.bars .n{font:600 9pt "IBM Plex Mono",Menlo,monospace;text-align:right}
table{border-collapse:collapse;width:100%;font-size:9pt;margin:2mm 0 4mm}
th{background:var(--paper2);text-align:left;font:500 7.5pt "IBM Plex Mono",Menlo,monospace;text-transform:uppercase;letter-spacing:.04em;color:var(--soft)}
th,td{padding:1.8mm 2.4mm;border:.6pt solid var(--line);vertical-align:top;overflow-wrap:anywhere}
tr{break-inside:avoid}thead{display:table-header-group}
.nw{white-space:nowrap;overflow-wrap:normal}
.sev{display:inline-block;padding:.3mm 2mm;border:1pt solid var(--ink);font:600 7.5pt "IBM Plex Mono",Menlo,monospace}
.sev--high{border-color:var(--orange);background:var(--orange);color:#fff}.sev--medium{border-color:var(--amber);color:var(--amber)}.sev--low{color:var(--soft);border-color:var(--line)}
.tag{display:inline-block;padding:.3mm 2mm;background:var(--paper2);font:500 7.5pt "IBM Plex Mono",Menlo,monospace;color:var(--soft)}
.f{border:.8pt solid var(--line);border-left:2.2pt solid var(--soft);padding:3.2mm 4mm;margin:0 0 3mm;break-inside:avoid;background:#F7F5EE}.f--high{border-left-color:var(--orange)}.f--medium{border-left-color:var(--amber)}.f--low{border-left-color:var(--line)}
.f header{display:flex;flex-wrap:wrap;gap:2mm;align-items:center;margin-bottom:2mm}.f header .id{margin-left:auto}
.ev{font-family:"IBM Plex Mono",Menlo,monospace;font-size:8.5pt;background:var(--paper2);padding:1.5mm 2.5mm;border-left:2pt solid var(--ink);overflow-wrap:anywhere;margin:1mm 0 2mm}
.fix{border-left:2pt solid var(--mint);padding-left:2.5mm}
.shot{break-inside:avoid;margin:0 0 7mm}.shot .row{display:flex;gap:4mm;align-items:flex-start}
.crop{overflow:hidden;border:.8pt solid var(--line);background:#fff}.crop img{display:block;width:100%;height:auto}.shot .d{flex:1 1 0;min-width:0}.shot .d .crop{max-height:112mm}.shot .m{flex:0 0 52mm}.shot .m .crop{max-height:112mm}
.shot figcaption{font-size:8.5pt;color:var(--soft);margin-top:1.8mm;overflow-wrap:anywhere}.shot .lab{font:500 7pt "IBM Plex Mono",Menlo,monospace;text-transform:uppercase;letter-spacing:.05em;color:var(--soft);margin-bottom:1mm}
.po{display:none}@media print{.po{display:inline}.pn{display:none}}@media screen{.crop,.shot .d .crop,.shot .m .crop{max-height:none}}
.check td:first-child{width:8mm;text-align:center}.check .box{display:inline-block;width:3.6mm;height:3.6mm;border:1pt solid var(--ink)}.check .own{width:34mm}
.legend{display:grid;grid-template-columns:1fr 1fr;gap:4mm}.legend>div{border:.8pt solid var(--line);padding:3mm 4mm}
ul{margin:0 0 3mm;padding-left:5mm}
.note{border:1pt solid var(--mint);padding:2.5mm 3.5mm;margin:3mm 0;background:#F7F5EE;font-size:9pt}
@media (prefers-color-scheme:dark) and (not print){:root{--paper:#151310;--paper2:#1F1C17;--ink:#EDE9DE;--soft:#B3AC9E;--line:#3A352D;--orange:#E07A3C;--mint:#7EC8A1}.f,.note{background:#1B1814}.hero,.crop{background:#222}}
`;

function row(label, value) {
  return value ? `<div><b>${esc(label)}</b>${esc(value)}</div>` : "";
}

function findingCard(f, n) {
  return `<article class="f f--${f.severity}" id="f-${esc(f.id)}">
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
  const hero = (r.shots.find((x) => x.desktop) || {}).desktop;
  const maxCat = Math.max(1, ...byCat.map(([, n]) => n));

  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Relatório de análise · ${esc(host)}</title>
<meta name="description" content="Relatório de análise do QA Agent para ${esc(host)}">
<style>${CSS}</style><style>@page{@top-left{content:"${host.replace(/[^A-Za-z0-9.:-]/g, "")}"}}@page:first{@top-left{content:none}}</style></head><body><main>

<section class="cover">
  <div class="brand"><span class="mark">Q</span>QA Agent</div>
  <div>
    <p class="mono soft">Relatório de análise</p>
    <h1>${esc(host)}<i>evidências e achados</i></h1>
  </div>
  <p class="lede">${esc(r.summary || "Análise somente leitura do site: leitura do conteúdo, navegador com screenshots, medições de segurança, desempenho, SEO e acessibilidade, e revisão do conteúdo pelo Claude.")}</p>
  ${hero ? `<div class="hero"><img src="${hero}" alt="Página inicial de ${esc(host)}"></div>` : ""}
  <div>
    <div class="score"><div><b>${r.findings.length}</b><span>achados no total</span></div><div class="h"><b>${count("high")}</b><span>alta</span></div><div class="m"><b>${count("medium")}</b><span>média</span></div><div class="l"><b>${count("low")}</b><span>baixa</span></div></div>
    ${r.findings.length ? `<div class="dist">${["high", "medium", "low"].filter((v) => count(v)).map((v) => `<i class="${v[0]}" style="flex:${count(v)}"></i>`).join("")}</div>` : ""}
  </div>
  <div class="meta-grid">
    ${row("Site analisado", r.url)}
    ${row("Data da análise", date)}
    ${row("Páginas analisadas", String(r.shots.length || r.pages.length))}
    ${row("Medido / opinião do agente", `${measured.length} / ${agent.length}`)}
    ${row("Resposta do HTML", r.responseMs != null ? `${secs(r.responseMs)} s (HTTP ${r.status ?? "—"})` : "")}
    ${row("Duração da análise", r.durationMs != null ? `${secs(r.durationMs)} s` : "")}
  </div>
  <ul class="toc"><li><b>1</b> Resumo</li><li><b>2</b> Escopo e método</li><li><b>3</b> Achados medidos</li><li><b>4</b> Opinião do agente</li><li><b>5</b> Evidências visuais</li><li><b>6</b> Limitações</li><li><b>7</b> Checklist</li></ul>
  <p class="mono soft" style="margin:0">Análise somente leitura de páginas públicas. Medições são reproduzíveis; itens marcados como opinião do agente não são medições.</p>
</section>

<section id="resumo">
  <h2>1. Resumo executivo</h2>
  ${r.summary ? `<p>${esc(r.summary)}</p>` : ""}
  ${top.length ? `<h4>Prioridades</h4><ol>${top.map((f) => `<li><b>${esc(f.title)}</b> <span class="mono soft">(A-${String(num(f)).padStart(2, "0")} · ${SEV[f.severity]})</span></li>`).join("")}</ol>` : `<p class="soft">Nenhum achado de gravidade alta ou média.</p>`}
  ${byCat.length ? `<h4>Achados por gravidade</h4><div class="bars">${["high", "medium", "low"].map((v) => `<div class="r"><span>${SEV[v]}</span><span class="t"><i style="width:${Math.round((count(v) / Math.max(1, r.findings.length)) * 100)}%;background:${v === "high" ? "var(--orange)" : v === "medium" ? "var(--amber)" : "var(--soft)"}"></i></span><span class="n">${count(v)}</span></div>`).join("")}</div><h4>Achados por categoria</h4><div class="bars">${byCat.map(([c, n]) => `<div class="r"><span>${CAT[c]}</span><span class="t"><i style="width:${Math.round((n / maxCat) * 100)}%"></i></span><span class="n">${n}</span></div>`).join("")}</div>` : ""}
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
  ${r.shots.some((s) => s.desktop || s.mobile) ? r.shots.filter((s) => s.desktop || s.mobile).map((s, i) => `<figure class="shot"><div class="row">${s.desktop ? `<div class="d"><div class="lab">Desktop · 1280 px</div><div class="crop"><img src="${s.desktop}" alt="Screenshot de ${esc(s.title || s.url)} no desktop"></div></div>` : ""}${s.mobile ? `<div class="m"><div class="lab">Celular · 390 px</div><div class="crop"><img src="${s.mobile}" alt="Screenshot de ${esc(s.title || s.url)} no celular"></div></div>` : ""}</div><figcaption><b>Figura ${i + 1}.</b> ${esc(s.title || s.url)} · ${esc(s.url)} · HTTP ${s.status || "—"} · carga ${secs(s.loadMs)} s<span class="po"> · recorte da parte superior; a captura completa está no HTML</span></figcaption></figure>`).join("\n") : `<p class="soft">Sem screenshots nesta análise.</p>`}
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
  ${r.findings.length ? `<table class="check"><thead><tr><th></th><th class="nw">Gravidade</th><th>Achado</th><th>#</th><th class="own">Responsável</th></tr></thead>${r.findings.map((f) => `<tr><td><span class="box"></span></td><td class="nw">${SEV[f.severity]}</td><td>${esc(f.title)}</td><td class="mono nw">A-${String(num(f)).padStart(2, "0")}</td><td class="own"></td></tr>`).join("")}</table>` : `<p class="soft">Sem pendências.</p>`}
</section>

</main></body></html>
`;
}
