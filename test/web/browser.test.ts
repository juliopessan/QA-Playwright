import { describe, it, expect } from "vitest";
import { chromium } from "playwright";
import { createServer } from "node:http";
import { inspectPages, installReadOnlyGuard, launchBrowser, pickInternal } from "../../api/_lib/browser.js";

describe("pickInternal", () => {
  it("só páginas do mesmo domínio, sem repetir a inicial nem arquivos, no máximo 3", () => {
    const urls = ["https://a.com/", "https://a.com/sobre", "https://b.com/x", "https://a.com/logo.png", "https://a.com/sobre#x", "https://a.com/preco", "https://a.com/blog", "https://a.com/contato", "javascript:alert(1)", "http://localhost/x"];
    expect(pickInternal("https://a.com/", urls)).toEqual(["https://a.com/sobre", "https://a.com/preco", "https://a.com/blog"]);
  });
});

const publicDns = async () => [{ address: "200.1.2.3", family: 4 }];

describe("inspectPages com um navegador de verdade", () => {
  it("fotografa, mede e aplica o axe; bloqueia escrita e acesso a rede privada", async () => {
    const hits: string[] = [];
    const server = createServer((req, res) => {
      hits.push(`${req.method} ${req.url}`);
      if (req.url === "/post" || req.url === "/private") { res.writeHead(200).end("ok"); return; }
      if (req.url === "/missing.js") { res.writeHead(404).end("no"); return; }
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(`<!doctype html><html><head><title>Página de teste</title></head><body>
        <h1>Olá</h1><img src="x.png"><div style="width:900px">largo</div>
        <script src="/missing.js"></script><script>console.error("falha de teste"); fetch("/post",{method:"POST",body:"{}"}).catch(()=>{}); fetch("http://169.254.169.254/latest/meta-data").catch(()=>{});</script></body></html>`);
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as any).port;
    const url = `http://127.0.0.1:${port}/`;
    try {
      const r = await inspectPages([url], { launch: () => chromium.launch(), resolve: publicDns as never, allowHosts: ["127.0.0.1"] });
      expect(r.shots).toHaveLength(1);
      expect(r.shots[0].title).toBe("Página de teste");
      expect(r.shots[0].desktop).toMatch(/^data:image\/jpeg;base64,/);
      expect(r.shots[0].mobile).toMatch(/^data:image\/jpeg;base64,/);
      const titles = r.findings.map((f) => f.title).join(" | ");
      expect(titles).toMatch(/erro\(s\) no console/);
      expect(titles).toMatch(/recurso\(s\) falharam/);
      expect(titles).toMatch(/Acessibilidade: Images must have alternative text|alternative text/i);
      expect(titles).toMatch(/No celular, a página rola para o lado/);
      expect(r.findings.every((f) => f.origin === "measured" && f.evidence)).toBe(true);
      expect(hits).not.toContain("POST /post");
      expect(r.blocked.some((b) => /^POST /.test(b))).toBe(true);
      expect(r.blocked.some((b) => b.includes("169.254.169.254"))).toBe(true);
      expect(r.notes.join(" ")).toMatch(/bloqueada/);
    } finally {
      server.close();
    }
  }, 90_000);

  it("sem exceção, o navegador não visita nem localhost", async () => {
    const r = await inspectPages(["http://127.0.0.1:9/"], { launch: () => chromium.launch(), resolve: publicDns as never });
    expect(r.shots).toEqual([]);
    expect(r.blocked).toContain("acesso a 127.0.0.1");
  }, 60_000);

  it("domínio que resolve para rede privada é ignorado sem abrir o navegador na página", async () => {
    let opened = 0;
    const fake = { newContext: async () => ({ route: async () => {}, newPage: async () => { opened++; throw new Error("não deveria abrir"); } }), close: async () => {} };
    const r = await inspectPages(["https://evil.example.com/"], { launch: async () => fake as never, resolve: (async () => [{ address: "169.254.169.254", family: 4 }]) as never });
    expect(opened).toBe(0);
    expect(r.shots).toEqual([]);
    expect(r.notes.join(" ")).toMatch(/não resolve para um endereço público/);
  });

  it("navegador que não inicia vira observação, não erro", async () => {
    const r = await inspectPages(["https://a.com/"], { launch: async () => { throw new Error("sem binário"); } });
    expect(r.shots).toEqual([]);
    expect(r.notes[0]).toMatch(/não pôde ser iniciado: sem binário/);
  });

  it("respeita o orçamento de tempo", async () => {
    let t = 0;
    const fake = { newContext: async () => ({ route: async () => {}, newPage: async () => { throw new Error("x"); } }), close: async () => {} };
    const r = await inspectPages(["https://a.com/", "https://a.com/b"], { launch: async () => fake as never, resolve: publicDns as never, budgetMs: 10, now: () => (t += 20) });
    expect(r.notes.join(" ")).toMatch(/Tempo esgotado/);
  });
});

describe("Chromium sem servidor (@sparticuz/chromium), o mesmo usado na Vercel", () => {
  it("launchBrowser abre uma página e tira um screenshot", async () => {
    const b = await launchBrowser();
    try {
      const p = await b.newPage({ viewport: { width: 800, height: 600 } });
      await p.setContent("<h1>Olá</h1>");
      const buf = await p.screenshot({ type: "jpeg" });
      expect(buf[0]).toBe(0xff);
      expect(buf.length).toBeGreaterThan(500);
    } finally {
      await b.close();
    }
  }, 120_000);
});

describe("installReadOnlyGuard", () => {
  it("é exportada para reutilização", () => expect(typeof installReadOnlyGuard).toBe("function"));
});
