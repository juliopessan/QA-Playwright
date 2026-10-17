import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Page } from "playwright";
import { accessibilityFindings } from "../analyze/accessibility.js";
import { performanceFindings, type PerfLimits } from "../analyze/performance.js";
import { technicalFindings } from "../analyze/technical.js";
import { maskedScreenshot } from "../masking/index.js";
import { attachCollectors, collectMetrics } from "./collect.js";
import { dedupeFindings } from "./findings.js";
import { installNetworkGuard, shouldClick } from "./guard.js";
import { loginWithForm } from "./login.js";
import { normalizeRoute, screenSlug } from "./routes.js";
import type { BlockedAttempt, ExploreResult, Finding, Screen, ScreenState } from "./types.js";

export interface ExploreLimits {
  maxScreens: number;
  maxDepth: number;
  timeBudgetMs: number;
  examplesPerRoute: number;
}

export interface ScreenContext {
  page: Page;
  screen: Screen;
  outDir: string;
  /** Verdadeiro na primeira visita do padrão de rota. */
  first: boolean;
  recordBlocked(b: Omit<BlockedAttempt, "screenId">): void;
}

export interface ScreenHookResult {
  findings?: Finding[];
  states?: ScreenState[];
  notes?: string[];
  llm?: { calls: number; inputTokens: number; outputTokens: number };
}

export interface ExploreOptions {
  baseUrl: string;
  user: string;
  pass: string;
  /** Sessão SSO salva (`qa-agent login`); dispensa o login por formulário. */
  storageState?: string;
  outDir: string;
  runId?: string;
  limits: ExploreLimits;
  ignoreUrls: string[];
  extraWriteVerbs: string[];
  postAllowed: string[];
  perf: PerfLimits;
  allowedHosts?: string[];
  maskSelectors?: string[];
  headed?: boolean;
  /** Tempo sem mudanças no DOM para considerar a tela estável. */
  settleMs?: number;
  hooks?: { afterScreen?: (ctx: ScreenContext) => Promise<ScreenHookResult | void> };
}

const LOGOUT_TEXT = /^(sair|logout|log out|sign out|desconectar|encerrar sess[aã]o)$/i;
const LOGOUT_PATH = /logout|signout|sign-out/i;
const FILE_EXT = /\.(pdf|zip|csv|xlsx?|docx?|png|jpe?g|gif|svg|mp4|exe|dmg)$/i;
const LOGIN_PATH = /\/(login|signin|sign-in|entrar)\b/i;

/** Espera a rede ficar ociosa e o DOM parar de mudar (telas que renderizam com atraso). */
export async function settle(page: Page, quietMs = 1000, maxMs = 6000): Promise<void> {
  await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => undefined);
  await page
    .evaluate(
      ([q, m]) =>
        new Promise<void>((resolve) => {
          const start = Date.now();
          let timer = setTimeout(done, q);
          const mo = new MutationObserver(() => {
            clearTimeout(timer);
            if (Date.now() - start > m) return done();
            timer = setTimeout(done, q);
          });
          mo.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
          function done() {
            mo.disconnect();
            resolve();
          }
        }),
      [quietMs, maxMs] as const,
    )
    .catch(() => undefined);
}

const visitKey = (url: string) => {
  const u = new URL(url);
  u.hash = "";
  return u.href;
};

async function pageHeading(page: Page): Promise<string> {
  const h1 = page.locator("h1").first();
  if ((await h1.count()) > 0) return (await h1.innerText().catch(() => "")).trim();
  return (await page.title().catch(() => "")).trim();
}

interface Queued {
  url: string;
  depth: number;
  path: string[];
  from?: string;
}

export async function explore(opts: ExploreOptions): Promise<ExploreResult> {
  const started = Date.now();
  const startedAt = new Date().toISOString();
  const baseHost = new URL(opts.baseUrl).hostname;
  const allowedHosts = opts.allowedHosts ?? [baseHost];
  const { limits } = opts;
  mkdirSync(join(opts.outDir, "img"), { recursive: true });

  const result: ExploreResult = {
    runId: opts.runId ?? "",
    baseUrl: opts.baseUrl,
    startedAt,
    screens: [],
    edges: [],
    findings: [],
    blocked: [],
    limitsHit: [],
    skipped: [],
    llm: { calls: 0, inputTokens: 0, outputTokens: 0, notes: [] },
  };
  const hit = (l: string) => {
    if (!result.limitsHit.includes(l)) result.limitsHit.push(l);
  };

  const browser = await chromium.launch({ headless: !opts.headed });
  try {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      ...(opts.storageState ? { storageState: opts.storageState } : {}),
    });
    const page = await context.newPage();
    await page.goto(opts.baseUrl, { waitUntil: "load", timeout: 30_000 });
    if (!opts.storageState) await loginWithForm(page, { user: opts.user, pass: opts.pass });
    await settle(page, 300, 2000);
    const startUrl = page.url();

    // A guarda somente leitura só entra depois do login (que é uma escrita legítima).
    let currentScreenId: string | undefined;
    const guard = await installNetworkGuard(context, {
      postAllowed: opts.postAllowed,
      onBlock: (b) => {
        b.screenId = currentScreenId;
      },
    });
    const collector = attachCollectors(page);

    const registry = new Map<string, { screen: Screen; visits: number }>();
    const usedIds = new Set<string>();
    const findings: Finding[] = [];
    const pendingEdges: Array<[string, string]> = [];
    const visited = new Set<string>();
    const queued = new Set<string>([visitKey(startUrl)]);
    const queue: Queued[] = [{ url: startUrl, depth: 0, path: ["Início"] }];

    while (queue.length > 0) {
      if (Date.now() - started > limits.timeBudgetMs) {
        hit("tempoMaximo");
        break;
      }
      const item = queue.shift()!;
      const key = visitKey(item.url);
      if (visited.has(key)) continue;
      visited.add(key);

      const pattern = normalizeRoute(item.url);
      const known = registry.get(pattern);
      if (!known && registry.size >= limits.maxScreens) {
        hit("maxScreens");
        break;
      }
      if (known && known.visits >= limits.examplesPerRoute) {
        result.skipped.push({ url: item.url, reason: `exemplar extra do padrão ${pattern}` });
        if (item.from) pendingEdges.push([item.from, pattern]);
        continue;
      }

      collector.flush();
      try {
        await page.goto(item.url, { waitUntil: "load", timeout: 20_000 });
      } catch (e) {
        result.skipped.push({ url: item.url, reason: `falha ao abrir: ${(e as Error).message.split("\n")[0]}` });
        continue;
      }
      await settle(page, opts.settleMs ?? 1000);

      if (LOGIN_PATH.test(new URL(page.url()).pathname) && !LOGIN_PATH.test(new URL(item.url).pathname)) {
        hit("sessaoExpirada");
        break;
      }

      let entry = known;
      let first = false;
      if (!entry) {
        first = true;
        let id = screenSlug(pattern);
        for (let n = 2; usedIds.has(id); n++) id = `${screenSlug(pattern)}-${n}`;
        usedIds.add(id);
        const screen: Screen = {
          id,
          routePattern: pattern,
          title: await page.title().catch(() => ""),
          heading: await pageHeading(page),
          exampleUrls: [],
          path: item.path,
          states: [],
        };
        entry = { screen, visits: 0 };
        registry.set(pattern, entry);
        result.screens.push(screen);
      }
      const { screen } = entry;
      entry.visits++;
      if (!screen.exampleUrls.includes(item.url)) screen.exampleUrls.push(item.url);
      currentScreenId = screen.id;
      if (item.from) pendingEdges.push([item.from, pattern]);

      if (first) {
        const rel = `img/${screen.id}.jpg`;
        await maskedScreenshot(page, opts.maskSelectors ?? [], { path: join(opts.outDir, rel), type: "jpeg", quality: 75, fullPage: true }).catch(() => undefined);
        screen.screenshot = rel;
      }

      // Análises objetivas
      const ref = { id: screen.id, routePattern: pattern, path: screen.path };
      findings.push(...technicalFindings(ref, collector.flush()));
      try {
        findings.push(...(await accessibilityFindings(page, ref)));
      } catch (e) {
        result.llm.notes.push(`Acessibilidade não analisada em ${pattern}: ${(e as Error).message.split("\n")[0]}`);
      }
      findings.push(...performanceFindings(await collectMetrics(page), opts.perf, ref));

      // Ganchos (Aprofundador e UX, com LLM)
      if (opts.hooks?.afterScreen) {
        const extra = await opts.hooks
          .afterScreen({
            page,
            screen,
            outDir: opts.outDir,
            first,
            recordBlocked: (b) => result.blocked.push({ ...b, screenId: screen.id }),
          })
          .catch((e: Error): ScreenHookResult => ({ notes: [`Gancho falhou em ${pattern}: ${e.message.split("\n")[0]}`] }));
        if (extra) {
          findings.push(...(extra.findings ?? []));
          screen.states.push(...(extra.states ?? []));
          result.llm.notes.push(...(extra.notes ?? []));
          if (extra.llm) {
            result.llm.calls += extra.llm.calls;
            result.llm.inputTokens += extra.llm.inputTokens;
            result.llm.outputTokens += extra.llm.outputTokens;
          }
        }
        // O gancho pode ter navegado; voltamos à tela para extrair links.
        if (visitKey(page.url()) !== key) {
          await page.goto(item.url, { waitUntil: "load", timeout: 20_000 }).catch(() => undefined);
          await settle(page, 300, 2000);
        }
      }

      // Descoberta de links
      const links = await page.evaluate(() =>
        [...document.querySelectorAll("a[href]")].map((a) => ({
          href: (a as HTMLAnchorElement).getAttribute("href") ?? "",
          text: ((a as HTMLElement).innerText || a.getAttribute("aria-label") || "").trim(),
          download: a.hasAttribute("download"),
        })),
      );
      for (const l of links) {
        let target: URL;
        try {
          target = new URL(l.href, page.url());
        } catch {
          continue;
        }
        if (target.protocol !== "http:" && target.protocol !== "https:") continue;
        target.hash = "";
        const label = l.text || target.pathname;
        if (!allowedHosts.includes(target.hostname)) {
          result.skipped.push({ url: target.href, reason: "link externo" });
          continue;
        }
        if (LOGOUT_TEXT.test(l.text) || LOGOUT_PATH.test(target.pathname)) {
          result.skipped.push({ url: target.href, reason: "logout" });
          continue;
        }
        const ignored = opts.ignoreUrls.find((p) => target.pathname.includes(p));
        if (ignored) {
          result.skipped.push({ url: target.href, reason: `ignorarUrls (${ignored})` });
          continue;
        }
        if (l.download || FILE_EXT.test(target.pathname)) {
          result.skipped.push({ url: target.href, reason: "download/arquivo" });
          continue;
        }
        const verdict = shouldClick({ name: label, role: "link" }, opts.extraWriteVerbs);
        if (!verdict.allow) {
          result.blocked.push({ layer: "element", element: `link "${label}"`, url: target.href, reason: verdict.reason ?? "bloqueado", screenId: screen.id });
          continue;
        }
        const k = visitKey(target.href);
        if (queued.has(k)) {
          pendingEdges.push([screen.id, normalizeRoute(target.href)]);
          continue;
        }
        if (item.depth + 1 > limits.maxDepth) {
          if (!registry.has(normalizeRoute(target.href))) hit("maxDepth");
          continue;
        }
        queued.add(k);
        queue.push({ url: target.href, depth: item.depth + 1, path: [...item.path, label], from: screen.id });
      }
    }

    const idByPattern = new Map([...registry].map(([p, e]) => [p, e.screen.id]));
    const seen = new Set<string>();
    for (const [from, pattern] of pendingEdges) {
      const to = idByPattern.get(pattern);
      if (!to || to === from || seen.has(`${from}>${to}`)) continue;
      seen.add(`${from}>${to}`);
      result.edges.push([from, to]);
    }
    result.blocked.push(...guard.blocked);
    result.findings = dedupeFindings(findings);
    result.finishedAt = new Date().toISOString();
    return result;
  } finally {
    await browser.close();
  }
}
