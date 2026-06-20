// Seeds sample entries so the dashboard has real-looking data to display.
const API = "http://localhost:4790";

const entries = [
  {
    repo: "github.com/acme/web",
    type: "decision",
    title: "Use httpOnly cookies for session tokens",
    body: "Decided against localStorage for tokens due to XSS exposure. httpOnly cookies are not accessible via JavaScript, making them safer for storing session tokens.",
    scope: "src/auth/",
    author: "sadan",
    agent: "claude-code",
    tags: ["auth", "security"],
    pr_ref: "#482",
  },
  {
    repo: "github.com/acme/web",
    type: "failed_approach",
    title: "Tried debouncing the login submit handler",
    body: "Broke double-submit protection on slow networks. The debounce delay caused the guard flag to reset before the second click was caught. Reverted in commit a1b2c3d.",
    scope: "src/auth/login.js",
    author: "sadan",
    agent: "cursor",
    tags: ["auth", "ux"],
  },
  {
    repo: "github.com/acme/web",
    type: "gotcha",
    title: "Database migration must run before deploy",
    body: "The migration script creates a required index on the `users` table. Deploying without running it first causes 500 errors on the search endpoint because the query planner falls back to a full table scan that times out.",
    scope: "src/db/",
    author: "alex",
    agent: "claude-code",
    tags: ["deploy", "database"],
  },
  {
    repo: "github.com/acme/web",
    type: "note",
    title: "Initial project setup with Vite + React",
    body: "Bootstrapped the project using create-vite with the React-TS template. Using TypeScript for type safety, Vitest for unit tests, and Playwright for E2E.",
    scope: "",
    author: "sadan",
    agent: "claude-code",
    tags: ["setup"],
  },
  {
    repo: "github.com/acme/web",
    type: "decision",
    title: "Adopt Zod for runtime validation",
    body: "TypeScript types disappear at runtime. For API request/response validation we need a runtime schema library. Chose Zod over Yup because it has better TS inference and a smaller bundle.",
    scope: "src/api/",
    author: "alex",
    agent: "copilot",
    tags: ["validation", "architecture"],
    pr_ref: "#501",
  },
  {
    repo: "github.com/acme/web",
    type: "gotcha",
    title: "CSS modules break with dynamic class names",
    body: "Vite's CSS modules transform class names at build time. Template literals like `styles[`btn-${variant}`]` won't work — you need to use bracket access with the exact exported name, or switch to a static mapping object.",
    scope: "src/components/Button.tsx",
    author: "sadan",
    agent: "claude-code",
    tags: ["css", "vite"],
  },
];

for (const e of entries) {
  const res = await fetch(`${API}/api/entries`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(e),
  });
  const data = await res.json();
  console.log(`✅ [${data.type}] ${data.title}`);
}

console.log(`\nSeeded ${entries.length} entries. Open http://localhost:4790 in Brave.`);
