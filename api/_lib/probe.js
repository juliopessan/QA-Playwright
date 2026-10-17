import { lookup } from "node:dns/promises";
import { isPrivateAddress, validateTarget } from "./core.js";

const MAX_BYTES = 1_500_000;

/**
 * Busca a página diretamente (cabeçalhos, status, tempo e HTML). Cada salto de redirecionamento é
 * revalidado e o nome precisa resolver só para IPs públicos (evita acesso a redes internas).
 */
export async function fetchPage(url, { doFetch = fetch, resolve = lookup, timeoutMs = 10_000 } = {}) {
  let current = url;
  const started = Date.now();
  for (let hop = 0; hop < 5; hop++) {
    const ok = validateTarget(current);
    if (!ok.ok) throw new Error(`redirecionamento para endereço não permitido: ${current}`);
    const addrs = await resolve(new URL(current).hostname, { all: true }).catch(() => []);
    if (!addrs.length) throw new Error("o domínio não foi encontrado (DNS)");
    if (addrs.some((a) => isPrivateAddress(a.address))) throw new Error("o domínio aponta para uma rede privada");
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let res;
    try {
      res = await doFetch(current, { redirect: "manual", signal: ctrl.signal, headers: { "User-Agent": "QA-Agent/1.0 (+analise somente leitura)", Accept: "text/html,*/*;q=0.8" } });
    } finally {
      clearTimeout(timer);
    }
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      current = new URL(res.headers.get("location"), current).href;
      continue;
    }
    const buf = new Uint8Array(await res.arrayBuffer());
    const html = new TextDecoder().decode(buf.subarray(0, MAX_BYTES));
    const headers = Object.fromEntries([...res.headers.entries()].map(([k, v]) => [k.toLowerCase(), v]));
    return { status: res.status, finalUrl: current, ms: Date.now() - started, headers, html, bytes: buf.length };
  }
  throw new Error("redirecionamentos demais");
}

const attr = (tag, name) => new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag)?.slice(2).find((x) => x !== undefined);

/** Fatos objetivos extraídos do HTML (expressões simples; o objetivo é sinalizar, não validar o HTML). */
export function inspectHtml(html) {
  const head = html.slice(0, 200_000);
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(head)?.[1]?.replace(/\s+/g, " ").trim() ?? "";
  const metas = head.match(/<meta\b[^>]*>/gi) ?? [];
  const meta = (key) => metas.map((m) => ((attr(m, "name") ?? attr(m, "property") ?? "").toLowerCase() === key ? attr(m, "content") : undefined)).find((v) => v !== undefined);
  const imgs = html.match(/<img\b[^>]*>/gi) ?? [];
  const htmlTag = /<html\b[^>]*>/i.exec(head)?.[0] ?? "";
  return {
    title,
    description: meta("description") ?? "",
    viewport: meta("viewport") ?? "",
    ogTitle: meta("og:title") ?? "",
    lang: attr(htmlTag, "lang") ?? "",
    h1: (html.match(/<h1\b/gi) ?? []).length,
    images: imgs.length,
    imagesWithoutAlt: imgs.filter((t) => attr(t, "alt") === undefined).length,
    canonical: /<link\b[^>]*rel\s*=\s*["']?canonical/i.test(head),
    passwordOverHttp: false,
  };
}

const finding = (f) => ({ origin: "measured", ...f });

/** Achados medidos: segurança, desempenho, SEO e acessibilidade básicos da página inicial. */
export function measuredFindings(page) {
  const out = [];
  const h = page.headers;
  const info = inspectHtml(page.html);
  const at = page.finalUrl;
  if (page.status >= 400) out.push(finding({ category: "tecnico", severity: "high", title: `A página responde com erro HTTP ${page.status}`, evidence: `GET ${at} → ${page.status}`, suggestion: "Corrija a rota ou o servidor; visitantes e buscadores veem um erro.", page: at }));
  if (!at.startsWith("https://")) out.push(finding({ category: "seguranca", severity: "high", title: "O site não usa HTTPS", evidence: `Endereço final: ${at}`, suggestion: "Sirva o site só por HTTPS e redirecione o HTTP.", page: at }));
  else if (!h["strict-transport-security"]) out.push(finding({ category: "seguranca", severity: "medium", title: "Falta o cabeçalho Strict-Transport-Security (HSTS)", evidence: "Cabeçalho strict-transport-security ausente na resposta", suggestion: "Adicione Strict-Transport-Security: max-age=31536000; includeSubDomains.", page: at }));
  if (!h["content-security-policy"]) out.push(finding({ category: "seguranca", severity: "low", title: "Sem Content-Security-Policy", evidence: "Cabeçalho content-security-policy ausente", suggestion: "Defina uma CSP para limitar scripts e origens externas.", page: at }));
  if ((h["x-content-type-options"] ?? "").toLowerCase() !== "nosniff") out.push(finding({ category: "seguranca", severity: "low", title: "Sem X-Content-Type-Options: nosniff", evidence: "Cabeçalho x-content-type-options ausente ou diferente de nosniff", suggestion: "Envie X-Content-Type-Options: nosniff.", page: at }));
  if (!h["x-frame-options"] && !/frame-ancestors/i.test(h["content-security-policy"] ?? "")) out.push(finding({ category: "seguranca", severity: "low", title: "A página pode ser embutida em iframes de outros sites", evidence: "Sem X-Frame-Options e sem frame-ancestors na CSP", suggestion: "Use frame-ancestors 'self' na CSP (ou X-Frame-Options: SAMEORIGIN).", page: at }));
  if (page.ms > 3000) out.push(finding({ category: "desempenho", severity: "medium", title: `Resposta lenta: ${(page.ms / 1000).toFixed(1)} s até o HTML`, evidence: `Tempo até receber o HTML: ${page.ms} ms`, suggestion: "Investigue o tempo do servidor, cache e CDN.", page: at }));
  else if (page.ms > 1500) out.push(finding({ category: "desempenho", severity: "low", title: `Resposta acima de 1,5 s: ${(page.ms / 1000).toFixed(1)} s`, evidence: `Tempo até receber o HTML: ${page.ms} ms`, suggestion: "Verifique cache e CDN para o HTML.", page: at }));
  if (page.bytes > 1_000_000) out.push(finding({ category: "desempenho", severity: "low", title: `HTML pesado: ${Math.round(page.bytes / 1024)} KB`, evidence: `Tamanho do HTML: ${page.bytes} bytes`, suggestion: "Reduza conteúdo inline e scripts embutidos.", page: at }));
  if (!info.title) out.push(finding({ category: "seo", severity: "medium", title: "A página não tem <title>", evidence: "Tag <title> ausente ou vazia", suggestion: "Defina um título único e descritivo.", page: at }));
  else if (info.title.length > 65) out.push(finding({ category: "seo", severity: "low", title: "Título longo demais para os buscadores", evidence: `<title> com ${info.title.length} caracteres: "${info.title.slice(0, 80)}"`, suggestion: "Mantenha o título com até 60 caracteres.", page: at }));
  if (!info.description) out.push(finding({ category: "seo", severity: "low", title: "Sem meta description", evidence: 'Tag <meta name="description"> ausente', suggestion: "Escreva uma descrição de 120 a 160 caracteres.", page: at }));
  if (!info.lang) out.push(finding({ category: "acessibilidade", severity: "medium", title: "O idioma da página não está declarado", evidence: "Atributo lang ausente em <html>", suggestion: 'Use <html lang="pt-BR"> para leitores de tela pronunciarem corretamente.', page: at }));
  if (!info.viewport) out.push(finding({ category: "acessibilidade", severity: "medium", title: "Sem meta viewport: a página não se adapta ao celular", evidence: 'Tag <meta name="viewport"> ausente', suggestion: 'Adicione <meta name="viewport" content="width=device-width, initial-scale=1">.', page: at }));
  if (info.h1 === 0) out.push(finding({ category: "acessibilidade", severity: "low", title: "A página não tem título principal (h1)", evidence: "Nenhum <h1> no HTML inicial", suggestion: "Use um único <h1> que diga do que trata a página.", page: at }));
  else if (info.h1 > 1) out.push(finding({ category: "acessibilidade", severity: "low", title: `${info.h1} títulos h1 na mesma página`, evidence: `${info.h1} elementos <h1> no HTML`, suggestion: "Mantenha um h1 e use h2/h3 para as seções.", page: at }));
  if (info.imagesWithoutAlt > 0) out.push(finding({ category: "acessibilidade", severity: "medium", title: `${info.imagesWithoutAlt} de ${info.images} imagens sem texto alternativo`, evidence: `${info.imagesWithoutAlt} <img> sem atributo alt`, suggestion: 'Descreva cada imagem no alt (ou use alt="" se for decorativa).', page: at }));
  return { info, findings: out };
}
