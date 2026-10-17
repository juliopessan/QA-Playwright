import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { zipSync, strToU8 } from "fflate";
import analyze from "../../api/analyze.js";
import status from "../../api/status.js";
import report from "../../api/report.js";
import { openCreds, runTitle, signToken } from "../../api/_lib/core.js";

const ENV = { QA_GITHUB_TOKEN: "gh-token", QA_GITHUB_REPO: "dono/repo", QA_INPUT_KEY: "chave-teste", QA_ACCESS_CODES: "TIME-QA-2026", QA_DAILY_LIMIT: "3" };
const ID = "3f2b8c1e-9a4d-4e6f-8b2a-1c3d5e7f9a0b";

type Call = { url: string; method: string; body?: any; auth?: string };
let calls: Call[];
let runs: any[];
let artifactZip: Uint8Array | undefined;

function fakeGitHub() {
  return vi.fn(async (url: string, init: any = {}) => {
    const u = new URL(url);
    calls.push({ url: u.pathname + u.search, method: init.method ?? "GET", body: init.body ? JSON.parse(init.body) : undefined, auth: init.headers?.Authorization });
    const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s });
    if (u.pathname.endsWith("/dispatches")) return new Response(null, { status: 204 });
    if (u.pathname.endsWith("/runs")) return json({ workflow_runs: runs });
    if (/\/runs\/\d+\/artifacts$/.test(u.pathname)) return json({ artifacts: artifactZip ? [{ id: 9, name: `qa-report-${ID}`, expired: false }] : [] });
    if (u.pathname.endsWith("/artifacts/9/zip")) return new Response(artifactZip as unknown as BodyInit, { status: 200 });
    return json({ message: "não encontrado" }, 404);
  });
}

function call(handler: any, req: { method?: string; url?: string; body?: any }) {
  const out: { status: number; headers: Record<string, string>; body: any } = { status: 0, headers: {}, body: undefined };
  const res = {
    set statusCode(v: number) { out.status = v; },
    setHeader(k: string, v: string) { out.headers[k.toLowerCase()] = v; },
    end(b: any) { out.body = b; },
  };
  return Promise.resolve(handler({ method: req.method ?? "GET", url: req.url ?? "/", body: req.body }, res)).then(() => {
    const ct = out.headers["content-type"] ?? "";
    return { ...out, json: ct.includes("json") ? JSON.parse(String(out.body)) : undefined };
  });
}

const valid = { url: "https://app.exemplo.com", user: "ana@empresa.com", pass: "s3gr3do!", code: "TIME-QA-2026", authorized: true };

beforeEach(() => {
  calls = [];
  runs = [];
  artifactZip = undefined;
  for (const [k, v] of Object.entries(ENV)) vi.stubEnv(k, v);
  vi.stubGlobal("fetch", fakeGitHub());
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("POST /api/analyze", () => {
  it("dispara o workflow com a URL, as credenciais cifradas e um id; devolve id e token", async () => {
    const r = await call(analyze, { method: "POST", body: valid });
    expect(r.status).toBe(202);
    expect(r.json.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(r.json.token).toMatch(/^\d+\./);
    const d = calls.find((c) => c.url.endsWith("/dispatches"))!;
    expect(d.url).toBe("/repos/dono/repo/actions/workflows/explore-web.yml/dispatches");
    expect(d.auth).toBe("Bearer gh-token");
    expect(d.body.ref).toBe("main");
    expect(d.body.inputs.target_url).toBe("https://app.exemplo.com/");
    expect(d.body.inputs.request_id).toBe(r.json.id);
    expect(JSON.stringify(d.body)).not.toContain("s3gr3do");
    expect(openCreds(d.body.inputs.payload, ENV.QA_INPUT_KEY)).toEqual({ user: "ana@empresa.com", pass: "s3gr3do!" });
  });

  it("sem configuração responde 503 e não chama o GitHub", async () => {
    vi.stubEnv("QA_GITHUB_TOKEN", "");
    const r = await call(analyze, { method: "POST", body: valid });
    expect(r.status).toBe(503);
    expect(calls).toEqual([]);
  });

  it.each([
    [{ code: "errado" }, 401, "code"],
    [{ url: "http://localhost:3000" }, 400, "url"],
    [{ user: "a\nb" }, 400, "user"],
    [{ authorized: false }, 400, "authorized"],
  ])("pedido inválido %j → %i sem disparar nada", async (over, code, field) => {
    const r = await call(analyze, { method: "POST", body: { ...valid, ...over } });
    expect(r.status).toBe(code);
    expect(r.json.field).toBe(field);
    expect(calls.filter((c) => c.method === "POST")).toEqual([]);
  });

  it("respeita o limite diário", async () => {
    const now = new Date().toISOString();
    runs = [1, 2, 3].map((i) => ({ id: i, display_title: `explore x${i}`, created_at: now }));
    const r = await call(analyze, { method: "POST", body: valid });
    expect(r.status).toBe(429);
    expect(r.json.error).toMatch(/Limite de 3/);
    expect(calls.some((c) => c.url.endsWith("/dispatches"))).toBe(false);
  });

  it("só aceita POST", async () => {
    expect((await call(analyze, { method: "GET" })).status).toBe(405);
  });
});

describe("GET /api/status", () => {
  const t = () => signToken(ID, ENV.QA_INPUT_KEY);
  const url = () => `/api/status?id=${ID}&t=${encodeURIComponent(t())}`;

  it("token inválido → 403", async () => {
    expect((await call(status, { url: `/api/status?id=${ID}&t=1.x` })).status).toBe(403);
  });

  it("fila, em andamento, concluído com relatório e falha com mensagem", async () => {
    expect((await call(status, { url: url() })).json.state).toBe("queued");

    runs = [{ id: 5, display_title: runTitle(ID), status: "in_progress", created_at: new Date().toISOString() }];
    expect((await call(status, { url: url() })).json.state).toBe("running");

    runs[0].status = "completed";
    artifactZip = zipSync({ "r1/relatorio.html": strToU8("<p>ok</p>"), "r1/dados/manifest.json": strToU8(JSON.stringify({ counts: { screens: 8, findings: 41, blocked: 1 } })) });
    const done = (await call(status, { url: url() })).json;
    expect(done.state).toBe("done");
    expect(done.summary).toEqual({ screens: 8, findings: 41, blocked: 1 });
    expect(done.reportUrl).toContain(`/api/report?id=${ID}`);

    artifactZip = zipSync({ "erro.txt": strToU8("Login falhou: credenciais recusadas\n") });
    const failed = (await call(status, { url: url() })).json;
    expect(failed).toEqual({ state: "failed", error: "Login falhou: credenciais recusadas" });
  });
});

describe("GET /api/report", () => {
  const t = () => encodeURIComponent(signToken(ID, ENV.QA_INPUT_KEY));
  beforeEach(() => {
    runs = [{ id: 5, display_title: runTitle(ID), status: "completed", created_at: new Date().toISOString() }];
    artifactZip = zipSync({ "r1/relatorio.html": strToU8('<img src="img/home.jpg">'), "r1/img/home.jpg": new Uint8Array([0xff, 0xd8]) });
  });

  it("serve o HTML com as imagens reescritas e uma CSP sem scripts", async () => {
    const r = await call(report, { url: `/api/report?id=${ID}&t=${t()}` });
    expect(r.status).toBe(200);
    expect(r.headers["content-type"]).toMatch(/text\/html/);
    expect(r.headers["content-security-policy"]).toMatch(/default-src 'none'/);
    expect(r.headers["content-security-policy"]).not.toMatch(/script-src/);
    expect(String(r.body)).toContain(`src="/api/report?id=${ID}&t=`);
  });

  it("serve imagens; recusa arquivo fora do relatório e token errado", async () => {
    const img = await call(report, { url: `/api/report?id=${ID}&t=${t()}&file=img/home.jpg` });
    expect(img.status).toBe(200);
    expect(img.headers["content-type"]).toBe("image/jpeg");
    expect((await call(report, { url: `/api/report?id=${ID}&t=${t()}&file=dados/achados.json` })).status).toBe(400);
    expect((await call(report, { url: `/api/report?id=${ID}&t=0.x` })).status).toBe(403);
  });
});
