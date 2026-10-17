import { describe, it, expect } from "vitest";
import { exaCrawl } from "../../api/_lib/exa.js";

describe("exaCrawl", () => {
  it("chama /contents com a chave e junta página inicial e subpáginas sem repetir", async () => {
    let req: any;
    const fake = (async (url: string, init: any) => {
      req = { url, headers: init.headers, body: JSON.parse(init.body) };
      return new Response(JSON.stringify({ results: [{ url: "https://a.com/", title: "A", text: "home", subpages: [{ url: "https://a.com/x", title: "X", text: "x" }, { url: "https://a.com/", title: "A", text: "dup" }], extras: { links: ["https://a.com/x"] } }], costDollars: { total: 0.004 } }));
    }) as unknown as typeof fetch;
    const r = await exaCrawl("https://a.com/", { apiKey: "k", doFetch: fake });
    expect(req.url).toBe("https://api.exa.ai/contents");
    expect(req.headers["x-api-key"]).toBe("k");
    expect(req.body).toMatchObject({ urls: ["https://a.com/"], subpages: 6, livecrawl: "preferred" });
    expect(r.pages.map((p) => p.url)).toEqual(["https://a.com/", "https://a.com/x"]);
    expect(r.cost).toBe(0.004);
  });
  it("erro HTTP ou site ilegível viram erro com motivo", async () => {
    await expect(exaCrawl("https://a.com/", { apiKey: "k", doFetch: (async () => new Response("bad key", { status: 401 })) as unknown as typeof fetch })).rejects.toThrow(/401: bad key/);
    await expect(exaCrawl("https://a.com/", { apiKey: "k", doFetch: (async () => new Response(JSON.stringify({ results: [], statuses: [{ error: { tag: "CRAWL_NOT_FOUND" } }] }))) as unknown as typeof fetch })).rejects.toThrow(/CRAWL_NOT_FOUND/);
  });
});
