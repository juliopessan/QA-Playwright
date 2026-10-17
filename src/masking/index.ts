import { readFile } from "node:fs/promises";
import type { Page } from "playwright";
import { brandMaskedImage, type MaskedImage } from "./image.js";

export type { MaskedImage } from "./image.js";

const ALWAYS_MASK = ["input[type=password]"];

/** Screenshot com campos de senha e `selectors` cobertos. Única fábrica de MaskedImage. */
export async function maskedScreenshot(
  page: Page,
  selectors: string[],
  opts: { path?: string; type?: "png" | "jpeg"; quality?: number; fullPage?: boolean } = {},
): Promise<MaskedImage> {
  const all = [...new Set([...ALWAYS_MASK, ...selectors])];
  const buf = await page.screenshot({
    mask: all.map((s) => page.locator(s)),
    maskColor: "#10384F",
    ...(opts.path ? { path: opts.path } : {}),
    ...(opts.type ? { type: opts.type } : {}),
    ...(opts.type === "jpeg" && opts.quality ? { quality: opts.quality } : {}),
    ...(opts.fullPage ? { fullPage: true } : {}),
  });
  return brandMaskedImage(buf, opts.type === "jpeg" ? "image/jpeg" : "image/png");
}

const DEFAULT_PATTERNS: RegExp[] = [
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, // e-mail
  /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, // CPF
  /Bearer\s+[A-Za-z0-9._~+/-]+=*/g, // Bearer token
  /\beyJ[\w-]+\.[\w-]+\.[\w-]+/g, // JWT
];

export function redactText(text: string, extraPatterns: string[] = []): string {
  const extras = extraPatterns.map((p) => new RegExp(p, "g"));
  return [...DEFAULT_PATTERNS, ...extras].reduce((t, re) => t.replace(re, "[REDIGIDO]"), text);
}

/** Relê um print salvo por `maskedScreenshot` (evidência já mascarada) para enviá-lo ao Judge. */
export async function loadMaskedEvidence(file: string): Promise<MaskedImage> {
  return brandMaskedImage(await readFile(file));
}
