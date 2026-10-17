# Relatórios de exemplo da análise pela web

Documentos gerados pelo mesmo template que a landing usa no botão "Baixar o relatório" (`api/_lib/report.js`): capa, resumo executivo, escopo e método, achados medidos, opinião do agente, evidências visuais, observações e checklist para a equipe. Os PDFs saem do Chromium da função (A4, com número de página); os HTMLs são autônomos (prints embutidos) e também imprimem em A4.

| Exemplo | Origem | Arquivos |
|---|---|---|
| **App de teste do QA Agent** | Execução real: Playwright (prints, axe, console) e Claude, contra o app de teste local; o texto das páginas veio do navegador no lugar do Exa | [`relatorio-app-de-teste.pdf`](relatorio-app-de-teste.pdf), [`.html`](relatorio-app-de-teste.html), dados em [`app-de-teste.json`](app-de-teste.json) |
| **ukodelabs.com.br** | Resultado da análise pela landing (checagens medidas e revisão do Claude), sem screenshots, pois só o texto do resultado foi preservado | [`relatorio-ukodelabs.pdf`](relatorio-ukodelabs.pdf), [`.html`](relatorio-ukodelabs.html), dados em [`ukodelabs.json`](ukodelabs.json) |

Para regenerar: `renderReportHtml(JSON)` (em `api/_lib/report.js`) e `renderPdf(html)` (em `api/report.js`).
