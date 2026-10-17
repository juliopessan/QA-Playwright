import { describe, it, expect } from "vitest";
import { zipSync, strToU8 } from "fflate";
import {
  checkCode, findRun, isReportFile, openCreds, pickFromZip, recentRuns, rewriteImages, runTitle, sealCreds, signToken,
  validateCred, validateTarget, verifyToken, config,
} from "../../api/_lib/core.js";

const ID = "3f2b8c1e-9a4d-4e6f-8b2a-1c3d5e7f9a0b";

describe("validateTarget", () => {
  it("aceita sites públicos http(s) e remove o fragmento", () => {
    expect(validateTarget("https://app.exemplo.com/login#x")).toEqual({ ok: true, url: "https://app.exemplo.com/login" });
    expect(validateTarget(" http://saas.io ").ok).toBe(true);
  });
  it.each([
    ["", /Informe/], ["ftp://x.com", /http/], ["javascript:alert(1)", /http/], ["nao é url", /inválida/],
    ["https://user:pw@app.com", /usuário e senha/], ["http://localhost:3000", /públicos/], ["http://127.0.0.1", /públicos/],
    ["http://10.0.0.5", /públicos/], ["http://192.168.1.1", /públicos/], ["http://172.20.1.1", /públicos/], ["http://169.254.169.254/latest", /públicos/],
    ["http://[::1]/", /públicos/], ["http://intranet/", /públicos/], ["http://db.internal", /públicos/], ["http://printer.local", /públicos/],
  ])("recusa %s", (url, msg) => {
    const r = validateTarget(url);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(msg);
  });
});

describe("credenciais", () => {
  it("cifra e decifra; o texto cifrado não contém a senha e muda a cada vez", () => {
    const a = sealCreds({ user: "ana", pass: "s3gr3do!" }, "chave");
    const b = sealCreds({ user: "ana", pass: "s3gr3do!" }, "chave");
    expect(a).not.toBe(b);
    expect(a).not.toContain("s3gr3do");
    expect(openCreds(a, "chave")).toEqual({ user: "ana", pass: "s3gr3do!" });
  });
  it("chave errada ou payload adulterado falham", () => {
    const a = sealCreds({ user: "ana", pass: "x" }, "chave");
    expect(() => openCreds(a, "outra")).toThrow();
    expect(() => openCreds(a.slice(0, -2) + "AA", "chave")).toThrow();
    expect(() => openCreds("", "chave")).toThrow();
  });
  it("recusa quebras de linha e valores longos (iriam para variáveis de ambiente)", () => {
    expect(validateCred("ok", "Usuário").ok).toBe(true);
    expect(validateCred("", "Usuário")).toEqual({ ok: true, value: "" });
    expect(validateCred("a\nAPP_X=1", "Usuário").ok).toBe(false);
    expect(validateCred("x".repeat(300), "Senha").ok).toBe(false);
  });
});

describe("token de leitura", () => {
  it("vale para o id certo até expirar", () => {
    const now = Date.parse("2026-10-17T12:00:00Z");
    const t = signToken(ID, "k", 3600, now);
    expect(verifyToken(ID, t, "k", now + 1000)).toBe(true);
    expect(verifyToken(ID, t, "k", now + 3601_000)).toBe(false);
    expect(verifyToken(ID.replace("3f", "4f"), t, "k", now)).toBe(false);
    expect(verifyToken(ID, t, "outra", now)).toBe(false);
    expect(verifyToken("nao-uuid", t, "k", now)).toBe(false);
    expect(verifyToken(ID, "123.abc", "k", now)).toBe(false);
  });
});

describe("código de acesso", () => {
  it("aceita só códigos da lista (mínimo de 6 caracteres)", () => {
    expect(checkCode("TIME-QA-2026", "abc, TIME-QA-2026 ,outro123")).toBe(true);
    expect(checkCode(" TIME-QA-2026 ", "TIME-QA-2026")).toBe(true);
    expect(checkCode("abc", "abc,TIME-QA-2026")).toBe(false);
    expect(checkCode("errado", "TIME-QA-2026")).toBe(false);
    expect(checkCode("", "")).toBe(false);
    expect(checkCode(undefined, "TIME-QA-2026")).toBe(false);
  });
});

describe("execuções e artefatos", () => {
  it("acha a execução pelo nome e conta as das últimas 24 h", () => {
    const now = Date.parse("2026-10-17T12:00:00Z");
    const runs = [
      { id: 1, display_title: runTitle(ID), created_at: "2026-10-17T11:00:00Z" },
      { id: 2, display_title: "explore outro", created_at: "2026-10-16T13:00:00Z" },
      { id: 3, display_title: "explore velho", created_at: "2026-10-15T10:00:00Z" },
      { id: 4, display_title: "QA Agent", created_at: "2026-10-17T11:00:00Z" },
    ];
    expect(findRun(runs, ID)?.id).toBe(1);
    expect(findRun(runs, "x")).toBeUndefined();
    expect(recentRuns(runs, now)).toBe(2);
  });

  it("lê o relatório, as imagens e o erro de dentro do zip do artefato", () => {
    const entries = { "20261017-1/relatorio.html": strToU8("<html>"), "20261017-1/img/home.jpg": strToU8("jpg"), "erro.txt": strToU8("falhou") };
    const unzipped = Object.fromEntries(Object.entries(entries));
    expect(new TextDecoder().decode(pickFromZip(unzipped, "relatorio.html"))).toBe("<html>");
    expect(new TextDecoder().decode(pickFromZip(unzipped, "img/home.jpg"))).toBe("jpg");
    expect(new TextDecoder().decode(pickFromZip(unzipped, "erro.txt"))).toBe("falhou");
    expect(pickFromZip(unzipped, "img/nao.jpg")).toBeUndefined();
    expect(zipSync(entries).length).toBeGreaterThan(0);
  });

  it("só serve o relatório e imagens jpg de img/", () => {
    expect(isReportFile("relatorio.html")).toBe(true);
    expect(isReportFile("img/team--aba-convites.jpg")).toBe(true);
    for (const bad of ["../.env", "img/../../x.jpg", "dados/achados.json", "img/x.svg", "", null]) expect(isReportFile(bad), String(bad)).toBe(false);
  });

  it("reescreve as imagens para a função de relatório", () => {
    expect(rewriteImages('<img src="img/a.jpg">', ID, "1.sig")).toBe(`<img src="/api/report?id=${ID}&t=1.sig&file=img/a.jpg">`);
  });

  it("aponta a configuração que falta", () => {
    expect(config({}).missing).toEqual(["QA_GITHUB_TOKEN", "QA_GITHUB_REPO", "QA_INPUT_KEY", "QA_ACCESS_CODES"]);
    expect(config({ QA_GITHUB_TOKEN: "t", QA_GITHUB_REPO: "o/r", QA_INPUT_KEY: "k", QA_ACCESS_CODES: "c" }).missing).toEqual([]);
  });
});
