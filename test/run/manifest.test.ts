import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ManifestWriter, newRunId } from "../../src/run/manifest.js";
import type { CaseVerdict } from "../../src/types/index.js";

const verdict = (id: string): CaseVerdict => ({
  caseId: id,
  title: id,
  status: "pass",
  reasoning: "ok",
  evidenceRefs: [],
  steps: [],
});
const init = { runId: "r1", startedAt: "2026-01-01T00:00:00.000Z", env: "demo", cliVersion: "0.1.0", model: "fake" };

describe("ManifestWriter", () => {
  it("append grava manifest.json válido a cada caso (leitura entre appends)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "qa-man-"));
    const w = new ManifestWriter(dir, init);
    await w.append(verdict("A"));
    expect(JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")).verdicts).toHaveLength(1);
    await w.append(verdict("B"));
    const m = await ManifestWriter.load(dir);
    expect(m.verdicts.map((v) => v.caseId)).toEqual(["A", "B"]);
    expect(m.finishedAt).toBeUndefined();
  });

  it("finish define finishedAt e abort registra o motivo", async () => {
    const dir = mkdtempSync(join(tmpdir(), "qa-man-"));
    const w = new ManifestWriter(dir, init);
    await w.abort("Sessão SSO expirada");
    const done = await w.finish();
    expect(done.aborted).toBe("Sessão SSO expirada");
    expect(done.finishedAt).toBeDefined();
  });

  it("setUsage persiste o uso do LLM", async () => {
    const dir = mkdtempSync(join(tmpdir(), "qa-man-"));
    const w = new ManifestWriter(dir, init);
    w.setUsage({ calls: 3, inputTokens: 10, outputTokens: 5 });
    await w.append(verdict("A"));
    expect((await ManifestWriter.load(dir)).usage.calls).toBe(3);
  });

  it("resume: ManifestWriter.resume continua a partir do manifest existente", async () => {
    const dir = mkdtempSync(join(tmpdir(), "qa-man-"));
    const w = new ManifestWriter(dir, init);
    await w.append(verdict("A"));
    const r = await ManifestWriter.resume(dir);
    await r.append(verdict("B"));
    expect((await ManifestWriter.load(dir)).verdicts.map((v) => v.caseId)).toEqual(["A", "B"]);
  });

  it("runId tem o formato esperado e dois ids não colidem", () => {
    const a = newRunId(new Date("2026-10-16T12:34:56Z"));
    expect(a).toMatch(/^20261016-\d{6}-[0-9a-f]{4}$/);
    const ids = new Set(Array.from({ length: 50 }, () => newRunId()));
    expect(ids.size).toBeGreaterThan(40);
  });
});
