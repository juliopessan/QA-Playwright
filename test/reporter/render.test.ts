import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderReport } from "../../src/reporter/render.js";
import { writeReport } from "../../src/reporter/write.js";
import { ManifestWriter } from "../../src/run/manifest.js";
import { main, type CliIO } from "../../src/cli/index.js";
import type { CaseVerdict, RunManifest, StepResult } from "../../src/types/index.js";

const step = (i: number, status: StepResult["status"], extra: Partial<StepResult> = {}): StepResult => ({
  stepIndex: i,
  text: `Passo ${i} do Excel`,
  status,
  durationMs: 1200,
  screenshotBefore: `evidence/TC-1/0${i}-before.png`,
  screenshotAfter: `evidence/TC-1/0${i}-after.png`,
  actions: [`Ação ${i}`],
  ...extra,
});
const verdict = (id: string, status: CaseVerdict["status"], steps: StepResult[] = [step(1, "pass")], extra: Partial<CaseVerdict> = {}): CaseVerdict => ({
  caseId: id,
  title: `Título ${id}`,
  status,
  reasoning: `Parecer ${id}`,
  evidenceRefs: [],
  steps,
  ...extra,
});
const manifest = (verdicts: CaseVerdict[], extra: Partial<RunManifest> = {}): RunManifest => ({
  runId: "20261016-123456-ab12",
  startedAt: "2026-10-16T12:34:56.000Z",
  finishedAt: "2026-10-16T12:36:00.000Z",
  env: "demo",
  cliVersion: "0.1.0",
  model: "anthropic:claude-sonnet-5-5",
  commit: "abc1234",
  usage: { calls: 7, inputTokens: 1000, outputTokens: 200 },
  verdicts,
  issues: [],
  ...extra,
});
const png = () => Buffer.from("PNGDATA");
const html = (m: RunManifest, mode: "linked" | "embedded" = "linked") => renderReport(m, { mode, readImage: () => png() });

describe("renderReport", () => {
  const m = manifest([
    verdict("TC-1", "pass"),
    verdict("TC-2", "pass"),
    verdict("TC-3", "fail", [step(1, "fail", { error: "botão não achado" })]),
    verdict("TC-4", "needs-review"),
    verdict("TC-5", "blocked", []),
    verdict("TC-6", "pass", [step(1, "healed", { healNote: "trocou seletor", heals: [{ from: "Clicar em Entrar", to: ["Clicar em Login"], note: "trocou seletor" }] })]),
  ]);

  it("contadores batem com os vereditos do manifest", () => {
    const h = html(m);
    expect(h).toMatch(/data-count="pass">3</);
    expect(h).toMatch(/data-count="fail">1</);
    expect(h).toMatch(/data-count="needs-review">1</);
    expect(h).toMatch(/data-count="blocked">1</);
    expect(h).toMatch(/data-count="healed">1</);
  });

  it("cada status tem ícone + texto", () => {
    const h = html(m);
    for (const label of ["✓ Aprovado", "✕ Reprovado", "◐ Revisão humana", "⊘ Bloqueado", "⚙ Autocorrigido"]) expect(h).toContain(label);
  });

  it("seção Autocorreções lista o antes/depois e a nota do healer", () => {
    const h = html(m);
    expect(h).toContain("Autocorreções");
    expect(h).toContain("Clicar em Entrar");
    expect(h).toContain("Clicar em Login");
    expect(h).toContain("trocou seletor");
  });

  it("cabeçalho traz run, ambiente, modelo, versão e commit", () => {
    const h = html(m);
    for (const v of ["20261016-123456-ab12", "demo", "anthropic:claude-sonnet-5-5", "0.1.0", "abc1234"]) expect(h).toContain(v);
  });

  it("mostra texto do passo, erro e parecer", () => {
    const h = html(m);
    expect(h).toContain("Passo 1 do Excel");
    expect(h).toContain("botão não achado");
    expect(h).toContain("Parecer TC-3");
  });

  it("modo linked referencia ../evidence/... e modo embedded usa data: URI", () => {
    expect(html(m, "linked")).toContain('src="../evidence/TC-1/01-after.png"');
    const e = html(m, "embedded");
    expect(e).toContain("data:image/png;base64,UE5HREFUQQ==");
    expect(e).not.toContain('src="../evidence');
  });

  it("HTML não referencia assets externos", () => {
    const h = html(m, "embedded");
    expect(h).not.toMatch(/(src|href)="https?:\/\//);
    expect(h).not.toMatch(/<link[^>]+stylesheet/);
  });

  it("título de caso com <script> sai escapado", () => {
    const h = html(manifest([verdict("TC-X", "pass", [step(1, "pass")], { title: "<script>alert(1)</script>" })]));
    expect(h).not.toContain("<script>alert(1)</script>");
    expect(h).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("texto de passo, erro e parecer com HTML também saem escapados", () => {
    const h = html(
      manifest([
        verdict("TC-X", "fail", [step(1, "fail", { text: "<img src=x onerror=alert(1)>", error: "<b>erro</b>" })], { reasoning: "<i>x</i>" }),
      ]),
    );
    expect(h).not.toContain("<img src=x");
    expect(h).not.toContain("<b>erro</b>");
    expect(h).not.toContain("<i>x</i>");
  });

  it("ID de caso com acentos e barra gera âncora sanitizada", () => {
    const h = html(manifest([verdict("TC/ç 1", "pass")]));
    const ids = [...h.matchAll(/\bid="(case-[^"]*)"/g)].map((x) => x[1]);
    expect(ids).toHaveLength(1);
    expect(ids[0]).toMatch(/^case-[A-Za-z0-9_-]+$/);
  });

  it("segredo já mascarado no manifest permanece mascarado no HTML", () => {
    const h = html(manifest([verdict("TC-1", "pass", [step(1, "pass", { actions: ["Digitar •••• na senha"] })])]));
    expect(h).toContain("Digitar •••• na senha");
  });

  it("run abortado exibe o aviso no topo", () => {
    const h = html(manifest([verdict("TC-1", "pass")], { aborted: "Sessão SSO expirada." }));
    expect(h).toContain("Sessão SSO expirada.");
  });

  it("issues de leitura do Excel são listadas", () => {
    const h = html(manifest([verdict("TC-1", "pass")], { issues: [{ row: 7, caseId: "TC-1", message: "Passo ausente" }] }));
    expect(h).toContain("linha 7");
    expect(h).toContain("Passo ausente");
  });

  it("nenhum caso: relatório vazio não quebra", () => {
    const h = html(manifest([]));
    expect(h).toContain("Nenhum caso");
  });
});

describe("writeReport e CLI report", () => {
  async function makeRun() {
    const runsDir = mkdtempSync(join(tmpdir(), "qa-rep-"));
    const runDir = join(runsDir, "20261016-123456-ab12");
    mkdirSync(join(runDir, "evidence", "TC-1"), { recursive: true });
    writeFileSync(join(runDir, "evidence", "TC-1", "01-before.png"), png());
    writeFileSync(join(runDir, "evidence", "TC-1", "01-after.png"), png());
    const w = new ManifestWriter(runDir, { runId: "20261016-123456-ab12", startedAt: "2026-10-16T12:00:00Z", env: "demo", cliVersion: "0.1.0", model: "fake" });
    await w.append(verdict("TC-1", "pass"));
    await w.finish();
    return { runsDir, runDir };
  }

  it("writeReport escreve report/index.html e devolve o caminho", async () => {
    const { runDir } = await makeRun();
    const file = await writeReport(runDir);
    expect(file).toBe(join(runDir, "report", "index.html"));
    expect(readFileSync(file, "utf8")).toContain("data:image/png;base64,");
  });

  it("writeReport em modo linked não embute imagens", async () => {
    const { runDir } = await makeRun();
    const file = await writeReport(runDir, { mode: "linked" });
    expect(readFileSync(file, "utf8")).not.toContain("data:image/png");
  });

  it("qa-agent report abre o último run e imprime o caminho", async () => {
    const { runsDir } = await makeRun();
    const out: string[] = [];
    const io: CliIO = { out: (s) => out.push(s), err: () => {}, env: {}, runsDir };
    const code = await main(["report"], io);
    expect(code).toBe(0);
    expect(existsSync(out.join("\n").trim())).toBe(true);
  });

  it("qa-agent report --run inexistente sai 2", async () => {
    const { runsDir } = await makeRun();
    const err: string[] = [];
    const io: CliIO = { out: () => {}, err: (s) => err.push(s), env: {}, runsDir };
    const code = await main(["report", "--run", "nao-existe"], io);
    expect(code).toBe(2);
    expect(err.join("\n")).toContain("run não encontrado");
  });
});
