import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { CaseVerdict, ReadIssue, RunManifest, Usage } from "../types/index.js";

export type ManifestInit = Pick<RunManifest, "runId" | "startedAt" | "env" | "cliVersion" | "model"> & {
  commit?: string;
  issues?: ReadIssue[];
};

export function newRunId(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  const d = `${now.getUTCFullYear()}${p(now.getUTCMonth() + 1)}${p(now.getUTCDate())}`;
  const t = `${p(now.getUTCHours())}${p(now.getUTCMinutes())}${p(now.getUTCSeconds())}`;
  return `${d}-${t}-${randomBytes(2).toString("hex")}`;
}

/** Grava `manifest.json` de forma atômica a cada alteração, permitindo `--resume`. */
export class ManifestWriter {
  private m: RunManifest;
  private chain: Promise<void> = Promise.resolve();

  constructor(
    readonly runDir: string,
    init: ManifestInit | RunManifest,
  ) {
    this.m =
      "verdicts" in init
        ? init
        : { ...init, issues: init.issues ?? [], usage: { calls: 0, inputTokens: 0, outputTokens: 0 }, verdicts: [] };
  }

  static async load(runDir: string): Promise<RunManifest> {
    return JSON.parse(await readFile(join(runDir, "manifest.json"), "utf8")) as RunManifest;
  }

  static async resume(runDir: string): Promise<ManifestWriter> {
    return new ManifestWriter(runDir, await ManifestWriter.load(runDir));
  }

  get manifest(): RunManifest {
    return this.m;
  }

  private persist(): Promise<void> {
    this.chain = this.chain.then(async () => {
      await mkdir(this.runDir, { recursive: true });
      const tmp = join(this.runDir, `manifest.json.${process.pid}.tmp`);
      await writeFile(tmp, JSON.stringify(this.m, null, 2));
      await rename(tmp, join(this.runDir, "manifest.json"));
    });
    return this.chain;
  }

  async append(v: CaseVerdict): Promise<void> {
    this.m.verdicts.push(v);
    await this.persist();
  }

  setUsage(u: Usage): void {
    this.m.usage = u;
  }

  async abort(reason: string): Promise<void> {
    this.m.aborted = reason;
    await this.persist();
  }

  async finish(): Promise<RunManifest> {
    this.m.finishedAt = new Date().toISOString();
    await this.persist();
    return this.m;
  }
}
