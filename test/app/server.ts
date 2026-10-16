import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), "public");
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};

/** App estático local que imita o fluxo da SauceDemo (login, inventário, carrinho, checkout). */
export async function startTestApp(port = 0, root = PUBLIC): Promise<{ url: string; close(): Promise<void> }> {
  const server = createServer(async (req, res) => {
    const path = new URL(req.url ?? "/", "http://x").pathname;
    const rel = path === "/" ? "index.html" : normalize(path).replace(/^([/\\])+/, "");
    if (rel.includes("..")) {
      res.writeHead(400).end();
      return;
    }
    try {
      const body = await readFile(join(root, rel));
      res.writeHead(200, { "content-type": MIME[extname(rel)] ?? "application/octet-stream" }).end(body);
    } catch {
      res.writeHead(404, { "content-type": "text/plain" }).end("Not found");
    }
  });
  await new Promise<void>((ok) => server.listen(port, "127.0.0.1", ok));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("falha ao iniciar o app de teste");
  return {
    url: `http://127.0.0.1:${addr.port}`,
    close: () => new Promise<void>((ok, bad) => server.close((e) => (e ? bad(e) : ok()))),
  };
}
