import { screenSlug } from "../explore/routes.js";

export interface Objective {
  id: string;
  title: string;
  /** O que o agente deve conseguir fazer, em linguagem natural. */
  goal: string;
  /** Critério de sucesso verificado pelo Judge. */
  success: string;
}

const SUCCESS = /^\*\*\s*sucesso\s*:\s*\*\*\s*(.*)$/i;

/** Lê `objetivos.md`: seções `## Título`, texto do objetivo e `**Sucesso:** critério`. */
export function parseObjectives(md: string): { objectives: Objective[]; errors: string[] } {
  const objectives: Objective[] = [];
  const errors: string[] = [];
  const used = new Set<string>();
  const sections = md.split(/^##\s+/m).slice(1);
  for (const sec of sections) {
    const [titleLine, ...rest] = sec.split("\n");
    const title = titleLine.trim();
    const goal: string[] = [];
    const success: string[] = [];
    let inSuccess = false;
    for (const line of rest) {
      const m = SUCCESS.exec(line.trim());
      if (m) {
        inSuccess = true;
        if (m[1].trim()) success.push(m[1].trim());
      } else if (inSuccess) {
        if (line.trim()) success.push(line.trim());
      } else if (line.trim()) goal.push(line.trim());
    }
    if (!title) continue;
    if (goal.length === 0) {
      errors.push(`Objetivo "${title}": falta o texto do objetivo.`);
      continue;
    }
    if (success.length === 0) {
      errors.push(`Objetivo "${title}": falta o critério de sucesso (**Sucesso:** ...).`);
      continue;
    }
    let id = screenSlug(`/${title}`);
    for (let n = 2; used.has(id); n++) id = `${screenSlug(`/${title}`)}-${n}`;
    used.add(id);
    objectives.push({ id, title, goal: goal.join(" "), success: success.join(" ") });
  }
  return { objectives, errors };
}
