import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import { chromium, type Browser, type Page } from "playwright";
import { isWriteLabel, shouldClick, installNetworkGuard } from "../../src/explore/guard.js";

describe("isWriteLabel", () => {
  it.each(["Salvar", "Excluir projeto", "Remover membro", "Enviar convite", "Pagar agora", "Assinar plano", "Convidar usuário", "Cancelar assinatura", "Save changes", "Delete account", "Submit", "Invite", "Confirmar"])(
    "bloqueia %s",
    (n) => expect(isWriteLabel(n)).toBe(true),
  );
  it.each(["Ver detalhes", "Membros", "Faturas", "Visão geral", "Configurações", "Details", "Next"])("permite %s", (n) => expect(isWriteLabel(n)).toBe(false));
  it("ignora acentos e caixa", () => expect(isWriteLabel("EXCLUSÃO".replace("EXCLUSÃO", "Excluir"))).toBe(true));
  it("verbos extras da configuração", () => {
    expect(isWriteLabel("Arquivar tudo")).toBe(true);
    expect(isWriteLabel("Sincronizar", ["sincronizar"])).toBe(true);
  });
});

describe("shouldClick", () => {
  it("links, abas e itens de menu são permitidos", () => {
    for (const role of ["link", "tab", "menuitem"]) expect(shouldClick({ name: "Equipe", role }).allow).toBe(true);
  });
  it("botão só é permitido se marcado como revelador", () => {
    expect(shouldClick({ name: "Ver detalhes", role: "button" }).allow).toBe(false);
    expect(shouldClick({ name: "Ver detalhes", role: "button", revealing: true }).allow).toBe(true);
  });
  it("type=submit e botão em formulário são bloqueados mesmo se reveladores", () => {
    expect(shouldClick({ name: "Ver", role: "button", type: "submit", revealing: true }).allow).toBe(false);
    expect(shouldClick({ name: "Ver", role: "button", inForm: true, revealing: true }).allow).toBe(false);
  });
  it("verbo de escrita bloqueia até links e botões reveladores", () => {
    const r = shouldClick({ name: "Excluir conta", role: "link" });
    expect(r.allow).toBe(false);
    expect(r.reason).toMatch(/escrita/i);
    expect(shouldClick({ name: "Salvar", role: "button", revealing: true }).allow).toBe(false);
  });
});

let browser: Browser;
let server: Server;
let base: string;
let received: Array<{ method: string; url: string }> = [];
beforeAll(async () => {
  browser = await chromium.launch();
  server = createServer((req, res) => {
    received.push({ method: req.method ?? "", url: req.url ?? "" });
    res.writeHead(200, { "content-type": "application/json", "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" }).end("{}");
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(async () => {
  await browser.close();
  server.close();
});

async function setup(postAllowed: string[] = []) {
  received = [];
  const context = await browser.newContext();
  const guard = await installNetworkGuard(context, { postAllowed });
  const page = await context.newPage();
  await page.goto(`${base}/ok`);
  return { page, guard, context };
}
const doFetch = (page: Page, method: string, path: string, body?: unknown) =>
  page.evaluate(
    async ([m, u, b]) => {
      try {
        const r = await fetch(u as string, { method: m as string, body: b ? JSON.stringify(b) : undefined, headers: { "content-type": "application/json" } });
        return r.status;
      } catch {
        return "blocked";
      }
    },
    [method, `${base}${path}`, body] as const,
  );

describe("installNetworkGuard", () => {
  it("GET passa e não é registrado", async () => {
    const { page, guard, context } = await setup();
    expect(await doFetch(page, "GET", "/api/x")).toBe(200);
    expect(guard.blocked).toHaveLength(0);
    await context.close();
  });
  it("PUT, PATCH e DELETE são sempre bloqueados e nunca chegam ao servidor", async () => {
    const { page, guard, context } = await setup(["/api"]);
    for (const m of ["PUT", "PATCH", "DELETE"]) expect(await doFetch(page, m, "/api/x")).toBe("blocked");
    expect(received.filter((r) => r.method !== "GET")).toEqual([]);
    expect(guard.blocked.map((b) => b.method)).toEqual(["PUT", "PATCH", "DELETE"]);
    expect(guard.blocked[0]).toMatchObject({ layer: "network", url: `${base}/api/x` });
    await context.close();
  });
  it("POST é bloqueado, exceto em rotas permitidas", async () => {
    const { page, guard, context } = await setup(["/api/search"]);
    expect(await doFetch(page, "POST", "/api/delete", {})).toBe("blocked");
    expect(await doFetch(page, "POST", "/api/search", {})).toBe(200);
    expect(received.filter((r) => r.method === "POST").map((r) => r.url)).toEqual(["/api/search"]);
    expect(guard.blocked).toHaveLength(1);
    await context.close();
  });
  it("GraphQL: query passa e mutation é bloqueada", async () => {
    const { page, guard, context } = await setup();
    expect(await doFetch(page, "POST", "/graphql", { query: "query Projetos { projetos { id } }" })).toBe(200);
    expect(await doFetch(page, "POST", "/graphql", { query: "{ projetos { id } }" })).toBe(200);
    expect(await doFetch(page, "POST", "/graphql", { query: "mutation Apagar { apagar(id: 1) }" })).toBe("blocked");
    expect(received.filter((r) => r.method === "POST")).toHaveLength(2);
    expect(guard.blocked).toHaveLength(1);
    expect(guard.blocked[0].reason).toMatch(/mutation/i);
    await context.close();
  });
  it("GraphQL em lote: uma mutation bloqueia o lote inteiro", async () => {
    const { page, context } = await setup();
    const batch = [{ query: "query A { a }" }, { query: "mutation B { b }" }];
    expect(await doFetch(page, "POST", "/graphql", batch)).toBe("blocked");
    await context.close();
  });
});
