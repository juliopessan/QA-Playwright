import { join } from "node:path";
import { chromium, type Page } from "playwright";
import { accessibilityFindings } from "../analyze/accessibility.js";
import { performanceFindings, type PerfLimits } from "../analyze/performance.js";
import { technicalFindings } from "../analyze/technical.js";
import { attachCollectors, collectMetrics } from "../explore/collect.js";
import { settle } from "../explore/crawler.js";
import { dedupeFindings } from "../explore/findings.js";
import { loginWithForm } from "../explore/login.js";
import { normalizeRoute, screenSlug } from "../explore/routes.js";
import type { ExploreResult, Screen } from "../explore/types.js";
import type { LLMProvider } from "../llm/provider.js";
import { maskedScreenshot } from "../masking/index.js";
import { isHostAllowed } from "../runner/execute.js";
import type { Env } from "../vars/index.js";
import type { Objective } from "./parse.js";
import { runFlow } from "./run-flow.js";

export interface RunFlowsOptions {
  baseUrl: string;
  user: string;
  pass: string;
  storageState?: string;
  runDir: string;
  provider: LLMProvider;
  env: Env;
  perf: PerfLimits;
  allowedHosts?: string[];
  maskSelectors?: string[];
  maxSteps?: number;
  headed?: boolean;
}

/**
 * Executa os fluxos-objetivo (escrita permitida) e acrescenta ao resultado os fluxos, as telas novas
 * que eles alcançaram e os achados das telas por onde passaram. Só navegações para hosts permitidos.
 */
export async function runFlows(objectives: Objective[], opts: RunFlowsOptions, result: ExploreResult): Promise<void> {
  if (objectives.length === 0) return;
  const allowedHosts = opts.allowedHosts ?? [new URL(opts.baseUrl).hostname];
  const browser = await chromium.launch({ headless: !opts.headed });
  try {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      ...(opts.storageState ? { storageState: opts.storageState } : {}),
    });
    const page = await context.newPage();
    await page.route("**/*", (route) => {
      const req = route.request();
      if (req.isNavigationRequest() && req.frame() === page.mainFrame() && !isHostAllowed(req.url(), allowedHosts)) {
        return route.abort("blockedbyclient");
      }
      return route.fallback();
    });
    await page.goto(opts.baseUrl, { waitUntil: "load", timeout: 30_000 });
    if (!opts.storageState) await loginWithForm(page, { user: opts.user, pass: opts.pass });
    await settle(page, 300, 2000);
    const home = page.url();
    const collector = attachCollectors(page);
    const findings = [...result.findings];

    result.flows ??= [];
    for (const obj of objectives) {
      await page.goto(home, { waitUntil: "load", timeout: 20_000 }).catch(() => undefined);
      await settle(page, 300, 2000);
      collector.flush();
      const touched = new Set<string>();
      const path = [`Fluxo: ${obj.title}`];

      const analyzeCurrent = async (p: Page) => {
        await settle(p, 300, 1500);
        const pattern = normalizeRoute(p.url());
        let screen = result.screens.find((s) => s.routePattern === pattern);
        const isNew = !screen;
        if (!screen) {
          let id = screenSlug(pattern);
          const used = new Set(result.screens.map((s) => s.id));
          for (let n = 2; used.has(id); n++) id = `${screenSlug(pattern)}-${n}`;
          const h1 = p.locator("h1").first();
          const heading = (await h1.count()) > 0 ? (await h1.innerText().catch(() => "")).trim() : (await p.title().catch(() => "")).trim();
          screen = { id, routePattern: pattern, title: await p.title().catch(() => ""), heading, exampleUrls: [p.url()], path, states: [] } satisfies Screen;
          const rel = `img/${id}.jpg`;
          await maskedScreenshot(p, opts.maskSelectors ?? [], { path: join(opts.runDir, rel), type: "jpeg", quality: 75, fullPage: true }).catch(() => undefined);
          screen.screenshot = rel;
          result.screens.push(screen);
        }
        touched.add(screen.id);
        const ref = { id: screen.id, routePattern: pattern, path: screen.path };
        findings.push(...technicalFindings(ref, collector.flush()));
        if (isNew) {
          try {
            findings.push(...(await accessibilityFindings(p, ref)));
          } catch (e) {
            result.llm.notes.push(`Acessibilidade não analisada em ${pattern}: ${(e as Error).message.split("\n")[0]}`);
          }
          findings.push(...performanceFindings(await collectMetrics(p), opts.perf, ref));
        }
      };

      const outcome = await runFlow(obj, {
        page,
        provider: opts.provider,
        env: opts.env,
        runDir: opts.runDir,
        baseUrl: opts.baseUrl,
        allowedHosts,
        maskSelectors: opts.maskSelectors,
        maxSteps: opts.maxSteps,
        onStep: analyzeCurrent,
      });
      result.flows.push({
        id: obj.id,
        title: obj.title,
        goal: obj.goal,
        success: obj.success,
        status: outcome.status,
        reasoning: outcome.reasoning,
        steps: outcome.steps,
        screenIds: [...touched],
      });
    }
    result.findings = dedupeFindings(findings);
  } finally {
    await browser.close();
  }
}
