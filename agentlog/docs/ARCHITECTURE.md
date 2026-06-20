# Architecture

AgentLog has three pieces that talk to one backend. This is the v0 described
in the original sketch: narrow scope, one weekend to working, swappable
storage layer.

```
                     ┌────────────────────┐
   Claude Code  ───▶ │                    │
   Cursor       ───▶ │   MCP server       │  stdio per agent process,
   Copilot Chat ───▶ │  (mcp-server/)     │  one teammate runs one copy
                     └─────────┬──────────┘
                               │ HTTP (REST)
                               ▼
                     ┌────────────────────┐
   Dashboard     ───▶│   Backend API      │  one shared instance per team
   (dashboard/)      │   (server/)        │  (self-hosted: a VM, a
                     │   Express + SQLite │  container, or your laptop
                     └─────────┬──────────┘  if you're trying it solo)
                               │
                               ▼
                        entries.db (SQLite file)
```

## Why this split

- **MCP server is a thin client, not a database.** Every teammate runs their
  own MCP server process (that's how MCP works — it's spawned per-agent over
  stdio), but it holds no state of its own. It just calls the shared
  backend's REST API. This is what makes the memory *shared*: two
  teammates' agents both end up talking to the same database.
- **Backend is the only thing that touches storage.** `server/src/db.js` is
  the single file that knows about SQL. Everything else — the API routes,
  the MCP tools, the dashboard — goes through it (or through the REST API
  it exposes). That's the seam to swap SQLite for Postgres later: rewrite
  `db.js` to use `pg` instead of `node:sqlite`, keep the same exported
  function signatures, nothing else changes.
- **Dashboard is just another API client.** It's plain HTML/CSS/JS with no
  build step, served statically by the Express app (or you can host it
  anywhere and point it at the API with `window.AGENTLOG_API_BASE`).

## Data model

One table, `entries`, deliberately denormalized for a v0:

| column      | meaning                                                            |
|-------------|---------------------------------------------------------------------|
| id          | uuid                                                                 |
| repo        | repo identifier — git remote URL by convention, but any string works|
| type        | `decision` \| `failed_approach` \| `gotcha` \| `note`                |
| scope       | file path or module prefix this applies to; empty = repo-wide       |
| title       | short summary                                                       |
| body        | full note, markdown-ish free text                                   |
| author      | human who attached their name (optional)                            |
| agent       | which tool recorded it (`claude-code`, `cursor`, ...)                |
| session_id  | groups entries from one agent session                               |
| pr_ref      | optional PR/issue reference                                          |
| commit_sha  | set automatically by the git hook, or manually                       |
| tags        | comma-joined in storage, array over the API                         |
| status      | `active` \| `stale` \| `superseded`                                  |
| created_at / updated_at | ISO timestamps                                          |

### Scope matching

`query_context(repo, target)` is the read path every agent calls before
touching a file. It returns: every entry with an empty `scope` (repo-wide),
plus every entry whose `scope` is a path-prefix match against `target` in
*either* direction (`target.startsWith(scope) || scope.startsWith(target)`).
That means a note scoped to `src/auth/` surfaces for `src/auth/login.js`,
and a note scoped to `src/auth/login.js` surfaces if an agent queries
`src/auth/`.

This is intentionally simple string matching, not a glob engine — good
enough for "this file" / "this directory" granularity, which covers the
overwhelming majority of real cases. A glob/regex scope matcher is the
natural v1 upgrade if you need it.

## Migrating to Postgres

When a team outgrows a single SQLite file (concurrent writers, wanting it
on RDS, etc.):

1. Stand up Postgres, create the same `entries` table (the `CREATE TABLE`
   in `db.js` is close to portable SQL already — `TEXT` everywhere, no
   SQLite-specific types).
2. Replace the `node:sqlite` calls in `db.js` with the `pg` driver (or an
   ORM like Prisma/Drizzle if you'd rather). Keep the exported function
   names and shapes identical.
3. Nothing in `server.js`, `mcp-server/`, or `dashboard/` needs to change —
   they only know about the REST API.

## Extending the MCP surface

Each tool in `mcp-server/src/index.js` is a `server.registerTool(name,
config, handler)` call that does one HTTP request against the backend.
Adding a new tool (say, `link_pr` to attach a PR URL after the fact) means
adding one more `registerTool` block and, if needed, one more backend route.
