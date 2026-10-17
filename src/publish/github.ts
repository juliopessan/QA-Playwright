export interface RepoFile {
  path: string;
  content: Buffer;
}

export interface OpenIssue {
  number: number;
  title: string;
  body: string;
}

/** Superfície mínima do GitHub usada por `publish` e `issues` (trocável por um cliente falso nos testes). */
export interface GitHubClient {
  createBranchWithFiles(args: { repo: string; branch: string; base?: string; message: string; files: RepoFile[] }): Promise<{ branch: string; commitSha: string }>;
  createPR(args: { repo: string; head: string; base?: string; title: string; body: string }): Promise<{ number: number; url: string }>;
  getFile(args: { repo: string; ref: string; path: string }): Promise<string | undefined>;
  listOpenIssues(args: { repo: string }): Promise<OpenIssue[]>;
  createIssue(args: { repo: string; title: string; body: string; labels: string[] }): Promise<{ number: number; url: string }>;
}

export class GitHubAuthError extends Error {}

export interface HttpGitHubClientOptions {
  token?: string;
  apiUrl?: string;
  fetch?: typeof fetch;
}

/** Cliente REST do GitHub. O token vem do ambiente e nunca é registrado em mensagens de erro. */
export class HttpGitHubClient implements GitHubClient {
  private readonly token: string;
  private readonly api: string;
  private readonly doFetch: typeof fetch;

  constructor(opts: HttpGitHubClientOptions = {}) {
    const token = opts.token ?? process.env.GITHUB_TOKEN;
    if (!token) throw new GitHubAuthError("GITHUB_TOKEN não definido: exporte um token com permissão de escrita no repositório (nunca o grave em arquivo).");
    this.token = token;
    this.api = (opts.apiUrl ?? "https://api.github.com").replace(/\/$/, "");
    this.doFetch = opts.fetch ?? fetch;
  }

  private async call<T>(method: string, path: string, body?: unknown, okStatuses: number[] = []): Promise<{ status: number; data: T }> {
    const res = await this.doFetch(`${this.api}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "qa-agent",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!res.ok && !okStatuses.includes(res.status)) {
      let detail = "";
      try {
        detail = ((await res.json()) as { message?: string }).message ?? "";
      } catch {
        /* sem corpo */
      }
      if (res.status === 401 || res.status === 403) throw new GitHubAuthError(`GitHub recusou o acesso (${res.status}) em ${method} ${path}: ${detail}`);
      throw new Error(`GitHub ${method} ${path} falhou (${res.status}): ${detail}`);
    }
    const data = (res.status === 204 ? undefined : await res.json().catch(() => undefined)) as T;
    return { status: res.status, data };
  }

  async createBranchWithFiles(a: { repo: string; branch: string; base?: string; message: string; files: RepoFile[] }) {
    const { repo } = a;
    const base = a.base ?? (await this.call<{ default_branch: string }>("GET", `/repos/${repo}`)).data.default_branch;
    const baseRef = (await this.call<{ object: { sha: string } }>("GET", `/repos/${repo}/git/ref/heads/${encodeURIComponent(base).replace(/%2F/g, "/")}`)).data.object.sha;
    const baseCommit = (await this.call<{ tree: { sha: string } }>("GET", `/repos/${repo}/git/commits/${baseRef}`)).data;
    const tree: Array<{ path: string; mode: "100644"; type: "blob"; sha: string }> = [];
    for (const f of a.files) {
      const blob = (await this.call<{ sha: string }>("POST", `/repos/${repo}/git/blobs`, { content: f.content.toString("base64"), encoding: "base64" })).data;
      tree.push({ path: f.path, mode: "100644", type: "blob", sha: blob.sha });
    }
    const newTree = (await this.call<{ sha: string }>("POST", `/repos/${repo}/git/trees`, { base_tree: baseCommit.tree.sha, tree })).data;
    const commit = (await this.call<{ sha: string }>("POST", `/repos/${repo}/git/commits`, { message: a.message, tree: newTree.sha, parents: [baseRef] })).data;
    await this.call("POST", `/repos/${repo}/git/refs`, { ref: `refs/heads/${a.branch}`, sha: commit.sha });
    return { branch: a.branch, commitSha: commit.sha };
  }

  async createPR(a: { repo: string; head: string; base?: string; title: string; body: string }) {
    const base = a.base ?? (await this.call<{ default_branch: string }>("GET", `/repos/${a.repo}`)).data.default_branch;
    const pr = (await this.call<{ number: number; html_url: string }>("POST", `/repos/${a.repo}/pulls`, { title: a.title, head: a.head, base, body: a.body })).data;
    return { number: pr.number, url: pr.html_url };
  }

  async getFile(a: { repo: string; ref: string; path: string }) {
    const path = a.path.split("/").map(encodeURIComponent).join("/");
    const r = await this.call<{ content?: string; encoding?: string }>("GET", `/repos/${a.repo}/contents/${path}?ref=${encodeURIComponent(a.ref)}`, undefined, [404]);
    if (r.status === 404 || !r.data?.content) return undefined;
    return Buffer.from(r.data.content, "base64").toString("utf8");
  }

  async listOpenIssues(a: { repo: string }) {
    const out: OpenIssue[] = [];
    for (let page = 1; page <= 20; page++) {
      const r = await this.call<Array<{ number: number; title: string; body: string | null; pull_request?: unknown }>>("GET", `/repos/${a.repo}/issues?state=open&per_page=100&page=${page}`);
      const items = r.data ?? [];
      out.push(...items.filter((i) => !i.pull_request).map((i) => ({ number: i.number, title: i.title, body: i.body ?? "" })));
      if (items.length < 100) break;
    }
    return out;
  }

  async createIssue(a: { repo: string; title: string; body: string; labels: string[] }) {
    const r = (await this.call<{ number: number; html_url: string }>("POST", `/repos/${a.repo}/issues`, { title: a.title, body: a.body, labels: a.labels })).data;
    return { number: r.number, url: r.html_url };
  }
}
