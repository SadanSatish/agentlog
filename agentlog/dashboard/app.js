// AgentLog dashboard client.
// Talks directly to the REST API (same origin when served by the AgentLog
// server itself; override API_BASE if you're hosting the dashboard elsewhere).

const API_BASE = window.AGENTLOG_API_BASE || "";

const state = {
  repo: null,
  type: "",
  status: "active",
  q: "",
  entries: [],
  user: null,         // GitHub user info when logged in
  githubRepos: [],    // repos synced from GitHub
  info: null,         // API info (paths, urls)
};

const el = {
  repoSelect: document.getElementById("repoSelect"),
  statTotal: document.getElementById("statTotal"),
  statActive: document.getElementById("statActive"),
  typeChips: document.getElementById("typeChips"),
  statusChips: document.getElementById("statusChips"),
  searchInput: document.getElementById("searchInput"),
  timeline: document.getElementById("timeline"),
  emptyState: document.getElementById("emptyState"),
  newEntryBtn: document.getElementById("newEntryBtn"),
  entryDialog: document.getElementById("entryDialog"),
  entryForm: document.getElementById("entryForm"),
  cancelEntry: document.getElementById("cancelEntry"),
  // Auth elements
  authLogin: document.getElementById("authLogin"),
  authUser: document.getElementById("authUser"),
  githubLoginBtn: document.getElementById("githubLoginBtn"),
  userAvatar: document.getElementById("userAvatar"),
  userName: document.getElementById("userName"),
  logoutBtn: document.getElementById("logoutBtn"),
};

async function api(path, opts) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    credentials: "include", // send cookies for auth
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `request failed: ${res.status}`);
  }
  return res.json();
}

function timeAgo(iso) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

const TYPE_LABEL = {
  decision: "decision",
  failed_approach: "fail",
  gotcha: "gotcha",
  note: "note",
};

function entryNode(entry) {
  const node = document.createElement("article");
  node.className = "entry";
  node.dataset.type = entry.type;
  node.dataset.id = entry.id;

  const tags = entry.tags?.length
    ? `<span class="pill">${entry.tags.join(", ")}</span>`
    : "";
  const prRef = entry.pr_ref ? `<span class="pill">${escapeHtml(entry.pr_ref)}</span>` : "";
  const statusBadge =
    entry.status !== "active"
      ? `<span class="entry-status-badge">${entry.status}</span>`
      : "";

  node.innerHTML = `
    <div class="entry-head">
      <span class="tag">${TYPE_LABEL[entry.type] || entry.type}</span>
      <span class="entry-title">${escapeHtml(entry.title)}</span>
      ${entry.scope ? `<span class="entry-scope">${escapeHtml(entry.scope)}</span>` : ""}
    </div>
    <div class="entry-body">${escapeHtml(entry.body)}</div>
    <div class="entry-meta">
      <div class="entry-meta-left">
        <span class="pill">${escapeHtml(entry.author || entry.agent || "unknown")}</span>
        ${entry.agent ? `<span class="pill">${escapeHtml(entry.agent)}</span>` : ""}
        ${tags}
        ${prRef}
        <span>${timeAgo(entry.created_at)}</span>
        ${statusBadge}
      </div>
      <div class="entry-actions">
        ${
          entry.status === "active"
            ? `<button class="btn btn-ghost btn-sm" data-action="stale">mark stale</button>`
            : `<button class="btn btn-ghost btn-sm" data-action="reactivate">reactivate</button>`
        }
        <button class="btn btn-ghost btn-sm" data-action="delete">delete</button>
      </div>
    </div>
  `;
  return node;
}

function escapeHtml(str) {
  const d = document.createElement("div");
  d.textContent = str ?? "";
  return d.innerHTML;
}

function render() {
  el.timeline.innerHTML = "";
  if (!state.entries.length) {
    el.emptyState.hidden = false;
    return;
  }
  el.emptyState.hidden = true;
  for (const entry of state.entries) {
    el.timeline.appendChild(entryNode(entry));
  }
}

// --- Auth ---------------------------------------------------------------

async function checkAuth() {
  try {
    // First check if GitHub OAuth is even configured
    const authStatus = await api("/api/auth/status");
    if (!authStatus.github_configured) {
      // GitHub not configured — hide both auth sections
      el.authLogin.hidden = true;
      el.authUser.hidden = true;
      return;
    }

    const me = await api("/api/me");
    if (me.authenticated) {
      state.user = me.user;
      state.githubRepos = me.github_repos || [];
      showLoggedIn();
    } else {
      state.user = null;
      state.githubRepos = [];
      showLoggedOut();
    }
  } catch {
    // Auth check failed — just show logged-out state
    showLoggedOut();
  }
}

function showLoggedIn() {
  el.authLogin.hidden = true;
  el.authUser.hidden = false;
  el.userAvatar.src = state.user.avatar_url;
  el.userName.textContent = state.user.name || state.user.login;
}

function showLoggedOut() {
  el.authLogin.hidden = false;
  el.authUser.hidden = true;
}

// --- Repos --------------------------------------------------------------

async function loadRepos() {
  const agentlogRepos = await api("/api/repos");

  // Merge: GitHub repos + any AgentLog repos not in GitHub
  const repoSet = new Set();
  const allRepos = [];

  // GitHub repos first (sorted by update time from GitHub API)
  for (const r of state.githubRepos) {
    if (!repoSet.has(r.id)) {
      repoSet.add(r.id);
      allRepos.push(r.id);
    }
  }

  // Then any existing AgentLog repos
  for (const r of agentlogRepos) {
    if (!repoSet.has(r)) {
      repoSet.add(r);
      allRepos.push(r);
    }
  }

  // Fallback
  if (!allRepos.length) allRepos.push("default");

  el.repoSelect.innerHTML = "";

  // If we have GitHub repos, add an optgroup for clarity
  if (state.githubRepos.length && agentlogRepos.length) {
    const ghGroup = document.createElement("optgroup");
    ghGroup.label = "GitHub repos";
    const alGroup = document.createElement("optgroup");
    alGroup.label = "AgentLog repos";

    const ghIds = new Set(state.githubRepos.map(r => r.id));

    for (const r of allRepos) {
      const opt = document.createElement("option");
      opt.value = r;
      opt.textContent = r.replace("github.com/", "");
      if (ghIds.has(r)) {
        ghGroup.appendChild(opt);
      } else {
        alGroup.appendChild(opt);
      }
    }
    if (ghGroup.children.length) el.repoSelect.appendChild(ghGroup);
    if (alGroup.children.length) el.repoSelect.appendChild(alGroup);
  } else {
    for (const r of allRepos) {
      const opt = document.createElement("option");
      opt.value = r;
      opt.textContent = r.replace("github.com/", "");
      el.repoSelect.appendChild(opt);
    }
  }

  state.repo = allRepos[0];
  el.repoSelect.value = state.repo;
}

async function loadStats() {
  const s = await api(`/api/stats?repo=${encodeURIComponent(state.repo)}`);
  el.statTotal.textContent = s.total || 0;
  el.statActive.textContent = s.active || 0;
}

async function loadEntries() {
  const params = new URLSearchParams({ repo: state.repo });
  if (state.type) params.set("type", state.type);
  if (state.status) params.set("status", state.status);
  if (state.q) params.set("q", state.q);
  state.entries = await api(`/api/entries?${params.toString()}`);
  render();
}

async function refresh() {
  await Promise.all([loadStats(), loadEntries()]);
  const activeTab = document.querySelector(".view-tab.active");
  if (activeTab && activeTab.dataset.view === "pitfalls") {
    loadPitfallsBoard();
  } else if (activeTab && activeTab.dataset.view === "telemetry") {
    loadTelemetryView();
  }
}

function setActiveChip(group, attr, value) {
  for (const chip of group.children) {
    chip.classList.toggle("is-active", chip.dataset[attr] === value);
  }
}

// --- event wiring -------------------------------------------------------

el.githubLoginBtn.addEventListener("click", () => {
  window.location.href = `${API_BASE}/auth/github`;
});

el.logoutBtn.addEventListener("click", async () => {
  await api("/api/logout", { method: "POST" });
  state.user = null;
  state.githubRepos = [];
  showLoggedOut();
  await loadRepos();
  await refresh();
});

el.repoSelect.addEventListener("change", async (e) => {
  state.repo = e.target.value;
  updateSetupSnippet();
  await refresh();
});

el.typeChips.addEventListener("click", async (e) => {
  const btn = e.target.closest(".chip");
  if (!btn) return;
  state.type = btn.dataset.type;
  setActiveChip(el.typeChips, "type", state.type);
  await loadEntries();
});

el.statusChips.addEventListener("click", async (e) => {
  const btn = e.target.closest(".chip");
  if (!btn) return;
  state.status = btn.dataset.status;
  setActiveChip(el.statusChips, "status", state.status);
  await loadEntries();
});

let searchDebounce;
el.searchInput.addEventListener("input", (e) => {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(async () => {
    state.q = e.target.value.trim();
    await loadEntries();
  }, 250);
});

el.timeline.addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;
  const card = btn.closest(".entry");
  const id = card.dataset.id;
  const action = btn.dataset.action;

  if (action === "delete") {
    if (!confirm("Delete this entry? This can't be undone.")) return;
    await api(`/api/entries/${id}`, { method: "DELETE" });
  } else if (action === "stale") {
    await api(`/api/entries/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "stale" }),
    });
  } else if (action === "reactivate") {
    await api(`/api/entries/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "active" }),
    });
  }
  await refresh();
});

el.newEntryBtn.addEventListener("click", () => {
  el.entryForm.reset();
  el.entryDialog.showModal();
});
el.cancelEntry.addEventListener("click", () => el.entryDialog.close());

el.entryForm.addEventListener("submit", async (e) => {
  const formData = new FormData(el.entryForm);
  const payload = {
    repo: state.repo,
    type: formData.get("type"),
    title: formData.get("title"),
    body: formData.get("body"),
    scope: formData.get("scope") || "",
    author: formData.get("author") || (state.user?.login || ""),
    pr_ref: formData.get("pr_ref") || "",
    tags: (formData.get("tags") || "")
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean),
  };
  await api("/api/entries", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  el.entryDialog.close();
  await refresh();
});

const ALL_TOOLS = [
  { id: "record_decision", title: "Record Decision", desc: "Log architectural choices" },
  { id: "log_failed_approach", title: "Log Failures", desc: "Record tried approaches that failed" },
  { id: "log_gotcha", title: "Log Gotchas", desc: "Record quirks and constraints" },
  { id: "query_context", title: "Query Context", desc: "Check file context before editing" },
  { id: "list_recent", title: "List Recent", desc: "Browse recent timeline logs" },
  { id: "mark_stale", title: "Mark Stale", desc: "Prune stale or superseded logs" },
  { id: "fetch_github_readme", title: "Fetch README", desc: "Read any GitHub repo README" },
  { id: "list_github_files", title: "List Files", desc: "List files in a GitHub repo" },
  { id: "fetch_github_file", title: "Fetch File", desc: "Read any file in a GitHub repo" },
  { id: "search_entries", title: "Search Entries", desc: "Search through AgentLog notes" },
  { id: "search_github_code", title: "Search Code", desc: "Search code in a GitHub repo" },
  { id: "log_token_usage", title: "Log Token Usage", desc: "Report token telemetry automatically" },
  { id: "summarize_github_repo", title: "Summarize Repo", desc: "Generate repo summary (tech stack, README, entries)" }
];

let toolsInitialized = false;

function renderToolsGrid() {
  const grid = document.getElementById("toolsGrid");
  if (!grid || toolsInitialized) return;
  grid.innerHTML = ALL_TOOLS.map(t => `
    <label class="tool-checkbox-label" style="display: flex; align-items: flex-start; gap: 8px; background: rgba(255,255,255,0.02); border: 1px solid var(--border); border-radius: var(--radius); padding: 8px 10px; cursor: pointer; transition: var(--transition);">
      <input type="checkbox" class="tool-chk" value="${t.id}" checked style="margin-top: 3px;" />
      <div class="tool-chk-content" style="display: flex; flex-direction: column; min-width: 0;">
        <span class="tool-chk-title" style="font-family: var(--font-mono); font-size: 11px; font-weight: 600; color: var(--text);">${t.title}</span>
        <span class="tool-chk-desc" style="font-size: 10px; color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${t.desc}</span>
      </div>
    </label>
  `).join("");

  grid.querySelectorAll(".tool-chk").forEach(chk => {
    chk.addEventListener("change", () => {
      updateSetupSnippet();
    });
  });
  toolsInitialized = true;
}

function updateSetupSnippet() {
  if (!state.info) return;

  const repo = state.repo || "default";
  const author = state.user?.login || "your-username";
  const mcpPath = state.info.mcpPath;
  const apiUrl = state.info.apiUrl;
  const installHookPath = state.info.installHookPath;

  const disabledTools = Array.from(document.querySelectorAll(".tool-chk"))
    .filter(chk => !chk.checked)
    .map(chk => chk.value);

  // Claude configuration
  const claudeEnv = {
    AGENTLOG_API_URL: apiUrl,
    AGENTLOG_REPO: repo,
    AGENTLOG_AGENT: "claude-code",
    AGENTLOG_AUTHOR: author
  };
  if (disabledTools.length) {
    claudeEnv.AGENTLOG_DISABLED_TOOLS = disabledTools.join(",");
  }

  const claudeConfig = {
    mcpServers: {
      agentlog: {
        command: "node",
        args: [mcpPath],
        env: claudeEnv
      }
    }
  };
  document.getElementById("codeClaude").textContent = JSON.stringify(claudeConfig, null, 2);

  // Cursor command & env
  document.getElementById("cursorCmd").textContent = `node "${mcpPath}"`;
  
  const cursorEnv = [
    `AGENTLOG_API_URL=${apiUrl}`,
    `AGENTLOG_REPO=${repo}`,
    `AGENTLOG_AGENT=cursor`,
    `AGENTLOG_AUTHOR=${author}`
  ];
  if (disabledTools.length) {
    cursorEnv.push(`AGENTLOG_DISABLED_TOOLS=${disabledTools.join(",")}`);
  }
  document.getElementById("codeCursorEnv").textContent = cursorEnv.join("\n");

  // Antigravity configuration
  const antigravityEnv = {
    AGENTLOG_API_URL: apiUrl,
    AGENTLOG_REPO: repo,
    AGENTLOG_AGENT: "antigravity",
    AGENTLOG_AUTHOR: author
  };
  if (disabledTools.length) {
    antigravityEnv.AGENTLOG_DISABLED_TOOLS = disabledTools.join(",");
  }

  const antigravityConfig = {
    mcpServers: {
      agentlog: {
        command: "node",
        args: [mcpPath],
        env: antigravityEnv
      }
    }
  };
  document.getElementById("codeAntigravity").textContent = JSON.stringify(antigravityConfig, null, 2);

  // Git hook installer command
  document.getElementById("codeGitHook").textContent = `bash "${installHookPath}"`;
}

// --- setup guide event wiring ---

const setupDialog = document.getElementById("setupDialog");
const setupAgentBtn = document.getElementById("setupAgentBtn");
const closeSetup = document.getElementById("closeSetup");

setupAgentBtn.addEventListener("click", () => {
  renderToolsGrid();
  updateSetupSnippet();
  setupDialog.showModal();
});

closeSetup.addEventListener("click", () => {
  setupDialog.close();
});

// Tab switching
setupDialog.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", (e) => {
    setupDialog.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    setupDialog.querySelectorAll(".setup-tab-content").forEach((c) => c.classList.remove("active"));

    btn.classList.add("active");
    const tabId = btn.dataset.tab;
    setupDialog.querySelector(`#tab-${tabId}`).classList.add("active");
  });
});

// Copy button functionality
setupDialog.querySelectorAll(".btn-copy").forEach((btn) => {
  btn.addEventListener("click", () => {
    const targetId = btn.dataset.target;
    const code = document.getElementById(targetId).textContent;
    navigator.clipboard.writeText(code).then(() => {
      const originalText = btn.textContent;
      btn.textContent = "copied!";
      btn.classList.add("copied");
      setTimeout(() => {
        btn.textContent = originalText;
        btn.classList.remove("copied");
      }, 1500);
    });
  });
});

// --- custom tools event wiring ---

const customToolsDialog = document.getElementById("customToolsDialog");
const manageCustomToolsBtn = document.getElementById("manageCustomToolsBtn");
const closeCustomTools = document.getElementById("closeCustomTools");
const customToolsList = document.getElementById("customToolsList");
const customToolForm = document.getElementById("customToolForm");

async function loadCustomTools() {
  customToolsList.innerHTML = "<span style='font-size: 12px; color: var(--text-muted);'>Loading custom tools...</span>";
  try {
    const tools = await api("/api/custom-tools");
    if (!tools.length) {
      customToolsList.innerHTML = "<span style='font-size: 12px; color: var(--text-faint);'>No custom tools created yet.</span>";
      return;
    }
    customToolsList.innerHTML = tools.map(t => `
      <div class="custom-tool-item" style="display: flex; align-items: center; justify-content: space-between; gap: 10px; background: rgba(255,255,255,0.02); border: 1px solid var(--border); border-radius: var(--radius); padding: 6px 10px;">
        <div style="display: flex; flex-direction: column; min-width: 0;">
          <span style="font-family: var(--font-mono); font-size: 11.5px; font-weight: 600; color: var(--accent-decision);">${t.name}</span>
          <span style="font-size: 10.5px; color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${t.description}</span>
        </div>
        <button class="btn btn-ghost btn-sm btn-delete-tool" data-id="${t.id}" style="padding: 2px 6px; font-size: 10px; color: var(--accent-fail); border-color: var(--border);">delete</button>
      </div>
    `).join("");

    customToolsList.querySelectorAll(".btn-delete-tool").forEach(btn => {
      btn.addEventListener("click", async () => {
        if (!confirm("Are you sure you want to delete this custom tool? You will need to restart/refresh your MCP servers to apply.")) return;
        await api(`/api/custom-tools/${btn.dataset.id}`, { method: "DELETE" });
        await loadCustomTools();
      });
    });
  } catch (err) {
    customToolsList.innerHTML = `<span style='font-size: 12px; color: var(--accent-fail);'>Error: ${err.message}</span>`;
  }
}

const TEMPLATES = {
  custom: {
    name: "",
    description: "",
    params: [],
    code: ""
  },
  fetch_json: {
    name: "fetch_exchange_rates",
    description: "Fetch exchange rates for a base currency from currency API",
    params: [
      { name: "base", type: "string", desc: "Base currency code (e.g. USD, EUR)" }
    ],
    code: `const res = await fetch(\`https://open.er-api.com/v6/latest/\${args.base.toUpperCase()}\`);
if (!res.ok) throw new Error("API call failed");
const data = await res.json();
return \`Exchange rates for \${data.base_code}:\\n\` + 
  Object.entries(data.rates).slice(0, 10).map(([k, v]) => \`- \${k}: \${v}\`).join("\\n");`
  },
  math: {
    name: "calculate_percentage",
    description: "Calculate what percentage value is of total",
    params: [
      { name: "value", type: "number", desc: "The numerator value" },
      { name: "total", type: "number", desc: "The denominator total" }
    ],
    code: `const pct = (args.value / args.total) * 100;
return \`\${args.value} is \${pct.toFixed(2)}% of \${args.total}\`;`
  },
  github_issues: {
    name: "get_github_issues",
    description: "Retrieve a list of active issues in a public GitHub repository",
    params: [
      { name: "owner", type: "string", desc: "Repository owner username" },
      { name: "repo", type: "string", desc: "Repository name" }
    ],
    code: `const res = await fetch(\`https://api.github.com/repos/\${args.owner}/\${args.repo}/issues?state=open\`, {
  headers: { "User-Agent": "AgentLog/0.1" }
});
if (!res.ok) throw new Error("GitHub API failed: HTTP " + res.status);
const data = await res.json();
if (!data.length) return "No open issues found.";
return data.slice(0, 5).map(issue => \`#\${issue.number}: \${issue.title} (by \${issue.user.login})\`).join("\\n");`
  },
  ip_geolocation: {
    name: "ip_lookup",
    description: "Get location data and ISP for a specific IP address",
    params: [
      { name: "ip", type: "string", desc: "IP address to query" }
    ],
    code: `const res = await fetch(\`https://ipapi.co/\${args.ip}/json/\`);
if (!res.ok) throw new Error("IP API failed");
const data = await res.json();
if (data.error) return \`Lookup error: \${data.reason}\`;
return \`Location: \${data.city}, \${data.region}, \${data.country_name}\\nOrganization: \${data.org}\\nTimezone: \${data.timezone}\`;`
  },
  hn_top: {
    name: "hacker_news_top",
    description: "Get the titles and links of top Hacker News stories",
    params: [],
    code: `const topStoriesRes = await fetch("https://hacker-news.firebaseio.com/v0/topstories.json");
const ids = await topStoriesRes.json();
const stories = [];
for (const id of ids.slice(0, 5)) {
  const storyRes = await fetch(\`https://hacker-news.firebaseio.com/v0/item/\${id}.json\`);
  const story = await storyRes.json();
  stories.push(\`- \${story.title} (\${story.url || "no url"})\`);
}
return stories.join("\\n");`
  }
};

const addParamBtn = document.getElementById("addParamBtn");
const paramsBuilder = document.getElementById("paramsBuilder");
const toolTemplate = document.getElementById("toolTemplate");

function createParamRow(name = "", type = "string", desc = "") {
  const row = document.createElement("div");
  row.className = "param-row";
  row.style = "display: grid; grid-template-columns: 1fr 80px 1.5fr 30px; gap: 6px; align-items: center;";
  row.innerHTML = `
    <input type="text" class="param-name" placeholder="param_name" value="${name}" required style="padding: 4px 6px; font-size: 11.5px; font-family: var(--font-mono); border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface);" />
    <select class="param-type" style="padding: 4px 6px; font-size: 11.5px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); color: var(--text);">
      <option value="string" ${type === "string" ? "selected" : ""}>string</option>
      <option value="number" ${type === "number" ? "selected" : ""}>number</option>
      <option value="boolean" ${type === "boolean" ? "selected" : ""}>boolean</option>
    </select>
    <input type="text" class="param-desc" placeholder="description" value="${desc}" required style="padding: 4px 6px; font-size: 11.5px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface);" />
    <button type="button" class="btn btn-ghost btn-sm btn-remove-param" style="padding: 2px 4px; font-size: 10px; color: var(--accent-fail); border-color: var(--border);">X</button>
  `;
  row.querySelector(".btn-remove-param").addEventListener("click", () => row.remove());
  paramsBuilder.appendChild(row);
}

addParamBtn.addEventListener("click", () => createParamRow());

toolTemplate.addEventListener("change", (e) => {
  const t = TEMPLATES[e.target.value];
  if (!t) return;
  customToolForm.elements["name"].value = t.name;
  customToolForm.elements["description"].value = t.description;
  customToolForm.elements["code"].value = t.code;
  
  paramsBuilder.innerHTML = "";
  for (const p of t.params) {
    createParamRow(p.name, p.type, p.desc);
  }
});

const toolType = document.getElementById("toolType");
const apiBuilderFields = document.getElementById("apiBuilderFields");
const apiEndpoint = document.getElementById("apiEndpoint");
const apiMethod = document.getElementById("apiMethod");
const apiSelector = document.getElementById("apiSelector");
const apiHeaders = document.getElementById("apiHeaders");

function generateJsCodeFromApiBuilder() {
  const endpoint = apiEndpoint.value.trim();
  const method = apiMethod.value;
  const selector = apiSelector.value.trim();
  const headersStr = apiHeaders.value.trim();

  if (!endpoint) {
    customToolForm.elements["code"].value = "";
    return;
  }

  const urlParams = Array.from(endpoint.matchAll(/\{\{([a-zA-Z0-9_]+)\}\}/g)).map(m => m[1]);
  const existingParams = Array.from(paramsBuilder.querySelectorAll(".param-name")).map(input => input.value.trim());

  urlParams.forEach(p => {
    if (!existingParams.includes(p)) {
      createParamRow(p, "string", `Input parameter ${p}`);
    }
  });

  const formattedUrl = endpoint.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (_, name) => `\${args.${name}}`);

  let headersObj = {};
  if (headersStr) {
    try {
      headersObj = JSON.parse(headersStr);
    } catch {
      // ignore
    }
  }

  let code = `const url = \`${formattedUrl}\`;\n`;
  if (headersStr) {
    code += `const headers = ${JSON.stringify(headersObj, null, 2)};\n`;
  } else {
    code += `const headers = {};\n`;
  }

  const isGetOrDelete = method === "GET" || method === "DELETE";
  code += `const res = await fetch(url, {\n  method: "${method}",\n  headers`;

  if (!isGetOrDelete) {
    code += `,\n  body: JSON.stringify(args)`;
  }
  code += `\n});\n`;
  code += `if (!res.ok) throw new Error("Request failed: HTTP " + res.status);\n`;
  code += `const data = await res.json();\n`;

  if (selector) {
    code += `return data.${selector};`;
  } else {
    code += `return data;`;
  }

  customToolForm.elements["code"].value = code;
}

toolType.addEventListener("change", (e) => {
  const isApi = e.target.value === "api";
  apiBuilderFields.style.display = isApi ? "flex" : "none";
  customToolForm.elements["code"].readOnly = isApi;
  if (isApi) {
    generateJsCodeFromApiBuilder();
  }
});

[apiEndpoint, apiMethod, apiSelector, apiHeaders].forEach(el => {
  el.addEventListener("input", () => {
    if (toolType.value === "api") generateJsCodeFromApiBuilder();
  });
  el.addEventListener("change", () => {
    if (toolType.value === "api") generateJsCodeFromApiBuilder();
  });
});

manageCustomToolsBtn.addEventListener("click", () => {
  loadCustomTools();
  toolType.value = "api";
  apiBuilderFields.style.display = "flex";
  customToolForm.elements["code"].readOnly = true;
  customToolsDialog.showModal();
});

closeCustomTools.addEventListener("click", () => {
  customToolsDialog.close();
});

customToolForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const formData = new FormData(customToolForm);
  const name = formData.get("name").trim();
  const description = formData.get("description").trim();
  const code = formData.get("code").trim();

  // Compile parameters into JSON Schema properties object
  const properties = {};
  const required = [];
  paramsBuilder.querySelectorAll(".param-row").forEach(row => {
    const pName = row.querySelector(".param-name").value.trim();
    const pType = row.querySelector(".param-type").value;
    const pDesc = row.querySelector(".param-desc").value.trim();
    if (pName) {
      properties[pName] = { type: pType, description: pDesc };
      required.push(pName);
    }
  });

  const schema_json = JSON.stringify({
    properties,
    required
  });

  try {
    await api("/api/custom-tools", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, description, schema_json, code })
    });
    customToolForm.reset();
    apiEndpoint.value = "";
    apiSelector.value = "";
    apiHeaders.value = "";
    apiMethod.value = "GET";
    paramsBuilder.innerHTML = "";
    toolTemplate.value = "custom";
    await loadCustomTools();
  } catch (err) {
    alert(`Failed to create custom tool: ${err.message}`);
  }
});

// --- boot ----------------------------------------------------------------

(async function init() {
  try {
    await checkAuth();
    await loadRepos();
    try {
      state.info = await api("/api/info");
    } catch (e) {
      console.warn("Could not fetch server path info", e);
    }
    await refresh();
  } catch (err) {
    el.timeline.innerHTML = `<div class="empty"><p class="empty-title">can't reach the AgentLog API</p><p class="empty-sub">${escapeHtml(
      err.message
    )}</p></div>`;
  }
})();

// --- view switching & telemetry event wiring ---

const viewTabs = document.querySelectorAll(".view-tab");
const views = {
  timeline: document.getElementById("viewTimeline"),
  pitfalls: document.getElementById("viewPitfalls"),
  telemetry: document.getElementById("viewTelemetry"),
};

viewTabs.forEach(tab => {
  tab.addEventListener("click", () => {
    viewTabs.forEach(t => {
      t.classList.remove("active");
      t.style.color = "var(--text-muted)";
      t.style.borderBottomColor = "transparent";
    });
    Object.values(views).forEach(v => v.hidden = true);

    tab.classList.add("active");
    tab.style.color = "var(--text)";
    tab.style.borderBottomColor = "var(--accent-decision)";
    
    const targetView = tab.dataset.view;
    views[targetView].hidden = false;

    if (targetView === "pitfalls") {
      loadPitfallsBoard();
    } else if (targetView === "telemetry") {
      loadTelemetryView();
    }
  });
});

function loadPitfallsBoard() {
  const fails = state.entries.filter(e => e.type === "failed_approach");
  const gotchas = state.entries.filter(e => e.type === "gotcha");

  const failsContainer = document.getElementById("failedApproachesList");
  const gotchasContainer = document.getElementById("gotchasList");

  function renderMiniCard(e) {
    return `
      <div class="entry" data-id="${e.id}" style="padding: 12px; margin-bottom: 0;">
        <span style="font-family: var(--font-mono); font-size: 11px; color: var(--text-faint); margin-bottom: 4px; display: block;">${e.scope || "repo-wide"}</span>
        <div style="font-weight: 600; font-size: 13.5px; color: var(--text);">${escapeHtml(e.title)}</div>
        <div style="font-size: 12.5px; color: var(--text-muted); margin-top: 6px; white-space: pre-wrap;">${escapeHtml(e.body)}</div>
        <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 10px; font-family: var(--font-mono); font-size: 10px; color: var(--text-faint);">
          <span>by ${e.author || "?"}</span>
          <span>${timeAgo(e.created_at)}</span>
        </div>
      </div>
    `;
  }

  failsContainer.innerHTML = fails.length ? fails.map(renderMiniCard).join("") : "<div style='font-size: 12px; color: var(--text-faint); text-align: center; padding: 20px 0;'>No failed approaches recorded.</div>";
  gotchasContainer.innerHTML = gotchas.length ? gotchas.map(renderMiniCard).join("") : "<div style='font-size: 12px; color: var(--text-faint); text-align: center; padding: 20px 0;'>No gotchas recorded.</div>";
}

async function loadTelemetryView() {
  const stats = await api(`/api/telemetry/stats?repo=${encodeURIComponent(state.repo)}`);
  const logs = await api(`/api/telemetry?repo=${encodeURIComponent(state.repo)}`);

  document.getElementById("telemetryInput").textContent = stats.total_input.toLocaleString();
  document.getElementById("telemetryOutput").textContent = stats.total_output.toLocaleString();
  document.getElementById("telemetryWasted").textContent = stats.total_wasted.toLocaleString();
  document.getElementById("telemetryEffective").textContent = stats.total_effective.toLocaleString();
  document.getElementById("telemetryEfficiencyRate").textContent = `${stats.efficiency}%`;
  document.getElementById("telemetryBar").style.width = `${stats.efficiency}%`;

  const tbody = document.getElementById("telemetryTableBody");
  if (!logs.length) {
    tbody.innerHTML = "<tr><td colspan='5' style='padding: 20px; text-align: center; color: var(--text-faint);'>No telemetry logged yet.</td></tr>";
    return;
  }

  tbody.innerHTML = logs.map(l => {
    const total = l.tokens_input + l.tokens_output;
    const effective = Math.max(0, total - l.tokens_wasted);
    return `
      <tr style="border-bottom: 1px solid var(--border);">
        <td style="padding: 8px; font-family: var(--font-mono);">${new Date(l.created_at).toLocaleDateString()}</td>
        <td style="padding: 8px;">${l.tokens_input.toLocaleString()}</td>
        <td style="padding: 8px;">${l.tokens_output.toLocaleString()}</td>
        <td style="padding: 8px; color: var(--accent-fail);">${l.tokens_wasted.toLocaleString()}</td>
        <td style="padding: 8px; color: var(--accent-decision); font-weight: 600;">${effective.toLocaleString()}</td>
      </tr>
    `;
  }).join("");
}

const telemetryForm = document.getElementById("telemetryForm");
telemetryForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const formData = new FormData(telemetryForm);
  const payload = {
    repo: state.repo,
    tokens_input: Number(formData.get("tokens_input")),
    tokens_output: Number(formData.get("tokens_output")),
    tokens_wasted: Number(formData.get("tokens_wasted"))
  };

  await api("/api/telemetry", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  telemetryForm.reset();
  await loadTelemetryView();
});
