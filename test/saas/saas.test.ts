import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import { startSaas, SAAS_USER, SAAS_PASS } from "./server.js";

let browser: Browser;
let saas: Awaited<ReturnType<typeof startSaas>>;
beforeAll(async () => {
  browser = await chromium.launch();
  saas = await startSaas(0, { slowMs: 300 });
});
afterAll(async () => {
  await browser.close();
  await saas.close();
});

async function loggedIn(): Promise<Page> {
  const page = await browser.newPage();
  await page.goto(`${saas.url}/login`);
  await page.getByRole("textbox", { name: "Usuário" }).fill(SAAS_USER);
  await page.getByLabel("Senha").fill(SAAS_PASS);
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.waitForURL("**/dashboard");
  return page;
}

describe("SaaS sintético", () => {
  it("páginas protegidas redirecionam para o login sem sessão", async () => {
    const page = await browser.newPage();
    await page.goto(`${saas.url}/projects`);
    expect(page.url()).toContain("/login");
    await page.close();
  });

  it("login errado mostra erro; login certo leva ao painel", async () => {
    const page = await browser.newPage();
    await page.goto(`${saas.url}/login`);
    await page.getByRole("textbox", { name: "Usuário" }).fill("x");
    await page.getByLabel("Senha").fill("y");
    await page.getByRole("button", { name: "Entrar" }).click();
    expect(await page.getByRole("alert").innerText()).toMatch(/inválid/i);
    await page.close();
    const ok = await loggedIn();
    expect(await ok.getByRole("heading", { level: 1 }).innerText()).toBe("Painel");
    await ok.close();
  });

  it("menu lateral, rotas com :id e projetos renderizados por GraphQL", async () => {
    const page = await loggedIn();
    for (const n of ["Painel", "Projetos", "Equipe", "Faturas", "Relatórios", "Configurações", "Sair"]) {
      expect(await page.getByRole("navigation", { name: "Principal" }).getByRole("link", { name: n }).count(), n).toBe(1);
    }
    await page.goto(`${saas.url}/projects`);
    await page.getByRole("link", { name: /Projeto 2/ }).click();
    await page.waitForURL("**/projects/2");
    expect(await page.getByRole("heading", { level: 1 }).innerText()).toBe("Projeto 2");
    await page.close();
  });

  it("equipe tem abas e modal de leitura", async () => {
    const page = await loggedIn();
    await page.goto(`${saas.url}/team`);
    expect(await page.getByRole("tab").count()).toBe(2);
    await page.getByRole("tab", { name: "Convites" }).click();
    expect(await page.getByText("Convites pendentes: 2").isVisible()).toBe(true);
    await page.getByRole("button", { name: "Ver detalhes" }).click();
    expect(await page.getByRole("dialog").isVisible()).toBe(true);
    await page.close();
  });

  it("problemas plantados: 500, 404, página lenta e exceção JS", async () => {
    const page = await loggedIn();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    expect((await page.request.get(`${saas.url}/api/invoices`)).status()).toBe(500);
    expect((await page.request.get(`${saas.url}/help`)).status()).toBe(404);
    await page.goto(`${saas.url}/dashboard`);
    await page.waitForTimeout(100);
    expect(errors.join(" ")).toMatch(/undefinedHelper/);
    await page.goto(`${saas.url}/reports`);
    await page.getByRole("heading", { level: 1 }).waitFor();
    await page.close();
  });

  it("registra requisições de escrita recebidas (login excluído)", async () => {
    const page = await loggedIn();
    await page.goto(`${saas.url}/projects/1`);
    await page.getByRole("button", { name: "Excluir projeto" }).click();
    await page.waitForTimeout(150);
    expect(saas.writes.filter((w) => w.path !== "/login").map((w) => `${w.method} ${w.path}`)).toContain("POST /api/delete");
    const before = saas.writes.length;
    await page.evaluate(() => fetch("/graphql", { method: "POST", body: JSON.stringify({ query: "mutation Apagar { apagar }" }) }));
    expect(saas.writes.length).toBe(before + 1);
    const q = saas.writes.length;
    await page.evaluate(() => fetch("/graphql", { method: "POST", body: JSON.stringify({ query: "query P { projects { id } }" }) }));
    expect(saas.writes.length).toBe(q); // query não conta como escrita
    await page.close();
  });
});
