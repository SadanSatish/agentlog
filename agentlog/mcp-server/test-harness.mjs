import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command: "node",
  args: ["src/index.js"],
  env: {
    ...process.env,
    AGENTLOG_API_URL: "http://localhost:4790",
    AGENTLOG_REPO: "acme/web",
    AGENTLOG_AGENT: "test-harness",
    AGENTLOG_AUTHOR: "sadan",
  },
});

const client = new Client({ name: "test-harness", version: "0.1.0" });
await client.connect(transport);

const tools = await client.listTools();
console.log("TOOLS:", tools.tools.map((t) => t.name).join(", "));

const ctx = await client.callTool({
  name: "query_context",
  arguments: { target: "src/auth/login.js" },
});
console.log("\nquery_context result:\n", ctx.content[0].text);

const rec = await client.callTool({
  name: "log_gotcha",
  arguments: {
    title: "Test gotcha from MCP harness",
    body: "This is just a smoke test entry.",
    scope: "src/auth/login.js",
  },
});
console.log("\nlog_gotcha result:\n", rec.content[0].text);

await client.close();
process.exit(0);
