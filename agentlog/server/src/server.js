// server.js — AgentLog backend.
//
// A small REST API in front of the entries store (db.js). This is the
// "shared service" every teammate's MCP server and the dashboard talk to.
// Run it once per team, somewhere everyone can reach (a VM, a container,
// localhost if you're just trying it solo).

import "dotenv/config";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as store from "./db.js";
import * as github from "./github.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 4790;
const COOKIE_SECRET = process.env.COOKIE_SECRET || "agentlog-default-secret";

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser(COOKIE_SECRET));

// Serve the static dashboard so `npm start` alone gives you a working UI.
app.use("/", express.static(path.join(__dirname, "..", "..", "dashboard")));

function wrap(handler) {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (err) {
      console.error(err);
      res.status(400).json({ error: err.message || "bad request" });
    }
  };
}

function getOrigin(req) {
  return `${req.protocol}://${req.get("host")}`;
}

// --- GitHub OAuth --------------------------------------------------------

app.get("/auth/github", (req, res) => {
  if (!github.isConfigured()) {
    return res.status(500).json({ error: "GitHub OAuth not configured. Set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET." });
  }
  const state = crypto.randomUUID();
  res.cookie("oauth_state", state, { httpOnly: true, signed: true, maxAge: 600_000 });
  res.redirect(github.getAuthUrl(getOrigin(req), state));
});

app.get(
  "/auth/github/callback",
  wrap(async (req, res) => {
    const { code, state } = req.query;
    const savedState = req.signedCookies.oauth_state;

    if (!code) return res.status(400).send("Missing code parameter.");
    if (!state || state !== savedState) return res.status(403).send("Invalid OAuth state — possible CSRF.");

    res.clearCookie("oauth_state");

    const token = await github.exchangeCode(code);
    const user = await github.fetchUser(token);

    // Store token + basic user info in a signed cookie.
    // For a self-hosted v0 this is fine; a production system would use
    // server-side sessions or JWTs.
    const session = JSON.stringify({ token, login: user.login, name: user.name, avatar_url: user.avatar_url });
    res.cookie("agentlog_session", session, {
      httpOnly: true,
      signed: true,
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      sameSite: "lax",
    });

    res.redirect("/");
  })
);

app.get(
  "/api/me",
  wrap(async (req, res) => {
    const raw = req.signedCookies.agentlog_session;
    if (!raw) return res.json({ authenticated: false });

    let session;
    try { session = JSON.parse(raw); } catch { return res.json({ authenticated: false }); }

    // Fetch repos fresh from GitHub (they're fast and always up to date)
    let repos = [];
    try {
      repos = await github.fetchRepos(session.token);
    } catch (err) {
      console.warn("Failed to fetch GitHub repos:", err.message);
    }

    res.json({
      authenticated: true,
      user: {
        login: session.login,
        name: session.name,
        avatar_url: session.avatar_url,
      },
      github_repos: repos,
    });
  })
);

app.post("/api/logout", (req, res) => {
  res.clearCookie("agentlog_session");
  res.json({ ok: true });
});

app.get("/api/auth/status", (req, res) => {
  res.json({ github_configured: github.isConfigured() });
});

// --- entries ---------------------------------------------------------

app.get(
  "/api/entries",
  wrap((req, res) => {
    res.json(store.listEntries(req.query));
  })
);

app.get(
  "/api/entries/:id",
  wrap((req, res) => {
    const entry = store.getEntry(req.params.id);
    if (!entry) return res.status(404).json({ error: "not found" });
    res.json(entry);
  })
);

app.post(
  "/api/entries",
  wrap((req, res) => {
    if (!req.body.title) {
      return res.status(422).json({ error: "title is required" });
    }
    res.status(201).json(store.insertEntry(req.body));
  })
);

app.patch(
  "/api/entries/:id",
  wrap((req, res) => {
    const updated = store.updateEntry(req.params.id, req.body);
    if (!updated) return res.status(404).json({ error: "not found" });
    res.json(updated);
  })
);

app.delete(
  "/api/entries/:id",
  wrap((req, res) => {
    res.json(store.deleteEntry(req.params.id));
  })
);

// --- the core "what should an agent know before touching this file" query ---

app.get(
  "/api/context",
  wrap((req, res) => {
    const { repo, target } = req.query;
    res.json(store.queryContext(repo, target));
  })
);

// --- misc --------------------------------------------------------------

app.get(
  "/api/repos",
  wrap((req, res) => {
    res.json(store.listRepos());
  })
);

app.get(
  "/api/stats",
  wrap((req, res) => {
    res.json(store.stats(req.query.repo));
  })
);

app.get(
  "/api/info",
  wrap((req, res) => {
    const mcpPath = path.resolve(__dirname, "..", "..", "mcp-server", "src", "index.js").replace(/\\/g, "/");
    const installHookPath = path.resolve(__dirname, "..", "..", "scripts", "install-git-hook.sh").replace(/\\/g, "/");
    res.json({
      mcpPath,
      installHookPath,
      apiUrl: `${req.protocol}://${req.get("host")}`
    });
  })
);

app.get(
  "/api/custom-tools",
  wrap((req, res) => {
    res.json(store.listCustomTools());
  })
);

app.post(
  "/api/custom-tools",
  wrap((req, res) => {
    res.json(store.insertCustomTool(req.body));
  })
);

app.delete(
  "/api/custom-tools/:id",
  wrap((req, res) => {
    res.json(store.deleteCustomTool(req.params.id));
  })
);

app.get(
  "/api/telemetry",
  wrap((req, res) => {
    res.json(store.listTelemetry(req.query.repo));
  })
);

app.post(
  "/api/telemetry",
  wrap((req, res) => {
    res.json(store.insertTelemetry(req.body));
  })
);

app.get(
  "/api/telemetry/stats",
  wrap((req, res) => {
    res.json(store.getTelemetryStats(req.query.repo));
  })
);

app.get("/api/health", (req, res) => res.json({ ok: true }));

const isVercel = process.env.VERCEL === "1" || !!process.env.VERCEL;

if (!isVercel) {
  app.listen(PORT, () => {
    console.log(`AgentLog server listening on http://localhost:${PORT}`);
    console.log(`Dashboard:        http://localhost:${PORT}`);
    console.log(`API base:         http://localhost:${PORT}/api`);
    if (github.isConfigured()) {
      console.log(`GitHub OAuth:     configured ✓`);
    } else {
      console.log(`GitHub OAuth:     not configured (set GITHUB_CLIENT_ID + GITHUB_CLIENT_SECRET)`);
    }
  });
}

export default app;
