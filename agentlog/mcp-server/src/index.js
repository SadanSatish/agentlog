#!/usr/bin/env node
// AgentLog MCP server.
//
// A thin client over the AgentLog REST API (server/), exposed as MCP tools
// so any MCP-compatible agent (Claude Code, Cursor, etc.) can read and
// write the team's shared memory for a repo.
//
// Configure with env vars:
//   AGENTLOG_API_URL  - base URL of the AgentLog backend (default http://localhost:4790)
//   AGENTLOG_REPO     - default repo identifier (e.g. "github.com/acme/web")
//   AGENTLOG_AGENT    - name of the agent calling these tools (e.g. "claude-code")
//   AGENTLOG_AUTHOR   - human teammate attached to entries created in this session

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const API_URL = (process.env.AGENTLOG_API_URL || "http://localhost:4790").replace(/\/$/, "");
const DEFAULT_REPO = process.env.AGENTLOG_REPO || "default";
const AGENT_NAME = process.env.AGENTLOG_AGENT || "unknown-agent";
const AUTHOR = process.env.AGENTLOG_AUTHOR || "";
const SESSION_ID = process.env.AGENTLOG_SESSION_ID || crypto.randomUUID();

async function api(method, urlPath, body) {
  const res = await fetch(`${API_URL}${urlPath}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    throw new Error(
      `AgentLog API ${method} ${urlPath} failed (${res.status}): ${
        data?.error || text || "unknown error"
      }`
    );
  }
  return data;
}

function formatEntry(e) {
  const tagStr = e.tags?.length ? ` [${e.tags.join(", ")}]` : "";
  return (
    `### ${e.title}${tagStr}\n` +
    `type: ${e.type} | scope: ${e.scope || "(repo-wide)"} | by: ${e.author || "?"}` +
    `${e.agent ? ` via ${e.agent}` : ""} | ${e.created_at}` +
    (e.pr_ref ? ` | ${e.pr_ref}` : "") +
    `\n\n${e.body}\n`
  );
}

function textResult(str) {
  return { content: [{ type: "text", text: str }] };
}

const server = new McpServer({ name: "agentlog", version: "0.1.0" });

const DISABLED_TOOLS = (process.env.AGENTLOG_DISABLED_TOOLS || "")
  .split(",")
  .map(t => t.trim().toLowerCase())
  .filter(Boolean);

const originalRegister = server.registerTool.bind(server);
server.registerTool = (name, config, handler) => {
  if (DISABLED_TOOLS.includes(name.toLowerCase())) {
    return;
  }
  originalRegister(name, config, handler);
};

// ---------------------------------------------------------------------
// record_decision
// ---------------------------------------------------------------------
server.registerTool(
  "record_decision",
  {
    title: "Record Decision",
    description:
      "Record a decision the team has made about how to approach something — " +
      "e.g. an architectural choice, a rejected design, or 'why we did it this way'. " +
      "Other agents working on the same repo will see this before touching related files.",
    inputSchema: {
      title: z.string().describe("Short summary of the decision, e.g. 'Use httpOnly cookies for sessions'"),
      body: z.string().describe("The decision and the reasoning behind it. Markdown ok."),
      scope: z
        .string()
        .optional()
        .describe("File path or module this applies to, e.g. 'src/auth/' or 'src/auth/login.js'. Leave empty for repo-wide."),
      repo: z.string().optional().describe(`Repo identifier. Defaults to '${DEFAULT_REPO}'.`),
      tags: z.array(z.string()).optional(),
      pr_ref: z.string().optional().describe("Related PR or issue, e.g. '#482'"),
    },
  },
  async ({ title, body, scope, repo, tags, pr_ref }) => {
    const entry = await api("POST", "/api/entries", {
      type: "decision",
      title,
      body,
      scope: scope || "",
      repo: repo || DEFAULT_REPO,
      tags: tags || [],
      pr_ref: pr_ref || "",
      agent: AGENT_NAME,
      author: AUTHOR,
      session_id: SESSION_ID,
    });
    return textResult(`Decision recorded (id: ${entry.id}).`);
  }
);

// ---------------------------------------------------------------------
// log_failed_approach
// ---------------------------------------------------------------------
server.registerTool(
  "log_failed_approach",
  {
    title: "Log Failed Approach",
    description:
      "Log an approach that was tried and didn't work — so other agents (or future you) " +
      "don't repeat it. Be specific about *why* it failed.",
    inputSchema: {
      title: z.string().describe("Short summary, e.g. 'Tried debouncing the submit handler'"),
      body: z.string().describe("What was tried and why it broke / was rejected. Markdown ok."),
      scope: z.string().optional().describe("File path or module this applies to."),
      repo: z.string().optional().describe(`Repo identifier. Defaults to '${DEFAULT_REPO}'.`),
      tags: z.array(z.string()).optional(),
    },
  },
  async ({ title, body, scope, repo, tags }) => {
    const entry = await api("POST", "/api/entries", {
      type: "failed_approach",
      title,
      body,
      scope: scope || "",
      repo: repo || DEFAULT_REPO,
      tags: tags || [],
      agent: AGENT_NAME,
      author: AUTHOR,
      session_id: SESSION_ID,
    });
    return textResult(`Failed approach logged (id: ${entry.id}).`);
  }
);

// ---------------------------------------------------------------------
// log_gotcha
// ---------------------------------------------------------------------
server.registerTool(
  "log_gotcha",
  {
    title: "Log Gotcha",
    description:
      "Log a non-obvious constraint, quirk, or 'gotcha' about a file or module that an agent " +
      "discovered while working — e.g. hidden coupling, a flaky test, a weird build requirement.",
    inputSchema: {
      title: z.string(),
      body: z.string(),
      scope: z.string().optional().describe("File path or module this applies to."),
      repo: z.string().optional().describe(`Repo identifier. Defaults to '${DEFAULT_REPO}'.`),
      tags: z.array(z.string()).optional(),
    },
  },
  async ({ title, body, scope, repo, tags }) => {
    const entry = await api("POST", "/api/entries", {
      type: "gotcha",
      title,
      body,
      scope: scope || "",
      repo: repo || DEFAULT_REPO,
      tags: tags || [],
      agent: AGENT_NAME,
      author: AUTHOR,
      session_id: SESSION_ID,
    });
    return textResult(`Gotcha logged (id: ${entry.id}).`);
  }
);

// ---------------------------------------------------------------------
// query_context — the read path agents should call before editing a file
// ---------------------------------------------------------------------
server.registerTool(
  "query_context",
  {
    title: "Query Context",
    description:
      "Look up everything the team's agents already know about a file or module before " +
      "editing it: prior decisions, failed approaches, and gotchas. Call this BEFORE making " +
      "changes to a file you haven't touched yet in this session.",
    inputSchema: {
      target: z.string().describe("File path or module name you're about to work on, e.g. 'src/auth/login.js'"),
      repo: z.string().optional().describe(`Repo identifier. Defaults to '${DEFAULT_REPO}'.`),
    },
  },
  async ({ target, repo }) => {
    const entries = await api(
      "GET",
      `/api/context?repo=${encodeURIComponent(repo || DEFAULT_REPO)}&target=${encodeURIComponent(target)}`
    );
    if (!entries.length) {
      return textResult(`No recorded context for '${target}'. Nothing the team has flagged here yet.`);
    }
    const body = entries.map(formatEntry).join("\n---\n");
    return textResult(`Found ${entries.length} relevant note(s) for '${target}':\n\n${body}`);
  }
);

// ---------------------------------------------------------------------
// list_recent — browse the timeline
// ---------------------------------------------------------------------
server.registerTool(
  "list_recent",
  {
    title: "List Recent Entries",
    description: "List the most recent decisions, failed approaches, and gotchas recorded for a repo.",
    inputSchema: {
      repo: z.string().optional().describe(`Repo identifier. Defaults to '${DEFAULT_REPO}'.`),
      limit: z.number().int().min(1).max(50).optional(),
      type: z.enum(["decision", "failed_approach", "gotcha", "note"]).optional(),
    },
  },
  async ({ repo, limit, type }) => {
    const params = new URLSearchParams({ repo: repo || DEFAULT_REPO, limit: String(limit || 10) });
    if (type) params.set("type", type);
    const entries = await api("GET", `/api/entries?${params.toString()}`);
    if (!entries.length) return textResult("No entries recorded yet.");
    return textResult(entries.map(formatEntry).join("\n---\n"));
  }
);

// ---------------------------------------------------------------------
// mark_stale — prune entries that no longer apply
// ---------------------------------------------------------------------
server.registerTool(
  "mark_stale",
  {
    title: "Mark Entry Stale",
    description:
      "Mark a previously recorded entry as stale or superseded, e.g. because the decision " +
      "was reversed or the gotcha no longer applies after a refactor.",
    inputSchema: {
      id: z.string().describe("The entry id (returned when it was created, or from query_context/list_recent)."),
      status: z.enum(["stale", "superseded", "active"]).default("stale"),
      reason: z.string().optional().describe("Optional short note on why it's being marked."),
    },
  },
  async ({ id, status, reason }) => {
    const patch = { status };
    if (reason) {
      const existing = await api("GET", `/api/entries/${id}`);
      patch.body = `${existing.body}\n\n[${status} — ${reason}]`;
    }
    const updated = await api("PATCH", `/api/entries/${id}`, patch);
    return textResult(`Entry '${updated.title}' marked ${status}.`);
  }
);

// ---------------------------------------------------------------------
// fetch_github_readme — fetch the README of any GitHub repository
// ---------------------------------------------------------------------
server.registerTool(
  "fetch_github_readme",
  {
    title: "Fetch GitHub README",
    description: "Fetch the README file contents of any GitHub repository using owner/name (e.g. 'Sadansatish/refactored-disco').",
    inputSchema: {
      repoPath: z.string().describe("The owner/repo path to fetch, e.g. 'Sadansatish/refactored-disco' or 'github.com/Sadansatish/refactored-disco'"),
    },
  },
  async ({ repoPath }) => {
    const normalized = repoPath.replace(/^(https?:\/\/)?(www\.)?github\.com\//, "").replace(/\/$/, "");
    const parts = normalized.split("/");
    if (parts.length !== 2) {
      throw new Error(`Invalid repository path format: '${repoPath}'. Must be in 'owner/repo' format.`);
    }
    const [owner, repoName] = parts;
    const res = await fetch(`https://api.github.com/repos/${owner}/${repoName}/readme`, {
      headers: {
        "Accept": "application/vnd.github.raw",
        "User-Agent": "AgentLog/0.1",
      },
    });
    if (!res.ok) {
      throw new Error(`Failed to fetch README for '${owner}/${repoName}': HTTP ${res.status}`);
    }
    const text = await res.text();
    return textResult(text);
  }
);

// ---------------------------------------------------------------------
// summarize_github_repo — summarize a GitHub repository's structure, tech stack, and AgentLog context
// ---------------------------------------------------------------------
server.registerTool(
  "summarize_github_repo",
  {
    title: "Summarize GitHub Repo",
    description: "Generates a structured summary of a GitHub repository by reading its README, detecting its tech stack/dependencies, and listing key AgentLog decisions or gotchas.",
    inputSchema: {
      repoPath: z.string().describe("The owner/repo path, e.g. 'Sadansatish/refactored-disco'"),
    },
  },
  async ({ repoPath }) => {
    const normalized = repoPath.replace(/^(https?:\/\/)?(www\.)?github\.com\//, "").replace(/\/$/, "");
    const parts = normalized.split("/");
    if (parts.length < 2) {
      throw new Error(`Invalid repository path format: '${repoPath}'. Must contain owner and repo name.`);
    }
    const [owner, repoName] = parts;
    const repoId = `github.com/${owner}/${repoName}`;

    let readmeIntro = "No README found.";
    let techStack = "Unknown";
    let folderStructure = "";
    let agentlogStatsStr = "No AgentLog history logged.";

    // 1. Try fetching README for intro
    try {
      const res = await fetch(`https://api.github.com/repos/${owner}/${repoName}/readme`, {
        headers: { "Accept": "application/vnd.github.raw", "User-Agent": "AgentLog/0.1" },
      });
      if (res.ok) {
        const text = await res.text();
        readmeIntro = text.split("\n").slice(0, 15).join("\n").trim() + "\n...";
      }
    } catch (e) {
      // ignore
    }

    // 2. Fetch root files to build folder structure and detect tech stack
    try {
      const res = await fetch(`https://api.github.com/repos/${owner}/${repoName}/contents`, {
        headers: { "Accept": "application/vnd.github+json", "User-Agent": "AgentLog/0.1" },
      });
      if (res.ok) {
        const items = await res.json();
        const files = items.map(item => item.name);
        folderStructure = items.map(item => `  - [${item.type}] ${item.name}`).slice(0, 20).join("\n");
        if (items.length > 20) folderStructure += `\n  - ... and ${items.length - 20} more items.`;

        // Tech stack detection
        const stackList = [];
        if (files.includes("package.json")) stackList.push("Node.js/JavaScript");
        if (files.includes("requirements.txt") || files.includes("Pipfile") || files.includes("pyproject.toml")) stackList.push("Python");
        if (files.includes("go.mod")) stackList.push("Go");
        if (files.includes("Cargo.toml")) stackList.push("Rust");
        if (files.includes("pom.xml") || files.includes("build.gradle")) stackList.push("Java/JVM");
        if (files.includes("Gemfile")) stackList.push("Ruby");
        if (files.includes("composer.json")) stackList.push("PHP");
        if (stackList.length) techStack = stackList.join(", ");
      }
    } catch (e) {
      // ignore
    }

    // 3. Query AgentLog database for telemetry & entry statistics
    try {
      const stats = await api("GET", `/api/stats?repo=${encodeURIComponent(repoId)}`);
      const telemetry = await api("GET", `/api/telemetry/stats?repo=${encodeURIComponent(repoId)}`);
      
      agentlogStatsStr = `Entries: ${stats.total || 0} total (${stats.active || 0} active, ${stats.decisions || 0} decisions, ${stats.gotchas || 0} gotchas, ${stats.failed_approaches || 0} failures)\n`;
      if (telemetry && (telemetry.total_input || telemetry.total_output)) {
        agentlogStatsStr += `Token Telemetry: ${(telemetry.total_input + telemetry.total_output).toLocaleString()} tokens used (${telemetry.efficiency}% efficiency, ${telemetry.total_wasted.toLocaleString()} wasted)`;
      }
    } catch (e) {
      // ignore
    }

    const summary = `## Repository Summary: ${owner}/${repoName}\n\n` +
      `### Tech Stack\n${techStack}\n\n` +
      `### README Intro\n\`\`\`markdown\n${readmeIntro}\n\`\`\`\n\n` +
      `### Root Structure\n${folderStructure}\n\n` +
      `### AgentLog Memory\n${agentlogStatsStr}`;

    return textResult(summary);
  }
);

// ---------------------------------------------------------------------
// list_github_files — list files in a GitHub repo
// ---------------------------------------------------------------------
server.registerTool(
  "list_github_files",
  {
    title: "List GitHub Files",
    description: "Get the directory/file structure of any public GitHub repository.",
    inputSchema: {
      repoPath: z.string().describe("The owner/repo, e.g. 'Sadansatish/refactored-disco'"),
      path: z.string().optional().describe("Subdirectory path within the repo. Defaults to root."),
    },
  },
  async ({ repoPath, path }) => {
    const normalized = repoPath.replace(/^(https?:\/\/)?(www\.)?github\.com\//, "").replace(/\/$/, "");
    const parts = normalized.split("/");
    if (parts.length < 2) {
      throw new Error(`Invalid repository path format: '${repoPath}'. Must contain owner and repo name.`);
    }
    const owner = parts[0];
    const repoName = parts[1];
    const urlPath = path ? `/contents/${path.replace(/^\//, "")}` : "/contents";
    const res = await fetch(`https://api.github.com/repos/${owner}/${repoName}${urlPath}`, {
      headers: {
        "Accept": "application/vnd.github+json",
        "User-Agent": "AgentLog/0.1",
      },
    });
    if (!res.ok) {
      throw new Error(`Failed to list files for '${owner}/${repoName}': HTTP ${res.status}`);
    }
    const items = await res.json();
    const formatted = items.map(item => `[${item.type}] ${item.path}`).join("\n");
    return textResult(formatted);
  }
);

// ---------------------------------------------------------------------
// fetch_github_file — fetch contents of a file in a GitHub repo
// ---------------------------------------------------------------------
server.registerTool(
  "fetch_github_file",
  {
    title: "Fetch GitHub File",
    description: "Fetch the contents of any specific file in a public GitHub repository.",
    inputSchema: {
      repoPath: z.string().describe("The owner/repo, e.g. 'Sadansatish/refactored-disco'"),
      filePath: z.string().describe("The path to the file relative to the repository root, e.g. 'package.json' or 'backend/server.js'"),
    },
  },
  async ({ repoPath, filePath }) => {
    const normalized = repoPath.replace(/^(https?:\/\/)?(www\.)?github\.com\//, "").replace(/\/$/, "");
    const parts = normalized.split("/");
    if (parts.length < 2) {
      throw new Error(`Invalid repository path format: '${repoPath}'. Must contain owner and repo name.`);
    }
    const owner = parts[0];
    const repoName = parts[1];
    const res = await fetch(`https://api.github.com/repos/${owner}/${repoName}/contents/${filePath.replace(/^\//, "")}`, {
      headers: {
        "Accept": "application/vnd.github.raw",
        "User-Agent": "AgentLog/0.1",
      },
    });
    if (!res.ok) {
      throw new Error(`Failed to fetch file '${filePath}' in '${owner}/${repoName}': HTTP ${res.status}`);
    }
    const text = await res.text();
    return textResult(text);
  }
);

// ---------------------------------------------------------------------
// search_entries — search AgentLog entries by text query
// ---------------------------------------------------------------------
server.registerTool(
  "search_entries",
  {
    title: "Search AgentLog Entries",
    description: "Search team decisions, gotchas, and notes in AgentLog by text query / keywords.",
    inputSchema: {
      q: z.string().describe("Search keywords, e.g. 'JWT' or 'session cookie'"),
      repo: z.string().optional().describe(`Repo identifier. Defaults to '${DEFAULT_REPO}'.`),
    },
  },
  async ({ q, repo }) => {
    const params = new URLSearchParams({ repo: repo || DEFAULT_REPO, q });
    const entries = await api("GET", `/api/entries?${params.toString()}`);
    if (!entries.length) return textResult(`No entries found matching '${q}'.`);
    return textResult(entries.map(formatEntry).join("\n---\n"));
  }
);

// ---------------------------------------------------------------------
// search_github_code — search code in a GitHub repository
// ---------------------------------------------------------------------
server.registerTool(
  "search_github_code",
  {
    title: "Search GitHub Code",
    description: "Search for code patterns, keywords, or class/function names inside a public GitHub repository.",
    inputSchema: {
      repoPath: z.string().describe("The owner/repo, e.g. 'Sadansatish/refactored-disco'"),
      query: z.string().describe("The search query, e.g. 'JWT_SECRET' or 'function login'"),
    },
  },
  async ({ repoPath, query }) => {
    const normalized = repoPath.replace(/^(https?:\/\/)?(www\.)?github\.com\//, "").replace(/\/$/, "");
    const parts = normalized.split("/");
    if (parts.length < 2) {
      throw new Error(`Invalid repository path format: '${repoPath}'. Must contain owner and repo name.`);
    }
    const owner = parts[0];
    const repoName = parts[1];
    const res = await fetch(`https://api.github.com/search/code?q=${encodeURIComponent(query)}+repo:${owner}/${repoName}`, {
      headers: {
        "Accept": "application/vnd.github+json",
        "User-Agent": "AgentLog/0.1",
      },
    });
    if (!res.ok) {
      throw new Error(`Code search failed: HTTP ${res.status}. Note: GitHub code search API has search rate limits.`);
    }
    const data = await res.json();
    if (!data.items || !data.items.length) {
      return textResult(`No matches found for '${query}' in '${owner}/${repoName}'.`);
    }
    const formatted = data.items
      .slice(0, 15)
      .map(item => `- ${item.path} (${item.html_url})`)
      .join("\n");
    return textResult(`Found ${data.total_count} match(es) for '${query}' in '${owner}/${repoName}'. Top results:\n\n${formatted}`);
  }
);

// ---------------------------------------------------------------------
// log_token_usage — log token telemetry automatically
// ---------------------------------------------------------------------
server.registerTool(
  "log_token_usage",
  {
    title: "Log Token Usage",
    description: "Automatically log token usage and telemetry for this session/run. You must call this tool at the end of your task/conversation to report how many tokens were consumed, how many were wasted on failed approaches/gotchas, and track repo-level efficiency.",
    inputSchema: {
      tokens_input: z.number().int().min(0).describe("Number of input tokens consumed by the agent in this session"),
      tokens_output: z.number().int().min(0).describe("Number of output tokens generated by the agent in this session"),
      tokens_wasted: z.number().int().min(0).optional().describe("Estimated tokens wasted on failed approaches, bugs, or gotchas encountered in this session (optional)"),
      commit_sha: z.string().optional().describe("The commit SHA associated with the changes, if any (optional)"),
      repo: z.string().optional().describe(`Repo identifier. Defaults to '${DEFAULT_REPO}'.`),
    },
  },
  async ({ tokens_input, tokens_output, tokens_wasted, commit_sha, repo }) => {
    const data = await api("POST", "/api/telemetry", {
      repo: repo || DEFAULT_REPO,
      commit_sha: commit_sha || "",
      session_id: SESSION_ID,
      tokens_input,
      tokens_output,
      tokens_wasted: tokens_wasted || 0
    });
    return textResult(`Token telemetry logged for repo '${data.repo}' (Input: ${data.tokens_input}, Output: ${data.tokens_output}, Wasted: ${data.tokens_wasted}).`);
  }
);

// Load and register custom tools from the backend
try {
  const customTools = await api("GET", "/api/custom-tools");
  if (Array.isArray(customTools)) {
    for (const t of customTools) {
      let schema;
      try {
        schema = JSON.parse(t.schema_json);
      } catch {
        schema = { properties: {} };
      }

      // Convert schema into zod object
      const zodSchema = {};
      if (schema.properties) {
        for (const [key, prop] of Object.entries(schema.properties)) {
          let field = z.string();
          if (prop.type === "number") field = z.number();
          else if (prop.type === "boolean") field = z.boolean();
          else if (prop.type === "array") field = z.array(z.string());

          if (prop.description) {
            field = field.describe(prop.description);
          }
          if (schema.required && schema.required.includes(key)) {
            zodSchema[key] = field;
          } else {
            zodSchema[key] = field.optional();
          }
        }
      }

      server.registerTool(
        t.name,
        {
          title: t.name,
          description: t.description,
          inputSchema: zodSchema,
        },
        async (args) => {
          try {
            // Compile and run the custom JavaScript body
            const fn = new Function("args", "fetch", `return (async () => { ${t.code} })()`);
            const result = await fn(args, fetch);
            const textResult = typeof result === "object" ? JSON.stringify(result, null, 2) : String(result);
            return { content: [{ type: "text", text: textResult }] };
          } catch (err) {
            throw new Error(`Custom tool '${t.name}' execution failed: ${err.message}`);
          }
        }
      );
    }
  }
} catch (e) {
  console.error("[agentlog] Failed to load custom tools:", e.message);
}

const transport = new StdioServerTransport();
await server.connect(transport);
