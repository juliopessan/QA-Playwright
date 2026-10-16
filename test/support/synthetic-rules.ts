import { scriptedProvider } from "./scripted-provider.js";
import type { FakeLLMProvider } from "../../src/llm/fake.js";
import type { LLMRequest } from "../../src/llm/provider.js";

type A = Record<string, unknown>;

const role = (r: string, name?: string, nth?: number) => ({ role: r, ...(name ? { name } : {}), ...(nth !== undefined ? { nth } : {}) });
const click = (r: string, name: string): A => ({ kind: "click", locator: role(r, name), description: `Clicar em ${name}` });
const fill = (name: string, value: string, secret = false): A => ({
  kind: "fill",
  locator: role("textbox", name),
  value,
  ...(secret ? { secret } : {}),
  description: `Preencher ${name}`,
});
const text = (t: string, locator?: A): A => ({
  kind: "expectText",
  text: t,
  mode: "contains",
  ...(locator ? { locator } : {}),
  description: `Conferir "${t}"`,
});
const ok = (actions: A[], extra: A = {}) => ({ kind: "action", confidence: 0.95, subjective: false, actions, ...extra });

const quoted = (s: string) => /'([^']+)'/.exec(s)?.[1];

/** Traduz cada passo do Excel sintético em ações para o app local (o papel do LLM nos testes). */
export function compileFor(step: string, data: string, expected: string): unknown {
  if (/Acessar a página inicial/.test(step)) return ok([{ kind: "goto", url: "/", description: "Abrir a página inicial" }]);
  if (/Preencher o campo de usuário/.test(step)) return ok([fill("Username", data)]);
  if (/Preencher o campo de senha/.test(step)) return ok([fill("Password", data, true)]);
  if (/Clicar no botão Login sem preencher nada/.test(step)) return ok([click("button", "Login")], { kind: "verification", subjective: true });
  if (/Clicar no botão Login/.test(step)) return ok([click("button", "Login")]);
  if (/lista de produtos é exibida/.test(step))
    return ok([{ kind: "expectUrl", pattern: "/inventory.html", description: "URL do inventário" }, text("Products")], { kind: "verification" });
  if (/mensagem de erro exibida/.test(step)) return ok([text(quoted(expected)!)], { kind: "verification" });
  if (/Add to cart no produto Sauce Labs Backpack/.test(step)) return ok([click("button", "Add to cart Sauce Labs Backpack")]);
  if (/contador do carrinho/.test(step))
    return ok([{ kind: "expectText", text: "1", mode: "equals", locator: role("link", "Shopping Cart"), description: "Contador = 1" }], { kind: "verification" });
  if (/Abrir o carrinho e clicar em Checkout/.test(step)) return ok([click("link", "Shopping Cart"), click("button", "Checkout")]);
  if (/Abrir o carrinho/.test(step)) return ok([click("link", "Shopping Cart"), text("Sauce Labs Backpack")]);
  if (/Remove no produto Sauce Labs Backpack/.test(step)) return ok([click("button", "Remove Sauce Labs Backpack")]);
  if (/carrinho está vazio/.test(step))
    return ok([{ kind: "expectText", text: "", mode: "equals", locator: role("link", "Shopping Cart"), description: "Sem contador" }], { kind: "verification" });
  if (/Selecionar a ordenação Price/.test(step))
    return ok([{ kind: "select", locator: role("combobox", "Product Sort"), value: "Price (low to high)", description: "Ordenar por preço" }]);
  if (/primeiro produto da lista/.test(step))
    return ok([text("Sauce Labs Onesie", role("heading", undefined, 1)), text("$7.99")], { kind: "verification" });
  if (/Preencher nome/.test(step)) return ok([fill("First Name", data)]);
  if (/Preencher sobrenome/.test(step)) return ok([fill("Last Name", data)]);
  if (/Preencher CEP/.test(step)) return ok([fill("Zip/Postal Code", data)]);
  if (/Clicar em Continue sem preencher o CEP/.test(step)) return ok([click("button", "Continue"), text(quoted(expected)!)]);
  if (/Clicar em Continue/.test(step)) {
    const wanted = /Item total: \$[\d.]+/.exec(expected)?.[0] ?? `Total: ${/\$[\d.]+/.exec(expected)![0]}`;
    return ok([click("button", "Continue"), text(wanted)]);
  }
  if (/Clicar em Finish/.test(step)) return ok([click("button", "Finish"), text(quoted(expected)!)]);
  if (/Exportar relatório de pedidos/.test(step)) return ok([click("button", "Exportar relatório de pedidos")]);
  if (/Abrir o menu lateral/.test(step)) return ok([click("button", "Open Menu")]);
  if (/Clicar em Logout/.test(step)) return ok([click("link", "Logout")]);
  if (/voltou à tela de login/.test(step))
    return ok([{ kind: "expectUrl", pattern: "/\\/$/", description: "URL da página inicial" }, text("Swag Labs", role("heading"))], { kind: "verification" });
  return { kind: "action", confidence: 0, subjective: false, actions: [] };
}

export function syntheticProvider(): FakeLLMProvider {
  const line = (prompt: string, label: string) => new RegExp(`^${label}: (.*)$`, "m").exec(prompt)?.[1] ?? "";
  return scriptedProvider([
    {
      match: /./,
      task: "compile",
      response: (req: LLMRequest<unknown>) => {
        const p = req.prompt;
        const step = line(p, "Passo \\d+");
        const data = line(p, "Dados \\(template\\)");
        const expected = line(p, "Resultado esperado");
        return compileFor(step, data === "(nenhum)" ? "" : data, expected === "(nenhum)" ? "" : expected);
      },
    },
    { match: /./, task: "judge", response: { verdict: "uncertain", evidence: "Critério subjetivo sem evidência objetiva." } },
  ]);
}
