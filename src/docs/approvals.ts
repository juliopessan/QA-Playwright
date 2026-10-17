/** Lê o `achados.md` e devolve os ids dos achados cujo checkbox foi marcado (`[x]`/`[X]`) pela engenharia. */
export function parseApprovals(achadosMd: string): string[] {
  const ids: string[] = [];
  for (const line of achadosMd.split("\n")) {
    const m = /^- \[[xX]\] .*`([0-9a-f]{10})`/.exec(line);
    if (m) ids.push(m[1]);
  }
  return ids;
}
