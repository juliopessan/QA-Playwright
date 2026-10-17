# Landing page do QA Agent

`index.html` é gerado (arquivo único, sem dependências além do Google Fonts) a partir de `index.src.html` com o design system Ledger: os marcadores `<!--@css-->`, `<!--@js-->`, `<!--@icons-->` e `<!--@favicon-->` são substituídos pelos assets do Ledger.

Os números da página vêm de execuções reais contra os apps de teste deste repositório; ao alterá-los, mantenha a fonte indicada na própria página.

Deploy: projeto separado na Vercel com diretório raiz `landing/` (site estático, sem build).
