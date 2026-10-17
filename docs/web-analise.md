# Análise pela landing page

A landing page publicada na Vercel tem um formulário com um único campo: a URL do site. Em menos de um minuto, a página mostra o relatório com o resumo, os números e cada achado com evidência e sugestão.

```
Landing (#analisar) ─▶ POST /api/analyze { url }
                         ├─ Exa /contents: página inicial + até 6 páginas internas (texto)
                         ├─ visita direta: status, tempo, cabeçalhos e HTML da página inicial
                         └─ Claude: revisão do conteúdo (achados só com trecho literal do site)
```

## O que é analisado

| Origem | Checagens |
|---|---|
| **Medido** (visita direta) | Erro HTTP, HTTPS, HSTS, Content-Security-Policy, X-Content-Type-Options, proteção contra iframe, tempo e peso do HTML, `<title>`, meta description, idioma (`lang`), meta viewport, h1, imagens sem `alt` |
| **Opinião do agente** (Claude sobre o texto lido pelo Exa) | Clareza, navegação, conteúdo, SEO, acessibilidade percebida e sinais de confiança. Até 8 achados, gravidade no máximo média, e **só entram os que citam um trecho que existe de fato no site** (o resto é descartado e a página avisa quantos) |

Não há login, envio de formulário nem clique: a análise é somente leitura e cobre páginas públicas. Para explorar telas autenticadas, com screenshots e acessibilidade pelo axe, use o CLI (`qa-agent explore`).

## Configuração

Variáveis de ambiente do projeto na Vercel (Settings → Environment Variables), depois um redeploy:

| Variável | Obrigatória | Uso |
|---|---|---|
| `EXA_API_KEY` | sim | Leitura das páginas pela API do Exa (o nome `EXA_API` também é aceito) |
| `ANTHROPIC_API_KEY` | recomendada | Revisão do conteúdo pelo Claude; sem ela a análise traz só as medições |
| `QA_WEB_MODEL` | não | Modelo da revisão (padrão `claude-opus-5-5`, com esforço baixo e fallback do servidor em caso de recusa) |

Sem `EXA_API_KEY`, o formulário responde que a análise ainda não foi configurada. Para conferir o que chegou à função, abra `/api/health`: mostra se as chaves estão presentes e nomes de variáveis parecidas (nunca valores). Variável cadastrada depois do último deploy só vale após um novo deploy.

## Segurança e custo

- **Só sites públicos:** a URL precisa ser um nome de domínio (nada de IP, localhost ou nomes internos), e a visita direta confere que o domínio e cada redirecionamento resolvem apenas para IPs públicos.
- **Conteúdo não confiável:** o texto do site vai ao modelo delimitado e marcado como dado, nunca como instrução; a página monta o relatório só com `textContent`, sem interpretar HTML vindo da análise.
- **Limite de uso:** 5 análises a cada 10 minutos por IP, em memória de cada instância da função. É uma proteção básica; para tráfego público, configure também limites de gasto no Exa e na Anthropic e, se precisar, o firewall da Vercel.
- **Custo por análise:** uma chamada ao Exa (página inicial + até 6 páginas) e uma ao Claude com até ~35 mil caracteres de texto.

## Desenvolvimento

- Função: `api/analyze.js`; módulos em `api/_lib/` (`core`, `probe`, `exa`, `review`), em JavaScript puro, sem build.
- Landing: `landing/index.src.html` (fonte) e `landing/index.html` (gerado com o Ledger). O build do site (`npm run build:web`) põe a landing na raiz e o app de teste em `/demo/`.
- Testes: `test/web/` (validação, proteção de rede, checagens, Exa, revisão e a função completa com dependências simuladas) e `test/app/landing.test.ts` (o formulário e o relatório no navegador, com a API simulada).
