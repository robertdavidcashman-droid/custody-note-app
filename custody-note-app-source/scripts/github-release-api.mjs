/**
 * GitHub release helpers — draft releases are invisible to /releases/tags/{tag}.
 */
export const RELEASE_OWNER = 'robertcashman-bit';
export const RELEASE_REPO = 'custody-note-app';

export function normaliseReleaseTag(tag) {
  const t = String(tag || '').trim();
  if (!t) return '';
  return t.startsWith('v') ? t : `v${t}`;
}

export function releaseApiHeaders(token) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'CustodyNote-GitHubReleaseApi',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

/**
 * Fetch a release by tag, including draft releases (tag endpoint returns 404 for drafts).
 */
export async function fetchReleaseByTag(tag, token) {
  const normalised = normaliseReleaseTag(tag);
  const headers = releaseApiHeaders(token);
  const base = `https://api.github.com/repos/${RELEASE_OWNER}/${RELEASE_REPO}`;

  const tagRes = await fetch(`${base}/releases/tags/${encodeURIComponent(normalised)}`, { headers });
  if (tagRes.ok) return tagRes.json();
  if (tagRes.status !== 404) {
    throw new Error(`Release ${normalised} lookup failed: HTTP ${tagRes.status} ${await tagRes.text()}`);
  }

  for (let page = 1; page <= 5; page++) {
    const listRes = await fetch(`${base}/releases?per_page=100&page=${page}`, { headers });
    if (!listRes.ok) {
      throw new Error(`Release list failed: HTTP ${listRes.status} ${await listRes.text()}`);
    }
    const releases = await listRes.json();
    if (!Array.isArray(releases) || releases.length === 0) break;
    const match = releases.find((r) => r.tag_name === normalised);
    if (match) return match;
    if (releases.length < 100) break;
  }

  throw new Error(`Release ${normalised} not found (including drafts)`);
}

/**
 * Poll until a release exists (CI may still be creating the draft).
 */
export async function waitForReleaseByTag(tag, token, opts = {}) {
  const maxAttempts = opts.maxAttempts != null ? opts.maxAttempts : 60;
  const delayMs = opts.delayMs != null ? opts.delayMs : 5000;
  const normalised = normaliseReleaseTag(tag);
  let lastErr = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fetchReleaseByTag(normalised, token);
    } catch (err) {
      lastErr = err;
      if (attempt < maxAttempts) {
        console.log(`[github-release] Waiting for ${normalised} (attempt ${attempt}/${maxAttempts})…`);
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
  }
  throw lastErr || new Error(`Release ${normalised} not found after ${maxAttempts} attempts`);
}
