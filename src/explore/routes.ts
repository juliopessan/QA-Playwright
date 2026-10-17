const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isIdSegment(seg: string): boolean {
  if (/^\d+$/.test(seg)) return true;
  if (UUID.test(seg)) return true;
  if (/^[0-9a-f]{8,}$/i.test(seg) && /\d/.test(seg)) return true; // hash hexadecimal
  if (/-\d+$/.test(seg)) return true; // slug com número final (acme-42)
  if (seg.length >= 6 && /\d/.test(seg) && /[a-z]/i.test(seg) && /^[a-z0-9]+$/i.test(seg) && /\d{2,}/.test(seg)) return true;
  return false;
}

/** Converte uma URL em padrão de rota: ids numéricos, UUIDs e hashes viram `:id`; query e hash são ignorados. */
export function normalizeRoute(url: string): string {
  let path: string;
  try {
    path = new URL(url, "http://base.local").pathname;
  } catch {
    path = url.split(/[?#]/)[0];
  }
  const segs = path.split("/").filter(Boolean).map((s) => (isIdSegment(s) ? ":id" : s));
  return "/" + segs.join("/");
}

const strip = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");

/** Nome de arquivo seguro para a página de uma tela. */
export function screenSlug(pattern: string): string {
  const s = strip(pattern)
    .replace(/:id/g, "id")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return s || "home";
}
