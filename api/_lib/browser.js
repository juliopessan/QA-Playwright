import { lookup } from "node:dns/promises";
import { isPrivateAddress, validateTarget } from "./core.js";

const IMPACT = { critical: "high", serious: "high", moderate: "medium", minor: "low" };
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const MAX_SHOT_BYTES = 330_000;

const sec = (ms) => (ms / 1000).toFixed(1).replace(".", ",");
const host = (u) => {
  try {
    return new URL(u).hostname.toLowerCase();
  } catch {
    return "";
  }
};

/** Lança o Chromium sem servidor (Vercel) com o Playwright. Injetável nos testes. */
export async function launchBrowser() {
  const [{ default: chromium }, { chromium: pw }] = await Promise.all([import("@sparticuz/chromium"), import("playwright-core")]);
  return pw.launch({ executablePath: await chromium.executablePath(), args: chromium.args, headless: true });
}

/** Páginas internas do mesmo domínio, vindas da leitura do Exa, sem repetir a inicial. */
export function pickInternal(home, urls, max = 3) {
  const h = host(home);
  const seen = new Set([home.replace(/\/$/, "")]);
  const out = [];
  for (const raw of urls) {
    const v = validateTarget(raw);
    if (!v.ok || host(v.url) !== h) continue;
    const key = v.url.replace(/\/$/, "");
    if (seen.has(key) || /\.(pdf|zip|png|jpe?g|svg|gif|webp|mp4)(\?|$)/i.test(key)) continue;
    seen.add(key);
    out.push(v.url);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Trava somente leitura da navegação: só GET/HEAD/OPTIONS e nunca para IPs privados, localhost ou
 * esquemas que não sejam http(s). Registra o que foi bloqueado.
 */
export async function installReadOnlyGuard(context, blocked, allowHosts = []) {
  await context.route("**/*", (route) => {
    const req = route.request();
    let u;
    try {
      u = new URL(req.url());
    } catch {
      return route.abort("blockedbyclient");
    }
    if (!SAFE_METHODS.has(req.method().toUpperCase())) {
      blocked.push(`${req.method()} ${u.host}${u.pathname}`);
      return route.abort("blockedbyclient");
    }
    if (u.protocol !== "http:" && u.protocol !== "https:") return route.abort("blockedbyclient");
    const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (allowHosts.includes(h)) return route.fallback();
    if (h === "localhost" || h.endsWith(".localhost") || h.includes(":") || (/^\d+\.\d+\.\d+\.\d+$/.test(h) && isPrivateAddress(h))) {
      blocked.push(`acesso a ${h}`);
      return route.abort("blockedbyclient");
    }
    return route.fallback();
  });
}

async function shotJpeg(page, opts) {
  let buf = await page.screenshot({ type: "jpeg", quality: 55, ...opts });
  if (buf.length > MAX_SHOT_BYTES) buf = await page.screenshot({ type: "jpeg", quality: 35, ...opts });
  return buf.length > MAX_SHOT_BYTES * 2 ? undefined : `data:image/jpeg;base64,${buf.toString("base64")}`;
}

/** Métricas do navegador: LCP, CLS e rolagem lateral (conferida no layout atual). */
const METRICS = () =>
  new Promise((resolve) => {
    let lcp = 0;
    let cls = 0;
    try {
      new PerformanceObserver((l) => l.getEntries().forEach((e) => (lcp = e.startTime))).observe({ type: "largest-contentful-paint", buffered: true });
      new PerformanceObserver((l) => l.getEntries().forEach((e) => { if (!e.hadRecentInput) cls += e.value; })).observe({ type: "layout-shift", buffered: true });
    } catch {}
    setTimeout(() => resolve({ lcp, cls, overflow: document.documentElement.scrollWidth - window.innerWidth, title: document.title }), 400);
  });

/**
 * @typedef {{ url: string, title: string, status: number, loadMs: number, desktop?: string, mobile?: string }} Shot
 * @typedef {{ origin: string, category: string, severity: string, title: string, evidence: string, suggestion?: string, description?: string, page: string }} WebFinding
 */

/**
 * @param {string[]} urls
 * @param {{ launch?: () => Promise<any>, resolve?: typeof lookup, axe?: (page: any) => Promise<any>, budgetMs?: number, now?: () => number, allowHosts?: string[] }} [opts]
 * Visita cada URL com o Chromium: screenshot de desktop (e de celular na página inicial), erros de
 * console e de rede, métricas de carregamento e varredura de acessibilidade (axe). Somente leitura.
 */
export async function inspectPages(urls, { launch = launchBrowser, resolve = lookup, axe, budgetMs = 60_000, now = Date.now, allowHosts = [] } = {}) {
  const started = now();
  /** @type {Shot[]} */
  const shots = [];
  /** @type {WebFinding[]} */
  const findings = [];
  /** @type {string[]} */
  const notes = [];
  /** @type {string[]} */
  const blocked = [];
  let browser;
  try {
    browser = await launch();
  } catch (e) {
    return { shots, findings, notes: [`O navegador não pôde ser iniciado: ${e.message}. A análise seguiu sem prints.`], blocked };
  }
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, userAgent: "Mozilla/5.0 (X11; Linux x86_64) QA-Agent/1.0 (+analise somente leitura)" });
    await installReadOnlyGuard(context, blocked, allowHosts);
    const runAxe = axe ?? (async (page) => new (await import("@axe-core/playwright")).default({ page }).analyze());
    for (const [i, url] of urls.entries()) {
      if (now() - started > budgetMs) {
        notes.push(`Tempo esgotado: ${urls.length - i} página(s) ficaram sem screenshot.`);
        break;
      }
      const addrs = await resolve(host(url), { all: true }).catch(() => []);
      if (!addrs.length || addrs.some((a) => isPrivateAddress(a.address))) {
        notes.push(`${url} ignorada: o domínio não resolve para um endereço público.`);
        continue;
      }
      const page = await context.newPage();
      const errors = [];
      const failed = [];
      page.on("pageerror", (e) => errors.push(String(e.message ?? e).split("\n")[0]));
      page.on("console", (m) => m.type() === "error" && errors.push(m.text().split("\n")[0]));
      page.on("response", (r) => r.status() >= 400 && failed.push({ url: r.url(), status: r.status() }));
      try {
        const t0 = now();
        const res = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 });
        await page.waitForLoadState("networkidle", { timeout: 4000 }).catch(() => undefined);
        const loadMs = now() - t0;
        const m = await page.evaluate(METRICS).catch(() => ({ lcp: 0, cls: 0, overflow: 0, title: "" }));
        const height = await page.evaluate(() => Math.min(document.documentElement.scrollHeight, 3600)).catch(() => 800);
        const desktop = await shotJpeg(page, { fullPage: true, clip: { x: 0, y: 0, width: 1280, height } }).catch(() => undefined);
        let mobile;
        let mobileOverflow = 0;
        if (i === 0) {
          await page.setViewportSize({ width: 390, height: 844 });
          await page.waitForTimeout(300);
          mobileOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth).catch(() => 0);
          mobile = await shotJpeg(page, { fullPage: false }).catch(() => undefined);
          await page.setViewportSize({ width: 1280, height: 800 });
        }
        let violations = [];
        try {
          violations = (await runAxe(page)).violations ?? [];
        } catch (e) {
          notes.push(`Acessibilidade (axe) não analisada em ${url}: ${String(e.message).split("\n")[0]}`);
        }
        const title = m.title || url;
        shots.push({ url, title, status: res?.status() ?? 0, loadMs, desktop, mobile });

        const at = { page: url };
        if (errors.length) findings.push({ origin: "measured", category: "tecnico", severity: errors.some((e) => /uncaught|referenceerror|typeerror/i.test(e)) ? "high" : "medium", title: `${errors.length} erro(s) no console do navegador`, evidence: errors.slice(0, 3).join(" | ").slice(0, 300), suggestion: "Abra o DevTools nesta página e corrija os erros de JavaScript.", ...at });
        const sub = failed.filter((f) => f.url !== url);
        if (sub.length) findings.push({ origin: "measured", category: "tecnico", severity: sub.some((f) => f.status >= 500) ? "high" : "low", title: `${sub.length} recurso(s) falharam ao carregar`, evidence: sub.slice(0, 3).map((f) => `${f.status} ${new URL(f.url).host}${new URL(f.url).pathname}`.slice(0, 120)).join(" | "), suggestion: "Corrija os links quebrados ou remova as referências a arquivos que não existem.", ...at });
        if (m.lcp > 2500) findings.push({ origin: "measured", category: "desempenho", severity: m.lcp > 4000 ? "high" : "medium", title: `Maior elemento da tela aparece em ${sec(m.lcp)} s (LCP)`, evidence: `LCP medido no navegador: ${Math.round(m.lcp)} ms (limite recomendado: 2500 ms)`, suggestion: "Otimize a imagem ou o texto principal do topo da página e reduza JavaScript que bloqueia a renderização.", ...at });
        if (m.cls > 0.1) findings.push({ origin: "measured", category: "desempenho", severity: "medium", title: `A página muda de lugar enquanto carrega (CLS ${m.cls.toFixed(2).replace(".", ",")})`, evidence: `CLS medido: ${m.cls.toFixed(3)} (limite recomendado: 0,1)`, suggestion: "Reserve espaço para imagens, anúncios e fontes para o conteúdo não pular.", ...at });
        if (mobileOverflow > 1) findings.push({ origin: "measured", category: "acessibilidade", severity: "medium", title: "No celular, a página rola para o lado", evidence: `Em 390 px de largura, o conteúdo excede a tela em ${mobileOverflow} px`, suggestion: "Ajuste larguras fixas e imagens para caberem na largura da tela.", ...at });
        for (const v of violations) {
          findings.push({ origin: "measured", category: "acessibilidade", severity: IMPACT[v.impact ?? "moderate"] ?? "medium", title: `Acessibilidade: ${v.help}`, description: `${v.description}. Regra axe ${v.id}.`, evidence: (v.nodes ?? []).slice(0, 2).map((n) => (n.target ?? []).join(" ")).join(" | ").slice(0, 240) || v.id, suggestion: (v.nodes?.[0]?.failureSummary ?? "").split("\n").slice(1, 3).join(" ").trim() || v.helpUrl, ...at });
        }
      } catch (e) {
        notes.push(`${url}: não carregou no navegador (${String(e.message).split("\n")[0]}).`);
      } finally {
        await page.close().catch(() => undefined);
      }
    }
  } finally {
    await browser.close().catch(() => undefined);
  }
  if (blocked.length) notes.push(`${blocked.length} requisição(ões) que poderiam alterar dados ou acessar redes internas foram bloqueadas pela trava somente leitura.`);
  return { shots, findings, notes, blocked };
}
