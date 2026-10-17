import { describe, it, expect } from "vitest";
import { evidenceFound, isPrivateAddress, makeLimiter, validateTarget } from "../../api/_lib/core.js";

describe("validateTarget", () => {
  it("aceita sites públicos, completa https:// e remove o fragmento", () => {
    expect(validateTarget("https://ukodelabs.com.br/#x")).toEqual({ ok: true, url: "https://ukodelabs.com.br/" });
    expect(validateTarget("ukodelabs.com.br")).toEqual({ ok: true, url: "https://ukodelabs.com.br/" });
    expect(validateTarget(" http://saas.io/precos ").ok).toBe(true);
  });
  it.each([
    ["", /Informe/], ["ftp://x.com", /http/], ["javascript:alert(1)", /http/],
    ["https://user:pw@app.com", /usuário e senha/], ["http://localhost:3000", /públicos/], ["http://127.0.0.1", /públicos/],
    ["http://10.0.0.5", /públicos/], ["http://8.8.8.8", /públicos/], ["http://[::1]/", /públicos/], ["http://intranet/", /públicos/],
    ["http://db.internal", /públicos/], ["http://printer.local", /públicos/],
  ])("recusa %s", (url, msg) => {
    const r = validateTarget(url);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(msg);
  });
});

describe("isPrivateAddress", () => {
  it.each(["10.1.2.3", "127.0.0.1", "169.254.169.254", "192.168.0.1", "172.16.5.4", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:10.0.0.1"])("%s é privado", (ip) =>
    expect(isPrivateAddress(ip)).toBe(true));
  it.each(["8.8.8.8", "172.32.0.1", "200.147.67.142", "2606:4700::6810:84e5"])("%s é público", (ip) => expect(isPrivateAddress(ip)).toBe(false));
});

describe("makeLimiter", () => {
  it("permite até o máximo por janela e libera depois", () => {
    const lim = makeLimiter({ max: 2, windowMs: 1000 });
    expect(lim("ip", 0).ok).toBe(true);
    expect(lim("ip", 10).ok).toBe(true);
    const blocked = lim("ip", 20);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryInSec).toBe(1);
    expect(lim("outro", 20).ok).toBe(true);
    expect(lim("ip", 1001).ok).toBe(true);
  });
});

describe("evidenceFound", () => {
  const pages = [{ url: "u", title: "Início", text: "Transformamos ideias em   Soluções Digitais.\nFale conosco" }];
  it("acha trechos literais ignorando acentos, maiúsculas e espaços", () => {
    expect(evidenceFound("transformamos ideias em solucoes digitais", pages)).toBe(true);
    expect(evidenceFound("“Fale conosco”", pages)).toBe(true);
  });
  it("recusa trechos inventados ou curtos demais", () => {
    expect(evidenceFound("Peça seu orçamento grátis", pages)).toBe(false);
    expect(evidenceFound("em", pages)).toBe(false);
  });
});
