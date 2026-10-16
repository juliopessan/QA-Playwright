/** Utilitários de contraste WCAG 2.x e leitura dos tokens de `tokens.css` (usados nos testes). */

function rgb(hex: string): [number, number, number] {
  let h = hex.trim().replace("#", "");
  if (h.length === 3) h = [...h].map((c) => c + c).join("");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as [number, number, number];
}

function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(fg: string, bg: string): number {
  const [a, b] = [luminance(fg), luminance(bg)];
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

const declarations = (block: string): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const m of block.matchAll(/--([a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{3,6})\s*;/g)) out[m[1]] = m[2];
  return out;
};

/** Separa os tokens do tema claro (`:root`) e do escuro (`@media (prefers-color-scheme: dark)`). */
export function parseTokens(css: string): { light: Record<string, string>; dark: Record<string, string> } {
  const i = css.indexOf("@media (prefers-color-scheme: dark)");
  const light = declarations(i < 0 ? css : css.slice(0, i));
  const dark = { ...light, ...(i < 0 ? {} : declarations(css.slice(i))) };
  return { light, dark };
}
