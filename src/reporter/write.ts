import { mkdir, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ManifestWriter } from "../run/manifest.js";
import { renderReport, type EvidenceMode } from "./render.js";

/** Gera `<runDir>/report/index.html` a partir do manifest e das evidências do run. */
export async function writeReport(runDir: string, opts: { mode?: EvidenceMode } = {}): Promise<string> {
  const manifest = await ManifestWriter.load(runDir);
  const html = renderReport(manifest, {
    mode: opts.mode ?? "embedded",
    readImage: (rel) => {
      try {
        return readFileSync(join(runDir, rel));
      } catch {
        return undefined;
      }
    },
  });
  const dir = join(runDir, "report");
  await mkdir(dir, { recursive: true });
  const file = join(dir, "index.html");
  await writeFile(file, html, "utf8");
  return file;
}

