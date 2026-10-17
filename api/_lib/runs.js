import { unzipSync } from "fflate";
import { WORKFLOW_FILE, findRun, github } from "./core.js";

/** Execução do workflow correspondente ao pedido (procura pelo nome da execução). */
export async function locateRun(cfg, id, doFetch = fetch) {
  const r = await github(cfg, `/repos/${cfg.repo}/actions/workflows/${WORKFLOW_FILE}/runs?event=workflow_dispatch&per_page=50`, {}, doFetch);
  if (!r.ok) throw new Error(`GitHub respondeu ${r.status} ao listar execuções`);
  const data = await r.json();
  return findRun(data.workflow_runs, id);
}

/** Baixa e descompacta o artefato do relatório de uma execução. */
export async function loadArtifact(cfg, run, doFetch = fetch) {
  const r = await github(cfg, `/repos/${cfg.repo}/actions/runs/${run.id}/artifacts`, {}, doFetch);
  if (!r.ok) throw new Error(`GitHub respondeu ${r.status} ao listar artefatos`);
  const art = (await r.json()).artifacts?.find((a) => a.name.startsWith("qa-report") && !a.expired);
  if (!art) return undefined;
  const z = await github(cfg, `/repos/${cfg.repo}/actions/artifacts/${art.id}/zip`, { redirect: "follow" }, doFetch);
  if (!z.ok) throw new Error(`GitHub respondeu ${z.status} ao baixar o relatório`);
  return unzipSync(new Uint8Array(await z.arrayBuffer()));
}
