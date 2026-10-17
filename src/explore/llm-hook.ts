import { uxFindings } from "../analyze/ux.js";
import { LLMBudgetExceeded } from "../llm/budget.js";
import type { LLMProvider } from "../llm/provider.js";
import { emptyUsage, addUsage } from "../llm/provider.js";
import type { DiskCache } from "./cache.js";
import type { ScreenContext, ScreenHookResult } from "./crawler.js";
import { openSuggested, suggestElements } from "./deepen.js";

export interface ScreenHookOptions {
  provider: LLMProvider;
  /** Liga a análise de UX (uma chamada por tela nova). */
  ux: boolean;
  cache?: DiskCache;
  extraWriteVerbs: string[];
  maskSelectors?: string[];
}

const MAX_CONSECUTIVE_FAILURES = 3;

/** Gancho do crawler com LLM: Aprofundador e UX, no máximo uma chamada de cada por tela nova. */
export function makeScreenHook(o: ScreenHookOptions): (ctx: ScreenContext) => Promise<ScreenHookResult | void> {
  let disabled = false;
  let failures = 0;
  const noted = new Set<string>();
  const reportedUx: string[] = [];

  return async (ctx) => {
    if (disabled || !ctx.first) return;
    const out: Required<ScreenHookResult> = { findings: [], states: [], notes: [], llm: { calls: 0, inputTokens: 0, outputTokens: 0 } };
    let usage = emptyUsage();
    const note = (n: string) => {
      if (!noted.has(n)) {
        noted.add(n);
        out.notes.push(n);
      }
    };
    const fail = (e: unknown, step: string) => {
      if (e instanceof LLMBudgetExceeded) {
        disabled = true;
        note(`Orçamento de chamadas ao LLM esgotado: o restante da exploração usou só as análises objetivas. ${e.message}`);
        return;
      }
      const msg = (e as Error).message.split("\n")[0];
      note(`LLM indisponível (${step}): ${msg}`);
      if (++failures >= MAX_CONSECUTIVE_FAILURES) {
        disabled = true;
        note("LLM desativado após falhas consecutivas; o restante da exploração usou só as análises objetivas.");
      }
    };

    try {
      const { elements, usage: u } = await suggestElements(ctx.page, ctx, { provider: o.provider, cache: o.cache });
      if (u) usage = addUsage(usage, u);
      failures = 0;
      out.states.push(...(await openSuggested(ctx.page, ctx, elements, { extraWriteVerbs: o.extraWriteVerbs, maskSelectors: o.maskSelectors })));
    } catch (e) {
      fail(e, "aprofundador");
    }

    if (o.ux && !disabled) {
      try {
        const { findings, usage: u } = await uxFindings(ctx.page, { id: ctx.screen.id, routePattern: ctx.screen.routePattern, path: ctx.screen.path, heading: ctx.screen.heading }, { provider: o.provider, maskSelectors: o.maskSelectors, alreadyReported: reportedUx });
        usage = addUsage(usage, u);
        out.findings.push(...findings);
        reportedUx.push(...findings.map((f) => f.title));
        failures = 0;
      } catch (e) {
        fail(e, "UX");
      }
    }

    out.llm = { calls: usage.calls, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens };
    return out;
  };
}
