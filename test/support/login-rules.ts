import { click, compiled, type Rule } from "./scripted-provider.js";

export const fill = (name: string, value: string, secret = false) => ({
  kind: "fill" as const,
  locator: { role: "textbox", name },
  value,
  ...(secret ? { secret } : {}),
  description: `Preencher ${name}`,
});

export const LOGIN_RULES: Rule[] = [
  { match: /Acessar a página inicial/, response: compiled([{ kind: "goto", url: "/", description: "Abrir início" }]) },
  { match: /Preencher o campo de usuário/, response: compiled([fill("Username", "{{APP_USER}}")]) },
  { match: /Preencher o campo de senha/, response: compiled([fill("Password", "{{APP_PASS}}", true)]) },
  { match: /Clicar no botão Login/, response: compiled([click("Login")]) },
  {
    match: /Verificar que a lista/,
    response: compiled(
      [
        { kind: "expectUrl", pattern: "/inventory.html", description: "URL do inventário" },
        { kind: "expectText", text: "Products", mode: "contains", description: "Título Products" },
      ],
      { kind: "verification" },
    ),
  },
];

