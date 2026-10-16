import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import { startTestApp } from "./server.js";

let browser: Browser;
let app: { url: string; close(): Promise<void> };

beforeAll(async () => {
  browser = await chromium.launch();
  app = await startTestApp();
});
afterAll(async () => {
  await browser.close();
  await app.close();
});

async function login(page: Page, user = "standard_user", pass = "secret_sauce") {
  await page.goto(app.url);
  await page.getByRole("textbox", { name: "Username" }).fill(user);
  await page.getByRole("textbox", { name: "Password" }).fill(pass);
  await page.getByRole("button", { name: "Login" }).click();
}

describe("app local de teste", () => {
  it("login válido leva a /inventory.html com título Products", async () => {
    const page = await browser.newPage();
    await login(page);
    await page.waitForURL("**/inventory.html");
    await expect(page.getByRole("heading", { name: "Products" }).isVisible()).resolves.toBe(true);
    await page.close();
  });

  it("senha errada mostra a mensagem exata", async () => {
    const page = await browser.newPage();
    await login(page, "standard_user", "senha-errada-123");
    expect(await page.getByRole("alert").innerText()).toBe(
      "Epic sadface: Username and password do not match any user in this service",
    );
    await page.close();
  });

  it("usuário bloqueado mostra a mensagem exata", async () => {
    const page = await browser.newPage();
    await login(page, "locked_out_user");
    expect(await page.getByRole("alert").innerText()).toBe(
      "Epic sadface: Sorry, this user has been locked out.",
    );
    await page.close();
  });

  it("carrinho: adicionar mostra 1 e remover limpa o contador", async () => {
    const page = await browser.newPage();
    await login(page);
    await page.getByRole("button", { name: "Add to cart Sauce Labs Backpack" }).click();
    expect(await page.getByRole("link", { name: "Shopping Cart" }).innerText()).toBe("1");
    await page.getByRole("link", { name: "Shopping Cart" }).click();
    expect(await page.getByText("Sauce Labs Backpack").count()).toBeGreaterThan(0);
    await page.getByRole("button", { name: "Remove Sauce Labs Backpack" }).click();
    expect(await page.getByText("Sauce Labs Backpack").count()).toBe(0);
    await page.close();
  });

  it("ordenação por preço crescente põe Onesie $7.99 primeiro", async () => {
    const page = await browser.newPage();
    await login(page);
    await page.getByRole("combobox", { name: "Product Sort" }).selectOption({ label: "Price (low to high)" });
    const first = page.locator(".inventory_item").first();
    expect(await first.innerText()).toContain("Sauce Labs Onesie");
    expect(await first.innerText()).toContain("$7.99");
    await page.close();
  });

  it("checkout sem CEP mostra Postal Code is required", async () => {
    const page = await browser.newPage();
    await login(page);
    await page.getByRole("button", { name: "Add to cart Sauce Labs Backpack" }).click();
    await page.getByRole("link", { name: "Shopping Cart" }).click();
    await page.getByRole("button", { name: "Checkout" }).click();
    await page.getByRole("textbox", { name: "First Name" }).fill("Maria");
    await page.getByRole("textbox", { name: "Last Name" }).fill("Souza");
    await page.getByRole("button", { name: "Continue" }).click();
    expect(await page.getByRole("alert").innerText()).toBe("Error: Postal Code is required");
    await page.close();
  });

  it("fluxo completo termina em Thank you for your order!", async () => {
    const page = await browser.newPage();
    await login(page);
    await page.getByRole("button", { name: "Add to cart Sauce Labs Backpack" }).click();
    await page.getByRole("link", { name: "Shopping Cart" }).click();
    await page.getByRole("button", { name: "Checkout" }).click();
    await page.getByRole("textbox", { name: "First Name" }).fill("Maria");
    await page.getByRole("textbox", { name: "Last Name" }).fill("Souza");
    await page.getByRole("textbox", { name: "Zip/Postal Code" }).fill("01310-100");
    await page.getByRole("button", { name: "Continue" }).click();
    expect(await page.locator("body").innerText()).toContain("Item total: $29.99");
    expect(await page.locator("body").innerText()).toContain("Total: $32.39");
    await page.getByRole("button", { name: "Finish" }).click();
    await expect(page.getByRole("heading", { name: "Thank you for your order!" }).isVisible()).resolves.toBe(true);
    await page.close();
  });

  it("logout volta à tela de login e páginas protegidas redirecionam sem sessão", async () => {
    const page = await browser.newPage();
    await login(page);
    await page.getByRole("button", { name: "Open Menu" }).click();
    await page.getByRole("link", { name: "Logout" }).click();
    await page.waitForURL(app.url + "/");
    await page.goto(app.url + "/inventory.html");
    await page.waitForURL(app.url + "/");
    await page.close();
  });

  it("não existe botão Exportar relatório", async () => {
    const page = await browser.newPage();
    await login(page);
    expect(await page.getByRole("button", { name: /Exportar relatório/ }).count()).toBe(0);
    await page.close();
  });
});
