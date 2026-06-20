# AgentLog

A shared, queryable memory layer for AI coding agents on a team.

When you and your teammates each run Claude Code, Cursor, Copilot, etc.
against the same repo, every agent session starts from zero. Nobody's agent
knows that someone already tried a fix that broke something, or that the
team explicitly decided against an approach in PR #482, or that some module
has a non-obvious constraint. AgentLog is a small, self-hosted service that
gives agents a place to write that down — and to check it before they
repeat each other's mistakes.

```
> query_context("src/auth/login.js")

Found 2 relevant note(s) for 'src/auth/login.js':

### Use httpOnly cookies for session tokens [auth, security]
type: decision | scope: src/auth/ | by: sadan via claude-code | #482
Decided against localStorage for tokens due to XSS exposure.

---
### Tried debouncing the login submit handler
type: failed_approach | scope: src/auth/login.js | by: sadan via cursor
Broke double-submit protection on slow networks. Reverted in commit a1b2c3d.
```

## What's in here

```
server/        Backend API — Express + SQLite (node:sqlite, no native deps)
mcp-server/    MCP server — exposes the memory as tools to any MCP agent
dashboard/     Static web UI to browse, search, and prune entries
scripts/       Git hook + installer that auto-logs commits into the timeline
docs/          Architecture notes
```

This is the "ship a v0 in a weekend" scope: one backend, one MCP server,
SQLite instead of Postgres for now (see `docs/ARCHITECTURE.md` for the
Postgres migration path), one scope-matching strategy (path prefixes, not
full glob support yet).

## Requirements

- Node.js **22.5+** (the backend uses the built-in `node:sqlite` module —
  no native compilation, no extra DB dependency to install)

## Quick start

**1. Run the backend** (one person on the team runs this; everyone else
points at it):

```bash
cd server
npm install
npm start
# AgentLog server listening on http://localhost:4790
# Dashboard:        http://localhost:4790
```

Open `http://localhost:4790` — that's the dashboard, served straight off
the backend. Add an entry by hand to confirm it's working.

**2. Wire up the MCP server** so your coding agent can read/write it. For
Claude Code, add to your MCP config (`~/.claude.json` or your project's
`.mcp.json`):

```json
{
  "mcpServers": {
    "agentlog": {
      "command": "node",
      "args": ["/absolute/path/to/agentlog/mcp-server/src/index.js"],
      "env": {
        "AGENTLOG_API_URL": "http://localhost:4790",
        "AGENTLOG_REPO": "github.com/your-org/your-repo",
        "AGENTLOG_AGENT": "claude-code",
        "AGENTLOG_AUTHOR": "your-name"
      }
    }
  }
}
```

For Cursor, the same shape goes in Cursor's MCP settings
(`Settings → MCP`). Any MCP-compatible client works the same way — it's a
standard stdio MCP server, nothing Claude-specific about it.

Don't forget:

```bash
cd mcp-server && npm install
```

**3. (Optional) Auto-log commits.** From inside the repo you want watched:

```bash
bash /absolute/path/to/agentlog/scripts/install-git-hook.sh
```

This installs a `post-commit` hook that posts each commit (message, files
touched, SHA) into AgentLog as a timeline note. It never blocks a commit —
if AgentLog isn't reachable, it just skips silently.

## The MCP tools

| Tool                 | What it does                                                          |
|-----------------------|------------------------------------------------------------------------|
| `record_decision`     | Log a decision and why it was made (architectural choice, rejected design, etc.) |
| `log_failed_approach` | Log something that was tried and didn't work, and why                |
| `log_gotcha`          | Log a non-obvious constraint or quirk discovered in a file/module    |
| `query_context`       | **The read path.** Look up everything recorded for a file/module before editing it |
| `list_recent`         | Browse the most recent entries for a repo                            |
| `mark_stale`          | Mark an entry stale/superseded once it no longer applies             |

A reasonable system-prompt nudge for your agent: *"Before editing a file
you haven't touched yet this session, call `query_context` on it. After
making a non-trivial decision or hitting a dead end, record it with
`record_decision` or `log_failed_approach`."* Claude Code and most agents
will pick MCP tools up on their own once the description makes the
intent obvious — the tool descriptions in `mcp-server/src/index.js` are
written to nudge that behavior, but an explicit project instruction
(e.g. in `CLAUDE.md`) will make it more consistent.

## The dashboard

Browse by repo, filter by type (`decision` / `failed_approach` / `gotcha` /
`note`) and status (`active` / `stale` / `superseded`), search titles and
bodies, add entries manually, and mark things stale or delete them once
they're no longer useful. No build step — open `index.html` via the backend
or host the three static files anywhere and set
`window.AGENTLOG_API_BASE = "https://your-agentlog-host"` before
`app.js` loads.

## Running the backend somewhere the team can reach

For real team use, run `server/` somewhere persistent — a small VM, a
container, a Fly.io/Render app, whatever you've already got. It's a single
Node process plus a SQLite file; point `AGENTLOG_DB_PATH` at a persistent
volume if you're containerizing it. Then every teammate's MCP config just
points `AGENTLOG_API_URL` at that host instead of `localhost`.

## Verifying your setup

`mcp-server/test-harness.mjs` spins up the MCP server over stdio and
exercises `query_context` + `log_gotcha` against a running backend — useful
to confirm the MCP server and backend can actually talk to each other:

```bash
cd server && npm start &
cd ../mcp-server && node test-harness.mjs
```

## License

MIT — see `LICENSE`.
