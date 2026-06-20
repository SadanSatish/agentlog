const API = "http://localhost:4790";

const entries = [
  {
    repo: "github.com/scala-steward-org/repos",
    type: "decision",
    title: "Keep repos.md as the single source of truth",
    body: "All repository URLs go in repos.md, one per line. No database or config file — the file IS the config.",
    scope: "repos.md",
    author: "sadan",
    agent: "claude-code",
    tags: ["architecture"],
  },
  {
    repo: "github.com/scala-steward-org/repos",
    type: "gotcha",
    title: "Duplicate repo URLs cause steward to run twice",
    body: "If the same repo URL appears on multiple lines in repos.md, scala-steward will process it twice, creating duplicate PRs. Always deduplicate before merging.",
    scope: "repos.md",
    author: "sadan",
    agent: "cursor",
    tags: ["scala-steward", "bug"],
  },
  {
    repo: "github.com/scala-steward-org/repos",
    type: "failed_approach",
    title: "Tried sorting repos.md alphabetically",
    body: "Alphabetical sort broke the grouping by organization. Maintainers prefer repos grouped by org for readability. Reverted.",
    scope: "repos.md",
    author: "sadan",
    agent: "claude-code",
    tags: ["formatting"],
  },
  {
    repo: "github.com/scala-steward-org/repos",
    type: "note",
    title: "PRs should only add repos, not remove",
    body: "Removing a repo from the list stops scala-steward updates for that project. Removals need maintainer approval.",
    scope: "",
    author: "sadan",
    tags: ["contributing"],
  },
];

for (const e of entries) {
  const r = await fetch(`${API}/api/entries`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(e),
  });
  const d = await r.json();
  console.log(`✅ [${d.type}] ${d.title}`);
}

console.log("\nDone! Select 'github.com/scala-steward-org/repos' from the repo dropdown in the dashboard.");
