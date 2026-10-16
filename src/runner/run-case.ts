import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Page, Route } from "playwright";
import type { AppConfig } from "../config/index.js";
import { compileStep } from "../compiler/compile.js";
import type { CompileCache } from "../compiler/cache.js";
import type { LLMProvider } from "../llm/provider.js";
import { maskedScreenshot, redactText } from "../masking/index.js";
import { isSessionExpired } from "../auth/index.js";
import type { Env } from "../vars/index.js";
import type { Action, CompiledStep, Step, StepResult, TestCase } from "../types/index.js";
import { executeAction, isHostAllowed, redactSecrets, type ExecCtx } from "./execute.js";

export type HealFn = (failure: {
  step: Step;
  action: Action;
  error: string;
  page: Page;
}) => Promise<{ actions: Action[]; note: string } | undefined>;

export interface RunDeps {
  page: Page;
  provider: LLMProvider;
  cache: CompileCache;
  cfg: AppConfig;
  env: Env;
  /** Diretório `<runDir>/evidence`. */
  evidenceDir: string;
  heal?: HealFn;
}

export interface CaseResult {
  steps: StepResult[];
  compiled: CompiledStep[];
  aborted?: "session-expired";
}

export const safeId = (id: string): string => id.replace(/[^A-Za-z0-9_-]/g, "_");

const pad = (n: number) => String(n).padStart(2, "0");

export async function runCase(tc: TestCase, deps: RunDeps): Promise<CaseResult> {
  const { page, cfg } = deps;
  const ctx: ExecCtx = {
    timeoutMs: cfg.stepTimeoutMs,
    allowedHosts: cfg.allowedHosts,
    baseUrl: cfg.baseUrl,
    env: deps.env,
    secrets: new Set(),
    blocked: [],
  };
  const dir = safeId(tc.id);
  mkdirSync(join(deps.evidenceDir, dir), { recursive: true });
  const loginRe = cfg.loginUrlPattern ? new RegExp(cfg.loginUrlPattern) : undefined;

  const guard = (route: Route) => {
    const req = route.request();
    if (req.isNavigationRequest() && req.frame() === page.mainFrame() && !isHostAllowed(req.url(), cfg.allowedHosts)) {
      ctx.blocked.push(new URL(req.url()).hostname);
      return route.abort("blockedbyclient");
    }
    return route.fallback();
  };
  await page.route("**/*", guard);

  const steps: StepResult[] = [];
  const compiledSteps: CompiledStep[] = [];
  let stop = false;
  let aborted: CaseResult["aborted"];

  const shot = async (step: Step, which: "before" | "after") => {
    const file = `${pad(step.index)}-${which}.png`;
    try {
      await maskedScreenshot(page, cfg.maskSelectors, { path: join(deps.evidenceDir, dir, file) });
      return `evidence/${dir}/${file}`;
    } catch {
      return undefined;
    }
  };

  try {
    for (const step of tc.steps) {
      if (stop) {
        steps.push({ stepIndex: step.index, status: "skipped", durationMs: 0 });
        continue;
      }
      const t0 = Date.now();
      const result: StepResult = { stepIndex: step.index, status: "pass", durationMs: 0 };
      result.screenshotBefore = await shot(step, "before");

      let comp: CompiledStep;
      let llmError: string | undefined;
      try {
        comp = await compileStep(step, { page, provider: deps.provider, cache: deps.cache, cfg });
      } catch (e) {
        llmError = redactSecrets(e instanceof Error ? e.message : String(e), ctx);
        comp = { stepIndex: step.index, kind: "action", actions: [], confidence: 0, subjective: false, fromCache: false };
      }
      compiledSteps.push(comp);

      if (llmError || comp.confidence < cfg.minConfidence) {
        result.status = "skipped";
        result.error = llmError ?? `Passo não resolvido com confiança suficiente (${comp.confidence})`;
        stop = true;
      } else {
        const observed: string[] = [];
        for (const action of comp.actions) {
          try {
            const r = await executeAction(page, action, ctx);
            if (r.observed) observed.push(r.observed);
          } catch (e) {
            result.status = "fail";
            result.error = e instanceof Error ? e.message : String(e);
            stop = true;
            break;
          }
        }
        if (comp.subjective && result.status === "pass") {
          const text = await page.locator("body").innerText().catch(() => "");
          observed.push(redactSecrets(redactText(text, cfg.redactPatterns), ctx).slice(0, 1500));
        }
        if (observed.length) result.observed = observed.join("\n");
      }

      if (loginRe && isSessionExpired(page, loginRe)) {
        result.status = "skipped";
        result.error = "Sessão expirada: redirecionado para o login";
        result.screenshotAfter = await shot(step, "after");
        result.durationMs = Date.now() - t0;
        steps.push(result);
        aborted = "session-expired";
        break;
      }
      result.screenshotAfter = await shot(step, "after");
      result.durationMs = Date.now() - t0;
      steps.push(result);
    }
  } finally {
    await page.unroute("**/*", guard).catch(() => undefined);
  }
  return { steps, compiled: compiledSteps, ...(aborted ? { aborted } : {}) };
}
