import type { Page } from "playwright";

export interface CollectedResponse {
  method: string;
  url: string;
  status: number;
  /** `true` quando é o documento da própria tela (navegação). */
  isDocument: boolean;
  resourceType: string;
}

export interface Collected {
  consoleErrors: string[];
  pageErrors: string[];
  responses: CollectedResponse[];
  failedRequests: Array<{ method: string; url: string; error?: string }>;
}

/** Registra erros de console, exceções, respostas e falhas de rede de uma página. `flush` entrega e zera. */
export function attachCollectors(page: Page): { flush(): Collected } {
  let data: Collected = { consoleErrors: [], pageErrors: [], responses: [], failedRequests: [] };
  page.on("console", (m) => {
    if (m.type() === "error") data.consoleErrors.push(m.text());
  });
  page.on("pageerror", (e) => data.pageErrors.push(e.message));
  page.on("response", (r) => {
    const req = r.request();
    if (r.status() >= 400) {
      data.responses.push({
        method: req.method(),
        url: r.url(),
        status: r.status(),
        isDocument: req.isNavigationRequest() && req.frame() === page.mainFrame(),
        resourceType: req.resourceType(),
      });
    }
  });
  page.on("requestfailed", (r) => data.failedRequests.push({ method: r.method(), url: r.url(), error: r.failure()?.errorText }));
  return {
    flush() {
      const out = data;
      data = { consoleErrors: [], pageErrors: [], responses: [], failedRequests: [] };
      return out;
    },
  };
}

export interface PageMetrics {
  lcpMs: number;
  cls: number;
  loadMs: number;
  transferBytes: number;
}

/** Métricas de carregamento da página atual (LCP, CLS, tempo de load, bytes transferidos). */
export async function collectMetrics(page: Page): Promise<PageMetrics> {
  return page.evaluate(
    () =>
      new Promise<PageMetrics>((resolve) => {
        let lcp = 0;
        let cls = 0;
        try {
          new PerformanceObserver((list) => {
            for (const e of list.getEntries()) lcp = Math.max(lcp, e.startTime);
          }).observe({ type: "largest-contentful-paint", buffered: true });
          new PerformanceObserver((list) => {
            for (const e of list.getEntries() as unknown as Array<{ value: number; hadRecentInput: boolean }>) {
              if (!e.hadRecentInput) cls += e.value;
            }
          }).observe({ type: "layout-shift", buffered: true });
        } catch {
          /* navegador sem suporte: métricas ficam em 0 */
        }
        setTimeout(() => {
          const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
          const res = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
          const bytes = (nav?.transferSize ?? 0) + res.reduce((n, r) => n + (r.transferSize || 0), 0);
          resolve({
            lcpMs: Math.round(lcp),
            cls: Math.round(cls * 1000) / 1000,
            loadMs: Math.round(nav ? nav.loadEventEnd - nav.startTime : 0),
            transferBytes: bytes,
          });
        }, 150);
      }),
  );
}
