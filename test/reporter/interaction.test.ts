import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import AxeBuilder from "@axe-core/playwright";
import { renderReport } from "../../src/reporter/render.js";
import type { CaseVerdict, RunManifest, StepResult } from "../../src/types/index.js";

// PNG 1x1 válido
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const step = (i: number, status: StepResult["status"], extra: Partial<StepResult> = {}): StepResult => ({
  stepIndex: i,
  text: `Passo ${i}`,
  status,
  durationMs: 900,
  screenshotBefore: "evidence/x/01-before.png",
  screenshotAfter: "evidence/x/01-after.png",
  actions: ["Clicar em Login"],
  ...extra,
});
const v = (id: string, status: CaseVerdict["status"], steps: StepResult[] = [step(1, "pass")]): CaseVerdict => ({
  caseId: id,
  title: `Título do ${id}`,
  status,
  reasoning: `Parecer do ${id}`,
  evidenceRefs: [],
  steps,
});
const manifest: RunManifest = {
  runId: "20261016-123456-ab12",
  startedAt: "2026-10-16T12:34:56.000Z",
  finishedAt: "2026-10-16T12:36:00.000Z",
  env: "demo",
  cliVersion: "0.1.0",
  model: "fake",
  usage: { calls: 3, inputTokens: 1, outputTokens: 1 },
  issues: [],
  verdicts: [
    v("TC-001", "pass"),
    v("TC-007", "pass"),
    v("TC-010", "fail", [step(1, "fail", { error: "Total: $99.99 não encontrado" })]),
    v("TC-009", "needs-review"),
    v("TC-011", "blocked", [step(1, "skipped", { error: "não resolvido" })]),
    v("TC-012", "pass", [step(1, "healed", { healNote: "trocou seletor", heals: [{ from: "A", to: ["B"], note: "trocou seletor" }] })]),
  ],
};

let browser: Browser;
let file: string;
beforeAll(async () => {
  browser = await chromium.launch();
  const html = renderReport(manifest, { mode: "embedded", readImage: () => PNG });
  file = join(mkdtempSync(join(tmpdir(), "qa-html-")), "index.html");
  writeFileSync(file, html);
});
afterAll(async () => {
  await browser.close();
});

async function open(scheme: "light" | "dark" = "light"): Promise<Page> {
  const ctx = await browser.newContext({ colorScheme: scheme, viewport: { width: 1200, height: 900 } });
  const page = await ctx.newPage();
  await page.goto("file://" + file);
  return page;
}
const visibleIds = (page: Page) =>
  page.$$eval(".case:not(.hidden)", (els) => els.map((e) => e.querySelector(".cid")!.textContent));

describe("relatório: interação", () => {
  it("por padrão só aparecem fail, needs-review e blocked", async () => {
    const page = await open();
    expect((await visibleIds(page)).sort()).toEqual(["TC-009", "TC-010", "TC-011"]);
    await page.close();
  });

  it('filtro "Aprovados" mostra só pass (e desliga o modo atenção)', async () => {
    const page = await open();
    await page.click('[data-filter="pass"]');
    expect((await visibleIds(page)).sort()).toEqual(["TC-001", "TC-007", "TC-012"]);
    expect(await page.isChecked("#attention")).toBe(false);
    await page.close();
  });

  it('"Todos" mostra todos os casos', async () => {
    const page = await open();
    await page.click('[data-filter="all"]');
    expect(await visibleIds(page)).toHaveLength(6);
    await page.close();
  });

  it('busca por "TC-007" mostra 1 caso', async () => {
    const page = await open();
    await page.click('[data-filter="all"]');
    await page.fill("#q", "tc-007");
    expect(await visibleIds(page)).toEqual(["TC-007"]);
    await page.close();
  });

  it("busca sem resultado mostra a mensagem de vazio", async () => {
    const page = await open();
    await page.click('[data-filter="all"]');
    await page.fill("#q", "inexistente");
    expect(await page.isVisible("#empty")).toBe(true);
    await page.close();
  });

  it("Enter abre o acordeão por teclado", async () => {
    const page = await open();
    await page.focus("#case-TC-010 > summary");
    await page.keyboard.press("Enter");
    expect(await page.$eval("#case-TC-010", (d) => (d as HTMLDetailsElement).open)).toBe(true);
    await page.close();
  });

  it("clicar no print abre o lightbox e Esc fecha devolvendo o foco", async () => {
    const page = await open();
    await page.click('[data-filter="all"]');
    await page.click("#case-TC-001 > summary");
    const shot = page.locator("#case-TC-001 .shot").first();
    await shot.click();
    expect(await page.getAttribute("#lightbox", "data-open")).toBe("true");
    expect(await page.getAttribute("#lb-img", "src")).toContain("data:image/png;base64,");
    await page.keyboard.press("Escape");
    expect(await page.getAttribute("#lightbox", "data-open")).toBe("false");
    expect(await page.evaluate(() => document.activeElement?.classList.contains("shot"))).toBe(true);
    await page.close();
  });

  it("impressão: todos os casos expandidos e a barra de filtros oculta", async () => {
    const page = await open();
    await page.emulateMedia({ media: "print" });
    await page.waitForTimeout(100);
    expect(await visibleIds(page)).toHaveLength(6);
    expect(await page.$$eval(".case", (els) => els.every((e) => (e as HTMLDetailsElement).open))).toBe(true);
    expect(await page.isVisible("#filters")).toBe(false);
    await page.emulateMedia({ media: "screen" });
    await page.close();
  });

  it("sem casos de atenção, o modo atenção começa desligado", async () => {
    const m: RunManifest = { ...manifest, verdicts: [v("TC-001", "pass")] };
    const f = join(mkdtempSync(join(tmpdir(), "qa-html-")), "i.html");
    writeFileSync(f, renderReport(m, { mode: "embedded", readImage: () => PNG }));
    const page = await browser.newPage();
    await page.goto("file://" + f);
    expect(await visibleIds(page)).toEqual(["TC-001"]);
    await page.close();
  });
});

describe.each(["light", "dark"] as const)("relatório: acessibilidade (%s)", (scheme) => {
  it("axe: zero violações", async () => {
    const page = await open(scheme);
    await page.click('[data-filter="all"]');
    await page.$$eval("details.case", (els) => els.forEach((e) => ((e as HTMLDetailsElement).open = true)));
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations.map((x) => `${x.id}: ${x.nodes.map((n) => n.target.join(" ")).join(" | ")}`)).toEqual([]);
    await page.close();
  });
});
