import { describe, it, expect } from "vitest";
import { health } from "../../api/health.js";

describe("GET /api/health", () => {
  it("informa o que está configurado sem expor valores", () => {
    const h = health({ EXA_API_KEY: "segredo-exa", ANTHROPIC_API_KEY: "segredo-claude", VERCEL_ENV: "production", VERCEL_GIT_COMMIT_SHA: "96542990338323cd", PATH: "/bin" });
    expect(h).toMatchObject({ ready: true, exa: true, anthropic: true, environment: "production", commit: "9654299" });
    expect(h.similarVariables).toEqual(["ANTHROPIC_API_KEY", "EXA_API_KEY"]);
    expect(JSON.stringify(h)).not.toContain("segredo");
  });
  it("aponta nomes parecidos quando a variável certa falta", () => {
    const h = health({ EXA_KEY: "x", exa_api_key: "y" });
    expect(h.ready).toBe(false);
    expect(h.similarVariables).toEqual(["EXA_KEY", "exa_api_key"]);
  });
  it("aceita EXA_API como nome alternativo", () => {
    expect(health({ EXA_API: "x" })).toMatchObject({ ready: true, exa: true, anthropic: false });
  });
});
