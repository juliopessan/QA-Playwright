import { describe, it, expect } from "vitest";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../../src/config/index.js";

const FIXTURE = "fixtures/casos-sinteticos.xlsx";

describe("loadConfig", () => {
  it("usa padrões quando não há yaml", async () => {
    const cfg = await loadConfig({ configPath: "/nao/existe.yaml" });
    expect(cfg.minConfidence).toBe(0.6);
    expect(cfg.maxHealAttempts).toBe(2);
    expect(cfg.columns.step).toBe("Passo");
    expect(cfg.baseUrl).toBe("");
  });

  it("aba Config do fixture define baseUrl https://www.saucedemo.com e stepTimeoutMs 15000", async () => {
    const cfg = await loadConfig({ configPath: "/nao/existe.yaml", excelPath: FIXTURE });
    expect(cfg.baseUrl).toBe("https://www.saucedemo.com");
    expect(cfg.stepTimeoutMs).toBe(15000);
    expect(cfg.env).toBe("demo");
  });

  it("allowedHosts padrão é [host de baseUrl]", async () => {
    const cfg = await loadConfig({ configPath: "/nao/existe.yaml", excelPath: FIXTURE });
    expect(cfg.allowedHosts).toEqual(["www.saucedemo.com"]);
  });

  it("overrides.baseUrl vence a aba Config e recalcula allowedHosts", async () => {
    const cfg = await loadConfig({
      configPath: "/nao/existe.yaml",
      excelPath: FIXTURE,
      overrides: { baseUrl: "http://127.0.0.1:4010" },
    });
    expect(cfg.baseUrl).toBe("http://127.0.0.1:4010");
    expect(cfg.allowedHosts).toEqual(["127.0.0.1"]);
  });

  it('maskSelectors vem de "mascarar_seletores"', async () => {
    const cfg = await loadConfig({ configPath: "/nao/existe.yaml", excelPath: FIXTURE });
    expect(cfg.maskSelectors).toEqual(["input[type=password]"]);
  });

  it('requiredVars = ["APP_USER","APP_PASS","LOCKED_USER"]', async () => {
    const cfg = await loadConfig({ configPath: "/nao/existe.yaml", excelPath: FIXTURE });
    expect(cfg.requiredVars).toEqual(["APP_USER", "APP_PASS", "LOCKED_USER"]);
  });

  it("yaml define allowedHosts extras que se somam ao host da baseUrl", async () => {
    const dir = mkdtempSync(join(tmpdir(), "qa-cfg-"));
    const p = join(dir, "c.yaml");
    writeFileSync(p, "allowedHosts:\n  - login.microsoftonline.com\nminConfidence: 0.8\n");
    const cfg = await loadConfig({ configPath: p, excelPath: FIXTURE });
    expect(cfg.minConfidence).toBe(0.8);
    expect(cfg.allowedHosts).toEqual(["www.saucedemo.com", "login.microsoftonline.com"]);
  });
});
