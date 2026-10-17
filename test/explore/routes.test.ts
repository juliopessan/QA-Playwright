import { describe, it, expect } from "vitest";
import { normalizeRoute, screenSlug } from "../../src/explore/routes.js";

describe("normalizeRoute", () => {
  it("/projetos/123 e /projetos/456 dão o mesmo padrão", () => {
    expect(normalizeRoute("https://app.x.com/projetos/123")).toBe("/projetos/:id");
    expect(normalizeRoute("https://app.x.com/projetos/456")).toBe("/projetos/:id");
  });
  it("UUID, hash hexadecimal e slug com número viram :id", () => {
    expect(normalizeRoute("/t/9f2c1a7e-1b2c-4d3e-8f90-123456789abc/tarefas")).toBe("/t/:id/tarefas");
    expect(normalizeRoute("/builds/9f2c1ab4e7")).toBe("/builds/:id");
    expect(normalizeRoute("/projetos/acme-42")).toBe("/projetos/:id");
  });
  it("aninhado: ids em vários níveis", () => {
    expect(normalizeRoute("/projetos/12/tarefas/9f2c1ab4/comentarios")).toBe("/projetos/:id/tarefas/:id/comentarios");
  });
  it("ignora query, hash e barra final; raiz vira /", () => {
    expect(normalizeRoute("https://a.com/equipe/?aba=membros#topo")).toBe("/equipe");
    expect(normalizeRoute("https://a.com")).toBe("/");
    expect(normalizeRoute("https://a.com/")).toBe("/");
  });
  it("palavras comuns não viram :id", () => {
    expect(normalizeRoute("/configuracoes/perfil")).toBe("/configuracoes/perfil");
    expect(normalizeRoute("/v2/api")).toBe("/v2/api");
  });
});

describe("screenSlug", () => {
  it("gera nomes seguros para arquivo", () => {
    expect(screenSlug("/")).toBe("home");
    expect(screenSlug("/projetos/:id")).toBe("projetos-id");
    expect(screenSlug("/configurações/perfil")).toBe("configuracoes-perfil");
    expect(screenSlug("/a/../b")).toMatch(/^[a-z0-9-]+$/);
  });
});
