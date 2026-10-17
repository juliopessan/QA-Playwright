# Análise pela landing page

A landing page publicada na Vercel tem um formulário com um único campo: a URL do site. Em cerca de um minuto, a página mostra o relatório com o resumo, os números, os prints das páginas e cada achado com evidência e sugestão, e oferece o relatório em um HTML único (prints embutidos) para baixar.

```
Landing (hero) ─▶ POST /api/analyze { url }
                    ├─ Exa /contents: página inicial + até 6 páginas internas (texto)
                    ├─ visita direta: status, tempo, cabeçalhos e HTML da página inicial
                    ├─ Playwright (Chromium sem servidor): prints, console, rede, LCP/CLS e axe
                    │   da página inicial e de até 3 internas, só com requisições GET
                    └─ Claude: revisão do conteúdo com texto + prints (achados só com trecho literal)
```

## O que é analisado

| Origem | Checagens |
|---|---|
| **Medido** (navegador, Playwright) | Prints (desktop e celular na inicial), erros de console, recursos que falham, LCP e CLS, rolagem lateral no celular e varredura de acessibilidade (axe), na página inicial e em até 3 internas |
| **Medido** (visita direta) | Erro HTTP, HTTPS, HSTS, Content-Security-Policy, X-Content-Type-Options, proteção contra iframe, tempo e peso do HTML, `<title>`, meta description, idioma (`lang`), meta viewport, h1, imagens sem `alt` |
| **Opinião do agente** (Claude sobre o texto lido pelo Exa) | Clareza, navegação, conteúdo, SEO, acessibilidade percebida e sinais de confiança. Até 8 achados, gravidade no máximo média, e **só entram os que citam um trecho que existe de fato no site** (o resto é descartado e a página avisa quantos) |

Não há login, envio de formulário nem clique: a análise é somente leitura e cobre até 4 páginas públicas. Para explorar telas autenticadas, abas, modais e fluxos, com documentação em Markdown para PR, use o CLI (`qa-agent explore`).

## Relatório como documento (PDF e HTML)

O botão "Baixar o relatório" chama `POST /api/report` com o resultado da análise e o formato (`pdf` ou `html`). O servidor revalida o conteúdo (tamanhos, URLs http(s), só imagens JPEG em data URL), escapa todo texto e monta um documento A4 com:

1. Capa (site, data, páginas, achados, tempo de resposta);
2. Resumo executivo (números, prioridades, achados por categoria e tabela de todos os achados);
3. Escopo e método (o que é medido e o que é opinião do agente, páginas analisadas);
4. Achados medidos, com evidência, o que fazer e id estável;
5. Opinião do agente, em seção separada, com a confiança do modelo;
6. Evidências visuais (screenshots desktop e celular, com legenda);
7. Observações e limitações, e checklist para a equipe.

O PDF é gerado pelo Chromium da função, sem rede (a página só tem o HTML e imagens `data:`), com numeração de páginas. Se o PDF falhar, a página avisa e o HTML pode ser impresso em A4. Exemplos reais em [`docs/exemplo-analise-web/`](exemplo-analise-web/README.md), publicados em `/exemplo-analise/`.

## Configuração

Variáveis de ambiente do projeto na Vercel (Settings → Environment Variables), depois um redeploy:

| Variável | Obrigatória | Uso |
|---|---|---|
| `EXA_API_KEY` | sim | Leitura das páginas pela API do Exa (o nome `EXA_API` também é aceito) |
| `ANTHROPIC_API_KEY` | recomendada | Revisão do conteúdo pelo Claude; sem ela a análise traz só as medições |
| `QA_WEB_MODEL` | não | Modelo da revisão (padrão `claude-opus-5-5`, com esforço baixo e fallback do servidor em caso de recusa) |

Sem `EXA_API_KEY`, o formulário responde que a análise ainda não foi configurada. Para conferir o que chegou à função, abra `/api/health`: mostra se as chaves estão presentes e nomes de variáveis parecidas (nunca valores). Variável cadastrada depois do último deploy só vale após um novo deploy.

## Segurança e custo

- **Navegador somente leitura:** o Chromium só faz requisições GET/HEAD/OPTIONS (qualquer POST, PUT, PATCH ou DELETE é abortado e registrado) e nunca acessa localhost, IPs privados ou esquemas que não sejam http(s); cada domínio é resolvido e conferido antes de abrir.
- **Só sites públicos:** a URL precisa ser um nome de domínio (nada de IP, localhost ou nomes internos), e a visita direta confere que o domínio e cada redirecionamento resolvem apenas para IPs públicos.
- **Conteúdo não confiável:** o texto do site vai ao modelo delimitado e marcado como dado, nunca como instrução; a página monta o relatório só com `textContent`, sem interpretar HTML vindo da análise.
- **Limite de uso:** 5 análises a cada 10 minutos por IP, em memória de cada instância da função. É uma proteção básica; para tráfego público, configure também limites de gasto no Exa e na Anthropic e, se precisar, o firewall da Vercel.
- **Custo por análise:** uma chamada ao Exa (página inicial + até 6 páginas), até 4 páginas no navegador e uma chamada ao Claude com até ~35 mil caracteres de texto e até 4 screenshots. A função usa `@sparticuz/chromium` (Chromium para funções serverless) e pode levar até 2 minutos; se o navegador não iniciar, a análise segue sem prints e avisa.

## Desenvolvimento

- Funções: `api/analyze.js` (análise) e `api/report.js` (documento PDF/HTML); módulos em `api/_lib/` (`core`, `probe`, `exa`, `browser`, `review`, `report`), em JavaScript puro, sem build. `vercel.json` inclui o binário do Chromium na função e define `maxDuration` de 120 s.
- Landing: `landing/index.src.html` (fonte) e `landing/index.html` (gerado com o Ledger). O build do site (`npm run build:web`) põe a landing na raiz e o app de teste em `/demo/`.
- Testes: `test/web/` (validação, proteção de rede, checagens, Exa, revisão e a função completa com dependências simuladas) e `test/app/landing.test.ts` (o formulário e o relatório no navegador, com a API simulada).
