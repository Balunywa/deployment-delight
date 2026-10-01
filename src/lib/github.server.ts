/*
 * GitHub REST calls for the control plane, authenticated with CD_GITHUB_TOKEN (a GitHub App installation token or
 * a token with repo + workflow scope). Server-only.
 */
export const githubToken = () => process.env["CD_GITHUB_TOKEN"]?.trim() || "";

export class GitHubError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

type Init = { method?: string; body?: unknown };

async function request(path: string, init: Init = {}) {
  const res = await fetch(path.startsWith("https://") ? path : `https://api.github.com${path}`, {
    method: init.method ?? "GET",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${githubToken()}`,
      "User-Agent": "cloud-delivery",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok)
    throw new GitHubError(
      `GitHub ${init.method ?? "GET"} ${path.replace(/^https:\/\/api\.github\.com/, "")} failed (${res.status}): ${(await res.text()).slice(0, 300)}`,
      res.status,
    );
  return res;
}

export async function github<T = Record<string, unknown>>(path: string, init: Init = {}) {
  const res = await request(path, init);
  const text = await res.text();
  return (text ? JSON.parse(text) : {}) as T;
}

/** The same call, with 404 as null. */
export async function githubMaybe<T = Record<string, unknown>>(path: string, init: Init = {}) {
  try {
    return await github<T>(path, init);
  } catch (e) {
    if (e instanceof GitHubError && e.status === 404) return null;
    throw e;
  }
}

/** Plain-text or binary downloads (job logs, artifact archives); GitHub redirects to a signed URL. */
export async function githubDownload(path: string) {
  return new Uint8Array(await (await request(path)).arrayBuffer());
}
