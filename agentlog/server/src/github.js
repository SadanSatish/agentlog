// github.js — GitHub OAuth + API helpers.
//
// Handles the full OAuth flow (redirect → code exchange → token) and
// provides thin wrappers around the GitHub REST API for fetching the
// authenticated user's profile and repositories.

const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID || "";
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET || "";
const CALLBACK_PATH = "/auth/github/callback";

/**
 * Build the GitHub OAuth authorization URL.
 * @param {string} baseUrl - The server's own origin, e.g. "http://localhost:4790"
 * @param {string} state   - CSRF-protection random token
 */
export function getAuthUrl(baseUrl, state) {
  const params = new URLSearchParams({
    client_id: GITHUB_CLIENT_ID,
    redirect_uri: `${baseUrl}${CALLBACK_PATH}`,
    scope: "read:user repo",
    state,
  });
  return `https://github.com/login/oauth/authorize?${params}`;
}

/**
 * Exchange an OAuth authorization code for an access token.
 */
export async function exchangeCode(code) {
  const res = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      client_id: GITHUB_CLIENT_ID,
      client_secret: GITHUB_CLIENT_SECRET,
      code,
    }),
  });
  const data = await res.json();
  if (data.error) {
    throw new Error(`GitHub OAuth error: ${data.error_description || data.error}`);
  }
  return data.access_token;
}

/**
 * Fetch the authenticated user's GitHub profile.
 */
export async function fetchUser(token) {
  const res = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "AgentLog/0.1",
    },
  });
  if (!res.ok) throw new Error(`GitHub /user failed: ${res.status}`);
  const u = await res.json();
  return {
    login: u.login,
    name: u.name || u.login,
    avatar_url: u.avatar_url,
    html_url: u.html_url,
  };
}

/**
 * Fetch all repositories the authenticated user has access to.
 * Paginates up to 200 repos (per_page=100, 2 pages max).
 * Returns normalized identifiers like "github.com/owner/repo".
 */
export async function fetchRepos(token) {
  const repos = [];
  let page = 1;
  const maxPages = 3; // up to 300 repos

  while (page <= maxPages) {
    const res = await fetch(
      `https://api.github.com/user/repos?per_page=100&sort=updated&direction=desc&page=${page}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "User-Agent": "AgentLog/0.1",
        },
      }
    );
    if (!res.ok) throw new Error(`GitHub /user/repos failed: ${res.status}`);
    const batch = await res.json();
    if (!batch.length) break;

    for (const r of batch) {
      repos.push({
        id: `github.com/${r.full_name}`,
        full_name: r.full_name,
        name: r.name,
        owner: r.owner.login,
        private: r.private,
        html_url: r.html_url,
        description: r.description || "",
        updated_at: r.updated_at,
      });
    }

    if (batch.length < 100) break; // last page
    page++;
  }

  return repos;
}

export function isConfigured() {
  return !!(GITHUB_CLIENT_ID && GITHUB_CLIENT_SECRET);
}
