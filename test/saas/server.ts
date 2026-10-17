import { createServer } from "node:http";

export const SAAS_USER = "qa_user";
export const SAAS_PASS = "qa_pass";

export interface WriteRequest {
  method: string;
  path: string;
  body: string;
}

const NAV: Array<[string, string]> = [
  ["/dashboard", "Painel"],
  ["/projects", "Projetos"],
  ["/team", "Equipe"],
  ["/billing", "Faturas"],
  ["/reports", "Relatórios"],
  ["/settings", "Configurações"],
  ["/logout", "Sair"],
];

function layout(title: string, h1: string, body: string, script = ""): string {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${title} · Acme SaaS</title>
<style>body{font-family:Arial;margin:0;display:flex}nav{width:180px;background:#10384f;min-height:100vh;padding:16px}nav a{display:block;color:#fff;padding:6px 0}
main{padding:24px;flex:1}.tab[aria-selected=true]{font-weight:700}dialog,[role=dialog]{border:1px solid #888;padding:12px}</style></head><body>
<nav aria-label="Principal">${NAV.map(([h, t]) => `<a href="${h}">${t}</a>`).join("")}</nav>
<main><h1>${h1}</h1>${body}<footer><a href="/help">Ajuda</a> · <a href="https://external.example/docs">Docs externos</a></footer></main>
<script>${script}</script></body></html>`;
}

export async function startSaas(
  port = 0,
  opts: { slowMs?: number } = {},
): Promise<{ url: string; writes: WriteRequest[]; close(): Promise<void> }> {
  const slowMs = opts.slowMs ?? 1500;
  const writes: WriteRequest[] = [];

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    const method = req.method ?? "GET";
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString();
      const authed = /(^|;\s*)sid=ok/.test(req.headers.cookie ?? "");
      const html = (code: number, content: string, headers: Record<string, string> = {}) =>
        res.writeHead(code, { "content-type": "text/html; charset=utf-8", ...headers }).end(content);
      const json = (code: number, data: unknown) => res.writeHead(code, { "content-type": "application/json" }).end(JSON.stringify(data));

      // Mutations de GraphQL e qualquer método de escrita são registrados (menos queries).
      const isGraphQlQuery = url.pathname === "/graphql" && !/mutation\b/.test(body);
      if (!["GET", "HEAD", "OPTIONS"].includes(method) && !isGraphQlQuery) writes.push({ method, path: url.pathname, body });

      if (url.pathname === "/login") {
        if (method === "POST") {
          const p = new URLSearchParams(body);
          if (p.get("user") === SAAS_USER && p.get("pass") === SAAS_PASS) return html(303, "", { location: "/dashboard", "set-cookie": "sid=ok; Path=/" });
          return html(401, loginPage("Credenciais inválidas"));
        }
        return html(200, loginPage());
      }
      if (url.pathname === "/logout") return html(303, "", { location: "/login", "set-cookie": "sid=; Path=/; Max-Age=0" });
      if (url.pathname === "/logo.svg") return res.writeHead(200, { "content-type": "image/svg+xml" }).end('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="#0091df"/></svg>');
      if (url.pathname === "/help") return html(404, "<h1>Página não encontrada</h1>");
      if (!authed) return html(303, "", { location: "/login" });

      if (url.pathname === "/graphql") {
        if (/mutation\b/.test(body)) return json(200, { data: { ok: true } });
        return json(200, { data: { projects: [1, 2, 3].map((id) => ({ id, name: `Projeto ${id}` })) } });
      }
      if (url.pathname === "/api/invoices") return json(500, { error: "falha interna" });
      if (url.pathname === "/api/delete") return json(200, { ok: true });

      if (url.pathname === "/dashboard") {
        return html(200, layout("Painel", "Painel", `<p>Bem-vindo ao Acme.</p><a href="/projects/1">Último projeto</a>`, "setTimeout(()=>{undefinedHelper()},20)"));
      }
      if (url.pathname === "/projects") {
        return html(
          200,
          layout("Projetos", "Projetos", `<ul id="list"><li>Carregando…</li></ul>`,
            `setTimeout(()=>{undefinedHelper()},20);
             fetch('/graphql',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({query:'query P { projects { id name } }'})})
              .then(r=>r.json()).then(d=>{document.getElementById('list').innerHTML=d.data.projects.map(p=>'<li><a href="/projects/'+p.id+'">'+p.name+'</a></li>').join('')})`),
        );
      }
      const proj = /^\/projects\/(\d+)$/.exec(url.pathname);
      if (proj) {
        return html(
          200,
          layout(`Projeto ${proj[1]}`, `Projeto ${proj[1]}`,
            `<p>Detalhes do projeto ${proj[1]}.</p><button type="button" id="del">Excluir projeto</button>`,
            `document.getElementById('del').onclick=()=>fetch('/api/delete',{method:'POST',body:'{}'})`),
        );
      }
      if (url.pathname === "/team") {
        return html(
          200,
          layout("Equipe", "Equipe",
            `<div role="tablist"><button role="tab" class="tab" id="t1" aria-selected="true" aria-controls="p1">Membros</button>
             <button role="tab" class="tab" id="t2" aria-selected="false" aria-controls="p2">Convites</button></div>
             <div role="tabpanel" id="p1"><p>Membros ativos: 5</p></div>
             <div role="tabpanel" id="p2" hidden><p>Convites pendentes: 2</p></div>
             <button type="button" id="inv">Convidar usuário</button>
             <button type="button" id="det">Ver detalhes</button>
             <div role="dialog" id="dlg" aria-label="Detalhes da equipe" hidden><p>Plano Business, 10 assentos.</p><button type="button" id="close">Fechar</button></div>`,
            `const tabs=[...document.querySelectorAll('[role=tab]')];
             tabs.forEach(t=>t.onclick=()=>{tabs.forEach(x=>{x.setAttribute('aria-selected',x===t);document.getElementById(x.getAttribute('aria-controls')).hidden=x!==t})});
             document.getElementById('det').onclick=()=>{document.getElementById('dlg').hidden=false};
             document.getElementById('close').onclick=()=>{document.getElementById('dlg').hidden=true};
             document.getElementById('inv').onclick=()=>fetch('/api/invite',{method:'POST',body:'{}'})`),
        );
      }
      if (url.pathname === "/billing") {
        return html(200, layout("Faturas", "Faturas", `<p id="msg">Carregando faturas…</p>`,
          `fetch('/api/invoices').then(r=>{if(!r.ok){console.error('Falha ao carregar faturas: '+r.status);document.getElementById('msg').textContent='Erro ao carregar'}})`));
      }
      if (url.pathname === "/reports") {
        return html(200, `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Relatórios · Acme SaaS</title></head><body>
<nav aria-label="Principal">${NAV.map(([h, t]) => `<a href="${h}">${t}</a>`).join(" ")}</nav><main id="m"></main>
<script>setTimeout(()=>{document.getElementById('m').innerHTML='<h1>Relatórios</h1><p style="font-size:40px">Receita do mês: R$ 120.000</p>'},${slowMs})</script></body></html>`);
      }
      if (url.pathname === "/settings") {
        return html(200, layout("Configurações", "Configurações",
          `<img src="/logo.svg" width="40" height="40"><form onsubmit="return false"><input name="nome"><button type="submit">Salvar</button></form>`));
      }
      return html(404, "<h1>Página não encontrada</h1>");
    });
  });

  function loginPage(error = ""): string {
    return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Entrar · Acme SaaS</title></head><body><main><h1>Entrar</h1>
${error ? `<p role="alert">${error}</p>` : ""}<form method="post" action="/login"><label>Usuário <input name="user"></label>
<label>Senha <input name="pass" type="password"></label><button type="submit">Entrar</button></form></main></body></html>`;
  }

  await new Promise<void>((ok) => server.listen(port, "127.0.0.1", ok));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("falha ao iniciar o SaaS sintético");
  return {
    url: `http://127.0.0.1:${addr.port}`,
    writes,
    close: () => new Promise<void>((ok, bad) => server.close((e) => (e ? bad(e) : ok()))),
  };
}
