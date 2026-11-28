// Persistência externa gratuita opcional via Upstash Redis REST ou GitHub Gist
// Configure no Render (Environment Variables):
// Opção A (Upstash Redis): UPSTASH_REDIS_REST_URL e UPSTASH_REDIS_REST_TOKEN
// Opção B (GitHub Gist): GITHUB_GIST_ID e GITHUB_TOKEN

const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const GIST_ID = process.env.GITHUB_GIST_ID;
const GH_TOKEN = process.env.GITHUB_TOKEN;

export async function saveExternalState(key: string, data: unknown): Promise<void> {
  const json = JSON.stringify(data);

  if (REDIS_URL && REDIS_TOKEN) {
    try {
      await fetch(`${REDIS_URL}/set/${encodeURIComponent(key)}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${REDIS_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: json,
      });
    } catch {}
    return;
  }

  if (GIST_ID && GH_TOKEN) {
    try {
      await fetch(`https://api.github.com/gists/${GIST_ID}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${GH_TOKEN}`,
          "Content-Type": "application/json",
          Accept: "application/vnd.github+json",
        },
        body: JSON.stringify({
          files: {
            [`${key}.json`]: { content: json },
          },
        }),
      });
    } catch {}
  }
}

export async function loadExternalState<T>(key: string): Promise<T | null> {
  if (REDIS_URL && REDIS_TOKEN) {
    try {
      const res = await fetch(`${REDIS_URL}/get/${encodeURIComponent(key)}`, {
        headers: { Authorization: `Bearer ${REDIS_TOKEN}` },
      });
      const body = await res.json();
      if (body?.result) {
        return typeof body.result === "string"
          ? (JSON.parse(body.result) as T)
          : (body.result as T);
      }
    } catch {}
    return null;
  }

  if (GIST_ID && GH_TOKEN) {
    try {
      const res = await fetch(`https://api.github.com/gists/${GIST_ID}`, {
        headers: {
          Authorization: `Bearer ${GH_TOKEN}`,
          Accept: "application/vnd.github+json",
        },
      });
      const gist = await res.json();
      const content = gist?.files?.[`${key}.json`]?.content;
      if (content) return JSON.parse(content) as T;
    } catch {}
  }

  return null;
}
