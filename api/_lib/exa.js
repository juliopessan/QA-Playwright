/**
 * Busca o conteúdo do site pela API do Exa: a página inicial e algumas páginas internas.
 * @param {string} url
 * @param {{ apiKey?: string, subpages?: number, doFetch?: typeof fetch, timeoutMs?: number }} [opts]
 */
export async function exaCrawl(url, { apiKey, subpages = 6, doFetch = fetch, timeoutMs = 45_000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res;
  try {
    res = await doFetch("https://api.exa.ai/contents", {
      method: "POST",
      signal: ctrl.signal,
      headers: { "x-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ urls: [url], text: { maxCharacters: 6000 }, livecrawl: "preferred", subpages, extras: { links: 40 } }),
    });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Exa respondeu ${res.status}${body ? `: ${body.slice(0, 200)}` : ""}`);
  }
  const data = await res.json();
  const root = data.results?.[0];
  if (!root) {
    const st = data.statuses?.[0];
    throw new Error(`o Exa não conseguiu ler o site${st?.error ? ` (${st.error.tag ?? st.error})` : ""}`);
  }
  const page = (r) => ({ url: String(r.url ?? r.id ?? ""), title: String(r.title ?? ""), text: String(r.text ?? "") });
  const pages = [page(root), ...(root.subpages ?? []).map(page)].filter((p) => p.url);
  const seen = new Set();
  return {
    pages: pages.filter((p) => (seen.has(p.url) ? false : seen.add(p.url))),
    links: (root.extras?.links ?? []).map(String),
    cost: data.costDollars?.total,
  };
}
