import { describe, it, expect, beforeEach } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeDocs } from "../../src/docs/markdown.js";
import { makeFinding } from "../../src/explore/findings.js";
import type { ExploreResult, Finding } from "../../src/explore/types.js";
import { openIssues, issueMarker } from "../../src/publish/issues.js";
import { publishRun, PublishError } from "../../src/publish/publish.js";
import { HttpGitHubClient, GitHubAuthError } from "../../src/publish/github.js";
import { FakeGitHub } from "../support/fake-github.js";

const RUN = "20261017-101010-abcd";
const mk = (rule: string, severity: Finding["severity"], title: string): Finding =>
  makeFinding({ category: "technical", severity, origin: "measured", title, description: `Descrição de ${title}`, rule, scope: "screen", screenId: "billing", evidence: ["GET /api → 500"], reproduction: ["Início", "Faturas"], suggestion: "Corrigir" });

function makeRun() {
  const base = mkdtempSync(join(tmpdir(), "qa-pub-"));
  const runDir = join(base, RUN);
  mkdirSync(join(runDir, "img"), { recursive: true });
  writeFileSync(join(runDir, "img/billing.jpg"), Buffer.from([0xff, 0xd8, 0xff]));
  const r: ExploreResult = {
    runId: RUN, baseUrl: "http://x", startedAt: "2026-10-17T10:00:00.000Z",
    screens: [{ id: "billing", routePattern: "/billing", title: "Faturas", heading: "Faturas", exampleUrls: ["http://x/billing"], path: ["Início", "Faturas"], screenshot: "img/billing.jpg", states: [] }],
    edges: [], blocked: [], limitsHit: [], skipped: [], llm: { calls: 0, inputTokens: 0, outputTokens: 0, notes: [] },
    findings: [mk("http 500", "high", "Erro 500 em faturas"), mk("lento", "medium", "Tela lenta")],
  };
  writeDocs(r, runDir);
  return { runDir, findings: r.findings };
}

let gh: FakeGitHub;
beforeEach(() => {
  gh = new FakeGitHub();
});

describe("publishRun", () => {
  it("cria a branch qa/<runId> com a pasta do relatório e abre o PR com o README no corpo", async () => {
    const { runDir } = makeRun();
    const r = await publishRun({ client: gh, repo: "o/r", runDir, runId: RUN });
    expect(r.branch).toBe(`qa/${RUN}`);
    const paths = gh.branches.get(`qa/${RUN}`)!.map((f) => f.path);
    expect(paths).toContain(`qa-report/${RUN}/README.md`);
    expect(paths).toContain(`qa-report/${RUN}/achados.md`);
    expect(paths).toContain(`qa-report/${RUN}/img/billing.jpg`);
    expect(gh.prs).toHaveLength(1);
    expect(gh.prs[0].body).toContain("Relatório de QA");
    expect(gh.prs[0].body).toMatch(/não faça merge/i);
    expect(gh.prs[0].head).toBe(`qa/${RUN}`);
  });

  it("aborta sem enviar nada se algum arquivo contém um segredo", async () => {
    const { runDir } = makeRun();
    writeFileSync(join(runDir, "cobertura.md"), "senha vazou: s3gredo-forte-123");
    await expect(publishRun({ client: gh, repo: "o/r", runDir, runId: RUN, secrets: ["s3gredo-forte-123"] })).rejects.toThrow(/segredo/);
    writeFileSync(join(runDir, "cobertura.md"), "chave " + "sk-ant-" + "api03-abcdefghijklmnop");
    await expect(publishRun({ client: gh, repo: "o/r", runDir, runId: RUN })).rejects.toBeInstanceOf(PublishError);
    expect(gh.calls).toEqual([]);
  });

  it("recusa pasta que não é um run", async () => {
    await expect(publishRun({ client: gh, repo: "o/r", runDir: mkdtempSync(join(tmpdir(), "qa-vazio-")), runId: RUN })).rejects.toThrow(/README/);
  });
});

describe("openIssues", () => {
  async function published() {
    const run = makeRun();
    await publishRun({ client: gh, repo: "o/r", runDir: run.runDir, runId: RUN });
    return run;
  }

  it("abre issues só dos achados marcados, com marcador de id e rótulos", async () => {
    const { runDir, findings } = await published();
    gh.approve(`qa/${RUN}`, `qa-report/${RUN}/achados.md`, [findings[0].id]);
    const r = await openIssues({ client: gh, repo: "o/r", runDir, runId: RUN, labels: ["qa-agent"] });
    expect(r.created).toHaveLength(1);
    expect(gh.issues).toHaveLength(1);
    expect(gh.issues[0].body).toContain(issueMarker(findings[0].id));
    expect(gh.issues[0].body).toContain("Como reproduzir");
    expect(gh.issues[0].labels).toEqual(["qa-agent", "severidade:high"]);
    expect(gh.issues[0].title).toMatch(/Erro 500/);
  });

  it("não duplica: segunda execução reaproveita a issue aberta pelo id", async () => {
    const { runDir, findings } = await published();
    gh.approve(`qa/${RUN}`, `qa-report/${RUN}/achados.md`, [findings[0].id]);
    await openIssues({ client: gh, repo: "o/r", runDir, runId: RUN });
    const again = await openIssues({ client: gh, repo: "o/r", runDir, runId: RUN });
    expect(again.created).toHaveLength(0);
    expect(again.duplicates).toEqual([{ id: findings[0].id, number: 100 }]);
    expect(gh.issues).toHaveLength(1);
  });

  it("grava o número da issue em dados/achados.json", async () => {
    const { runDir, findings } = await published();
    gh.approve(`qa/${RUN}`, `qa-report/${RUN}/achados.md`, [findings[1].id]);
    await openIssues({ client: gh, repo: "o/r", runDir, runId: RUN });
    const saved = JSON.parse(readFileSync(join(runDir, "dados/achados.json"), "utf8")) as Finding[];
    expect(saved.find((f) => f.id === findings[1].id)!.issue).toBe(100);
    expect(saved.find((f) => f.id === findings[0].id)!.issue).toBeUndefined();
  });

  it("nenhum checkbox marcado: nada é aberto; branch inexistente dá erro orientando o publish", async () => {
    const { runDir } = await published();
    expect((await openIssues({ client: gh, repo: "o/r", runDir, runId: RUN })).created).toEqual([]);
    expect(gh.issues).toHaveLength(0);
    await expect(openIssues({ client: gh, repo: "o/r", runDir, runId: "outro-run" })).rejects.toThrow(/publish/);
  });

  it("id marcado que não existe em achados.json é reportado como desconhecido", async () => {
    const { runDir, findings } = await published();
    gh.approve(`qa/${RUN}`, `qa-report/${RUN}/achados.md`, [findings[0].id]);
    writeFileSync(join(runDir, "dados/achados.json"), JSON.stringify([findings[1]]));
    const r = await openIssues({ client: gh, repo: "o/r", runDir, runId: RUN });
    expect(r.unknown).toEqual([findings[0].id]);
    expect(gh.issues).toHaveLength(0);
  });
});

describe("HttpGitHubClient", () => {
  it("sem token falha com mensagem clara", () => {
    const old = process.env.GITHUB_TOKEN;
    delete process.env.GITHUB_TOKEN;
    try {
      expect(() => new HttpGitHubClient()).toThrow(/GITHUB_TOKEN/);
      expect(() => new HttpGitHubClient()).toThrow(GitHubAuthError);
    } finally {
      if (old !== undefined) process.env.GITHUB_TOKEN = old;
    }
  });

  it("usa Bearer, cria blob/tree/commit/ref/PR e nunca vaza o token em erros", async () => {
    const seen: Array<{ method: string; url: string; auth: string | null }> = [];
    const fake = (async (url: string, init: RequestInit) => {
      seen.push({ method: init.method ?? "GET", url, auth: new Headers(init.headers).get("authorization") });
      const u = new URL(url);
      const j = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status });
      if (u.pathname === "/repos/o/r") return j({ default_branch: "main" });
      if (u.pathname.endsWith("/git/ref/heads/main")) return j({ object: { sha: "base1" } });
      if (u.pathname.endsWith("/git/commits/base1")) return j({ tree: { sha: "tree0" } });
      if (u.pathname.endsWith("/git/blobs")) return j({ sha: "blob1" }, 201);
      if (u.pathname.endsWith("/git/trees")) return j({ sha: "tree1" }, 201);
      if (u.pathname.endsWith("/git/commits")) return j({ sha: "commit1" }, 201);
      if (u.pathname.endsWith("/git/refs")) return j({}, 201);
      if (u.pathname.endsWith("/pulls")) return j({ number: 7, html_url: "https://github.com/o/r/pull/7" }, 201);
      return j({ message: "Bad credentials" }, 401);
    }) as unknown as typeof fetch;
    const c = new HttpGitHubClient({ token: "tok-secreto-123", fetch: fake });
    const b = await c.createBranchWithFiles({ repo: "o/r", branch: "qa/x", message: "m", files: [{ path: "a.md", content: Buffer.from("oi") }] });
    expect(b).toEqual({ branch: "qa/x", commitSha: "commit1" });
    expect(await c.createPR({ repo: "o/r", head: "qa/x", title: "t", body: "b" })).toEqual({ number: 7, url: "https://github.com/o/r/pull/7" });
    expect(seen.every((s) => s.auth === "Bearer tok-secreto-123")).toBe(true);
    const err = await c.listOpenIssues({ repo: "o/r" }).catch((e: Error) => e);
    expect(err).toBeInstanceOf(GitHubAuthError);
    expect((err as Error).message).not.toContain("tok-secreto-123");
  });

  it("getFile devolve undefined em 404 e decodifica base64", async () => {
    const fake = (async (url: string) =>
      url.includes("achados.md") ? new Response(JSON.stringify({ content: Buffer.from("olá").toString("base64"), encoding: "base64" })) : new Response("{}", { status: 404 })) as unknown as typeof fetch;
    const c = new HttpGitHubClient({ token: "t", fetch: fake });
    expect(await c.getFile({ repo: "o/r", ref: "b", path: "x/achados.md" })).toBe("olá");
    expect(await c.getFile({ repo: "o/r", ref: "b", path: "x/outro.md" })).toBeUndefined();
  });
});
