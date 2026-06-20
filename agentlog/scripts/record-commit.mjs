#!/usr/bin/env node
// record-commit.mjs
//
// Called from the post-commit git hook (see git-hooks/post-commit). Logs the
// commit that just happened as a note in AgentLog, scoped to the files it
// touched, so the team's timeline shows commits alongside agent decisions.
//
// Never blocks or fails the commit: any error here just prints a warning.

import { execSync } from "node:child_process";

const API_URL = (process.env.AGENTLOG_API_URL || "http://localhost:4790").replace(/\/$/, "");

function sh(cmd) {
  return execSync(cmd, { encoding: "utf8" }).trim();
}

async function main() {
  const sha = sh("git rev-parse HEAD");
  const message = sh("git log -1 --pretty=%B").trim();
  const author = sh("git log -1 --pretty=%an");
  const changedFiles = sh("git show --pretty=format: --name-only HEAD")
    .split("\n")
    .map((f) => f.trim())
    .filter(Boolean);

  let repo;
  try {
    repo = sh("git config --get remote.origin.url")
      .replace(/^git@([^:]+):/, "$1/")
      .replace(/^https?:\/\//, "")
      .replace(/\.git$/, "");
  } catch {
    repo = sh("basename $(git rev-parse --show-toplevel)");
  }

  // Scope to the most "central" changed file (shortest path = likely the
  // most general one) so this commit surfaces when an agent later queries
  // context for any file it touched.
  const scope = changedFiles.length === 1 ? changedFiles[0] : commonDir(changedFiles);

  const title = message.split("\n")[0].slice(0, 140);
  const body =
    message +
    (changedFiles.length ? `\n\nFiles changed:\n${changedFiles.map((f) => `- ${f}`).join("\n")}` : "");

  const res = await fetch(`${API_URL}/api/entries`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      repo,
      type: "note",
      title,
      body,
      scope,
      author,
      commit_sha: sha,
      tags: ["commit"],
    }),
  });

  if (!res.ok) {
    console.warn(`[agentlog] could not record commit (HTTP ${res.status}) — continuing.`);
  }
}

function commonDir(files) {
  if (!files.length) return "";
  const parts = files.map((f) => f.split("/"));
  const minLen = Math.min(...parts.map((p) => p.length));
  const common = [];
  for (let i = 0; i < minLen; i++) {
    const seg = parts[0][i];
    if (parts.every((p) => p[i] === seg)) common.push(seg);
    else break;
  }
  return common.length ? common.join("/") + "/" : "";
}

main().catch((err) => {
  console.warn(`[agentlog] skipping commit log: ${err.message}`);
});
