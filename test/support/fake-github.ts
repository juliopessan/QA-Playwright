import type { GitHubClient, OpenIssue, RepoFile } from "../../src/publish/github.js";

/** Cliente GitHub em memória: guarda branches, PRs e issues para os testes conferirem. */
export class FakeGitHub implements GitHubClient {
  branches = new Map<string, RepoFile[]>();
  prs: Array<{ number: number; head: string; base?: string; title: string; body: string }> = [];
  issues: Array<OpenIssue & { labels: string[] }> = [];
  calls: string[] = [];

  async createBranchWithFiles(a: { repo: string; branch: string; base?: string; message: string; files: RepoFile[] }) {
    this.calls.push(`branch:${a.branch}`);
    this.branches.set(a.branch, a.files);
    return { branch: a.branch, commitSha: "abc123" };
  }
  async createPR(a: { repo: string; head: string; base?: string; title: string; body: string }) {
    this.calls.push(`pr:${a.head}`);
    const number = this.prs.length + 1;
    this.prs.push({ number, head: a.head, base: a.base, title: a.title, body: a.body });
    return { number, url: `https://github.com/${a.repo}/pull/${number}` };
  }
  async getFile(a: { repo: string; ref: string; path: string }) {
    return this.branches.get(a.ref)?.find((f) => f.path === a.path)?.content.toString("utf8");
  }
  async listOpenIssues() {
    return this.issues.map(({ number, title, body }) => ({ number, title, body }));
  }
  async createIssue(a: { repo: string; title: string; body: string; labels: string[] }) {
    this.calls.push(`issue:${a.title}`);
    const number = 100 + this.issues.length;
    this.issues.push({ number, title: a.title, body: a.body, labels: a.labels });
    return { number, url: `https://github.com/${a.repo}/issues/${number}` };
  }
  /** Simula os engenheiros marcando checkboxes no PR. */
  approve(branch: string, path: string, ids: string[]) {
    const files = this.branches.get(branch)!;
    const f = files.find((x) => x.path === path)!;
    let text = f.content.toString("utf8");
    for (const id of ids) text = text.replace(new RegExp(`^- \\[ \\](.*\`${id}\`)`, "m"), "- [x]$1");
    f.content = Buffer.from(text);
  }
}
