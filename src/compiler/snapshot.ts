import type { Page } from "playwright";
import { redactText } from "../masking/index.js";

/** Árvore de acessibilidade do body, com dados sensíveis redigidos (é isto que o LLM vê). */
export async function snapshotPage(page: Page, patterns: string[] = []): Promise<string> {
  const raw = await page.locator("body").ariaSnapshot();
  return redactText(raw, patterns);
}
