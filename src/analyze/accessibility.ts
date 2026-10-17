import AxeBuilder from "@axe-core/playwright";
import type { Page } from "playwright";
import { makeFinding } from "../explore/findings.js";
import type { Finding, Severity } from "../explore/types.js";
import type { ScreenRef } from "./technical.js";

const SEVERITY: Record<string, Severity> = { critical: "critical", serious: "high", moderate: "medium", minor: "low" };

/** Varredura axe da tela atual. Violações viram achados de acessibilidade, uma por regra. */
export async function accessibilityFindings(page: Page, screen: ScreenRef): Promise<Finding[]> {
  const results = await new AxeBuilder({ page: page as unknown as ConstructorParameters<typeof AxeBuilder>[0]["page"] }).analyze();
  return results.violations.map((v) =>
    makeFinding({
      category: "accessibility",
      severity: SEVERITY[v.impact ?? "moderate"] ?? "medium",
      origin: "measured",
      scope: "global",
      screenId: screen.id,
      title: `Acessibilidade: ${v.help}`,
      description: `${v.description}. Regra axe \`${v.id}\`. ${v.helpUrl}`,
      rule: `axe:${v.id}`,
      evidence: v.nodes.slice(0, 3).map((n) => `${screen.routePattern}: ${n.target.join(" ")}`),
      reproduction: screen.path,
      suggestion: v.nodes[0]?.failureSummary?.split("\n").slice(1, 3).join(" ").trim() || undefined,
    }),
  );
}
