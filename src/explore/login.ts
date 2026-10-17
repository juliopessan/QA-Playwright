import type { Page } from "playwright";

const SUBMIT_NAME = /entrar|login|log in|sign in|acessar|continuar/i;

/**
 * Login heurístico por formulário: preenche o primeiro campo de texto e o campo de senha e envia.
 * Se a página não tem campo de senha, assume que já há sessão. Para SSO use a sessão salva (`qa-agent login`).
 */
export async function loginWithForm(page: Page, creds: { user: string; pass: string }): Promise<void> {
  const password = page.locator("input[type=password]:visible").first();
  if ((await password.count()) === 0) return;

  const userField = page
    .locator("input:visible:not([type=password]):not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=submit]):not([type=button])")
    .first();
  await userField.fill(creds.user);
  await password.fill(creds.pass);

  const submit = page.locator("button[type=submit]:visible, input[type=submit]:visible").first();
  if ((await submit.count()) > 0) await submit.click();
  else if ((await page.getByRole("button", { name: SUBMIT_NAME }).count()) > 0) await page.getByRole("button", { name: SUBMIT_NAME }).first().click();
  else await password.press("Enter");

  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
  if ((await page.locator("input[type=password]:visible").count()) > 0) {
    throw new Error("Login falhou: credenciais recusadas ou formulário de login não reconhecido (use `qa-agent login` para SSO).");
  }
}
