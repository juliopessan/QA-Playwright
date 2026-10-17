import { describe, it, expect } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main, type CliIO } from "../../src/cli/index.js";
import { writeDocs } from "../../src/docs/markdown.js";
import { makeFinding } from "../../src/explore/findings.js";
import { FakeGitHub } from "../support/fake-github.js";

const RUN = "20261017-101010-abcd";
function setup() {
  const outDir = mkdtempSync(join(tmpdir(), "qa-clipub-"));
  mkdirSync(join(outDir, RUN), { recursive: true });
  const f = makeFinding({ category: "technical", severity: "high", origin: "measured", title: "Erro 500", description: "d", rule: "http 500", scope: "screen", screenId: "billing" });
  writeDocs(
    { runId: RUN, baseUrl: "http://x", startedAt: "2026-10-17T10:00:00.000Z", screens: [{ id: "billing", routePattern: "/billing", title: "F", heading: "F", exampleUrls: ["http://x/billing"], path: ["Início"], states: [] }], edges: [], findings: [f], blocked: [], limitsHit: [], skipped: [], llm: { calls: 0, inputTokens: 0, outputTokens: 0, notes: [] } },
    join(outDir, RUN),
  );
  return { outDir, f };
}
function io(github?: FakeGitHub, env: Record<string, string | undefined> = { GITHUB_TOKEN: "t0ken-fake" }) {
  const out: string[] = [];
  const err: string[] = [];
  const cli: CliIO = { out: (s) => out.push(s), err: (s) => err.push(s), env, github };
  return { cli, out, err };
}
const NOENV = ["--env-file", "/nao/existe.env", "--config", "/nao/existe.yaml"];

describe("qa-agent publish / issues", () => {
  it("publish --pr abre o PR; issues abre só o marcado e não duplica", async () => {
    const { outDir, f } = setup();
    const gh = new FakeGitHub();
    const p = io(gh);
    expect(await main(["publish", RUN, "--pr", "--repo", "o/r", "--out-dir", outDir, ...NOENV], p.cli)).toBe(0);
    expect(p.out.join("\n")).toMatch(/github\.com\/o\/r\/pull\/1/);
    expect(p.out.join("\n")).toMatch(/merge/);

    const none = io(gh);
    expect(await main(["issues", RUN, "--repo", "o/r", "--out-dir", outDir, ...NOENV], none.cli)).toBe(0);
    expect(none.out.join("\n")).toMatch(/Nenhum achado marcado/);

    gh.approve(`qa/${RUN}`, `qa-report/${RUN}/achados.md`, [f.id]);
    const i1 = io(gh);
    expect(await main(["issues", RUN, "--repo", "o/r", "--out-dir", outDir, ...NOENV], i1.cli)).toBe(0);
    expect(i1.out.join("\n")).toMatch(/Issue criada: .*issues\/100/);
    const i2 = io(gh);
    await main(["issues", RUN, "--repo", "o/r", "--out-dir", outDir, ...NOENV], i2.cli);
    expect(i2.out.join("\n")).toMatch(/não duplicada/);
    expect(gh.issues).toHaveLength(1);
  });

  it("sem GITHUB_TOKEN sai com 2 e orienta; nada é enviado", async () => {
    const { outDir } = setup();
    const t = io(undefined, {});
    expect(await main(["publish", RUN, "--pr", "--repo", "o/r", "--out-dir", outDir, ...NOENV], t.cli)).toBe(2);
    expect(t.err.join("\n")).toMatch(/GITHUB_TOKEN/);
  });

  it("sem --repo nem config, repo inválido ou run inexistente saem com 2", async () => {
    const { outDir } = setup();
    const gh = new FakeGitHub();
    const a = io(gh);
    expect(await main(["publish", RUN, "--pr", "--out-dir", outDir, ...NOENV], a.cli)).toBe(2);
    expect(a.err.join("\n")).toMatch(/--repo/);
    const b = io(gh);
    expect(await main(["publish", RUN, "--pr", "--repo", "isso não é repo", "--out-dir", outDir, ...NOENV], b.cli)).toBe(2);
    const c = io(gh);
    expect(await main(["publish", "nao-existe", "--pr", "--repo", "o/r", "--out-dir", outDir, ...NOENV], c.cli)).toBe(2);
    expect(gh.calls).toEqual([]);
  });

  it("usa publicar.repo do config quando --repo não é dado", async () => {
    const { outDir } = setup();
    const cfg = join(outDir, "c.yaml");
    writeFileSync(cfg, "publicar:\n  repo: acme/saas\n");
    const gh = new FakeGitHub();
    const t = io(gh);
    expect(await main(["publish", RUN, "--pr", "--out-dir", outDir, "--env-file", "/nao/existe.env", "--config", cfg], t.cli)).toBe(0);
    expect(t.out.join("\n")).toContain("acme/saas");
  });
});
