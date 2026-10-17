import { makeFinding } from "../explore/findings.js";
import type { PageMetrics } from "../explore/collect.js";
import type { Finding } from "../explore/types.js";
import type { ScreenRef } from "./technical.js";

export interface PerfLimits {
  lcpMs: number;
  cls: number;
  loadMs: number;
}

export const DEFAULT_LIMITS: PerfLimits = { lcpMs: 2500, cls: 0.1, loadMs: 5000 };

/** Métricas acima dos limites viram achados de desempenho (por tela). */
export function performanceFindings(m: PageMetrics, limits: PerfLimits, screen: ScreenRef): Finding[] {
  const out: Finding[] = [];
  const add = (rule: string, title: string, value: string, limit: string, severe: boolean) =>
    out.push(
      makeFinding({
        category: "performance", severity: severe ? "high" : "medium", origin: "measured", scope: "screen", screenId: screen.id,
        title, description: `${title}: medido ${value}, limite ${limit}.`, rule,
        evidence: [`${screen.routePattern}: ${value} (limite ${limit})`], reproduction: screen.path,
        suggestion: "Reduzir trabalho no carregamento inicial (JS bloqueante, imagens grandes, renderização tardia).",
      }),
    );
  if (m.lcpMs > limits.lcpMs) add("lcp acima do limite", "LCP acima do limite", `${m.lcpMs} ms`, `${limits.lcpMs} ms`, m.lcpMs > limits.lcpMs * 2);
  if (m.cls > limits.cls) add("cls acima do limite", "CLS acima do limite", `${m.cls}`, `${limits.cls}`, m.cls > limits.cls * 2);
  if (m.loadMs > limits.loadMs) add("carregamento acima do limite", "Carregamento acima do limite", `${m.loadMs} ms`, `${limits.loadMs} ms`, m.loadMs > limits.loadMs * 2);
  return out;
}
