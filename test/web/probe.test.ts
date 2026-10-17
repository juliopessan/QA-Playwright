import { describe, it, expect } from "vitest";
import { fetchPage, inspectHtml, measuredFindings } from "../../api/_lib/probe.js";

const GOOD = `<!doctype html><html lang="pt-BR"><head><title>Ukode Labs</title><meta name="description" content="Software sob medida">
<meta name="viewport" content="width=device-width"></head><body><h1>Ukode</h1><img src="a.png" alt="Logo"></body></html>`;
const SECURE = { "strict-transport-security": "max-age=1", "content-security-policy": "frame-ancestors 'self'", "x-content-type-options": "nosniff" };
const page = (over: Partial<{ status: number; finalUrl: string; ms: number; headers: Record<string, string>; html: string; bytes: number }> = {}) =>
  ({ status: 200, finalUrl: "https://ukodelabs.com.br/", ms: 300, headers: SECURE, html: GOOD, bytes: 2000, ...over });

describe("inspectHtml", () => {
  it("extrai título, descrição, idioma, viewport, h1 e imagens sem alt", () => {
    const i = inspectHtml(`<html lang=pt><title> A  B </title><meta content="d" name="description"><h1>x</h1><h1>y</h1><img src=1><img alt="" src=2>`);
    expect(i).toMatchObject({ title: "A B", description: "d", lang: "pt", viewport: "", h1: 2, images: 2, imagesWithoutAlt: 1 });
  });
});

describe("measuredFindings", () => {
  it("página bem configurada não gera achados", () => {
    expect(measuredFindings(page()).findings).toEqual([]);
  });

  it("aponta segurança, desempenho, SEO e acessibilidade com evidência", () => {
    const { findings } = measuredFindings(page({ headers: {}, ms: 3500, html: "<html><body><img src=x><img src=y></body></html>" }));
    const titles = findings.map((f) => f.title).join(" | ");
    expect(titles).toMatch(/HSTS/);
    expect(titles).toMatch(/Content-Security-Policy/);
    expect(titles).toMatch(/Resposta lenta: 3,5 s/);
    expect(titles).toMatch(/não tem <title>/);
    expect(titles).toMatch(/idioma/);
    expect(titles).toMatch(/viewport/);
    expect(titles).toMatch(/2 de 2 imagens sem texto alternativo/);
    expect(findings.every((f) => f.origin === "measured" && f.evidence && f.suggestion)).toBe(true);
  });

  it("HTTP sem HTTPS e erro 500 são graves", () => {
    const f = measuredFindings(page({ finalUrl: "http://x.com/", status: 500 })).findings;
    expect(f.filter((x) => x.severity === "high").map((x) => x.title)).toEqual(["A página responde com erro HTTP 500", "O site não usa HTTPS"]);
  });
});

describe("fetchPage", () => {
  const dnsPublic = async () => [{ address: "200.1.2.3", family: 4 }];
  it("segue redirecionamentos validando cada salto e mede o tempo", async () => {
    const calls: string[] = [];
    const fake = (async (url: string) => {
      calls.push(url);
      if (url === "http://ukodelabs.com.br/") return new Response(null, { status: 301, headers: { location: "https://ukodelabs.com.br/" } });
      return new Response(GOOD, { status: 200, headers: { "content-type": "text/html", "Strict-Transport-Security": "max-age=1" } });
    }) as unknown as typeof fetch;
    const r = await fetchPage("http://ukodelabs.com.br/", { doFetch: fake, resolve: dnsPublic as never });
    expect(calls).toEqual(["http://ukodelabs.com.br/", "https://ukodelabs.com.br/"]);
    expect(r).toMatchObject({ status: 200, finalUrl: "https://ukodelabs.com.br/" });
    expect(r.headers["strict-transport-security"]).toBe("max-age=1");
  });

  it("recusa domínio que resolve para rede privada e redirecionamento para localhost", async () => {
    const never = (async () => new Response("x")) as unknown as typeof fetch;
    await expect(fetchPage("https://evil.example.com/", { doFetch: never, resolve: (async () => [{ address: "169.254.169.254", family: 4 }]) as never })).rejects.toThrow(/rede privada/);
    const toLocal = (async () => new Response(null, { status: 302, headers: { location: "http://localhost/admin" } })) as unknown as typeof fetch;
    await expect(fetchPage("https://site.com/", { doFetch: toLocal, resolve: dnsPublic as never })).rejects.toThrow(/não permitido/);
  });
});
