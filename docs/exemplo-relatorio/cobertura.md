# Cobertura

Telas exploradas: **8**. Subestados: **3**.

## Limites atingidos

Nenhum.

## Ações bloqueadas pelo modo somente leitura

| Camada | Tela | Alvo | Motivo |
|---|---|---|---|
| elemento | settings | link "Excluir conta" | rótulo de escrita: "Excluir conta" |

Estas ações não foram executadas por segurança. Fluxos que precisam delas devem ser descritos em `objetivos.md`.

## Links e URLs ignorados

- **logout** (9): `http://127.0.0.1:4020/logout`, `http://127.0.0.1:4020/logout`, `http://127.0.0.1:4020/logout`, `http://127.0.0.1:4020/logout`, `http://127.0.0.1:4020/logout`, …
- **link externo** (8): `https://external.example/docs`, `https://external.example/docs`, `https://external.example/docs`, `https://external.example/docs`, `https://external.example/docs`, …

## Observações da execução

- LLM indisponível (UX): Resposta do LLM inválida após retentativa: [
